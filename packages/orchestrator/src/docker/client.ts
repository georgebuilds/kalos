import { config } from '../config.js'

export type ContainerCreateOptions = {
  image: string
  env: Record<string, string>
  // host-path:container-path[:options] bind mounts (e.g. for injecting a secrets file)
  binds?: string[]
  memoryBytes?: number
  capDrop?: string[]
}

export type DockerClient = {
  createContainer(opts: ContainerCreateOptions): Promise<{ id: string }>
  startContainer(id: string): Promise<void>
  stopContainer(id: string): Promise<void>
  removeContainer(id: string): Promise<void>
  getContainerLogs(id: string, since?: number): Promise<string>
  inspectContainer(id: string): Promise<{ State: { Status: string; ExitCode: number } }>
}

export class DockerError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DockerError'
    this.status = status
  }
}

async function dockerFetch(opts: {
  method: string
  path: string
  body?: unknown
  socketPath: string
}): Promise<Response> {
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : null
  const headers: Record<string, string> = {}
  if (bodyStr) headers['Content-Type'] = 'application/json'
  // @ts-ignore — Bun-specific unix socket option; body null is valid BodyInit
  return fetch(`http://localhost${opts.path}`, {
    method: opts.method,
    body: bodyStr,
    headers,
    signal: AbortSignal.timeout(config.dockerFetchTimeoutMs),
    unix: opts.socketPath,
  })
}

async function rawRequest(opts: {
  method: string
  path: string
  body?: unknown
  socketPath: string
}): Promise<{ status: number; buf: Buffer }> {
  const res = await dockerFetch(opts)
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, buf }
}

async function dockerRequest(opts: {
  method: string
  path: string
  body?: unknown
  socketPath: string
}): Promise<{ status: number; body: unknown; rawBody: string }> {
  const res = await dockerFetch(opts)
  const buf = Buffer.from(await res.arrayBuffer())
  const rawBody = buf.toString('utf8')
  const contentType = res.headers.get('content-type') ?? ''
  let body: unknown = rawBody
  if (contentType.includes('application/json')) {
    try {
      body = rawBody.trim() ? JSON.parse(rawBody) : null
    } catch {
      body = rawBody
    }
  }
  return { status: res.status, body, rawBody }
}

export function parseDockerLogs(buffer: Buffer): string {
  const frames: string[] = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const frameLen = buffer.readUInt32BE(offset + 4)
    offset += 8
    if (offset + frameLen > buffer.length) break
    frames.push(buffer.subarray(offset, offset + frameLen).toString('utf8'))
    offset += frameLen
  }
  return frames.join('')
}

export function createDockerClient(socketPath?: string): DockerClient {
  const sock = socketPath ?? config.dockerSocket

  async function req(method: string, path: string, body?: unknown) {
    const result = await dockerRequest({ method, path, body, socketPath: sock })
    if (result.status < 200 || result.status >= 300) {
      throw new DockerError(result.status, `Docker API error ${result.status}: ${result.rawBody}`)
    }
    return result
  }

  return {
    async createContainer(opts) {
      const result = await req('POST', '/containers/create', {
        Image: opts.image,
        Env: Object.entries(opts.env).map(([k, v]) => `${k}=${v}`),
        HostConfig: {
          Memory: opts.memoryBytes,
          CapDrop: opts.capDrop,
          Binds: opts.binds,
          // bridge gives full internet access (needed for git clone + LLM calls);
          // known risk: prompt injection could exfiltrate data or call arbitrary APIs
          NetworkMode: 'bridge',
          SecurityOpt: ['no-new-privileges'],
          PidsLimit: 256,
          AutoRemove: false,
        },
      })
      return { id: (result.body as { Id: string }).Id }
    },

    async startContainer(id) {
      await req('POST', `/containers/${id}/start`)
    },

    async stopContainer(id) {
      const result = await dockerRequest({
        method: 'POST',
        path: `/containers/${id}/stop?t=10`,
        socketPath: sock,
      })
      if (result.status !== 204 && result.status !== 304) {
        throw new DockerError(result.status, `Docker API error ${result.status}: ${result.rawBody}`)
      }
    },

    async removeContainer(id) {
      await req('DELETE', `/containers/${id}?force=true`)
    },

    async getContainerLogs(id, since) {
      const sinceParam = since !== undefined ? `&since=${since}` : ''
      const { status, buf } = await rawRequest({
        method: 'GET',
        path: `/containers/${id}/logs?stdout=1&stderr=1&follow=0&timestamps=0&tail=1000${sinceParam}`,
        socketPath: sock,
      })
      if (status < 200 || status >= 300) {
        throw new DockerError(status, `Docker API error ${status}`)
      }
      return parseDockerLogs(buf)
    },

    async inspectContainer(id) {
      const result = await req('GET', `/containers/${id}/json`)
      const body = result.body as { State: { Status: string; ExitCode: number } }
      return { State: body.State }
    },
  }
}
