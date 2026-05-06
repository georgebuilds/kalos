import { describe, test, expect, vi, beforeEach } from 'vitest'

type Step = { toolResults: { toolName: string; result: unknown }[] }

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(async (_opts: unknown) => ({ steps: [] as Step[] })),
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  // tool() is used by tools/index.ts (loaded transitively via loop.ts). Pass-through is fine.
  tool: (t: unknown) => t,
}))

const { runAgentLoop } = await import('./loop.js')

const TASK = {
  description: 'Add a README',
  repo: 'owner/repo',
  branch: 'kalos/task-1',
  model: 'mock-model' as unknown as Parameters<typeof runAgentLoop>[0]['model'],
}

beforeEach(() => {
  mockGenerateText.mockClear()
})

describe('runAgentLoop', () => {
  test('returns fallback message when no complete tool is called', async () => {
    mockGenerateText.mockImplementation(async () => ({
      steps: [{ toolResults: [{ toolName: 'read_file', result: 'some content' }] }],
    }))
    const result = await runAgentLoop(TASK)
    expect(result).toBe('Agent finished (max steps reached)')
  })

  test('returns the complete tool summary when called', async () => {
    mockGenerateText.mockImplementation(async () => ({
      steps: [
        { toolResults: [{ toolName: 'write_file', result: 'written: README.md' }] },
        { toolResults: [{ toolName: 'complete', result: 'Added README with overview' }] },
      ],
    }))
    const result = await runAgentLoop(TASK)
    expect(result).toBe('Added README with overview')
  })

  test('returns the first complete result when complete is called in multiple steps', async () => {
    mockGenerateText.mockImplementation(async () => ({
      steps: [
        { toolResults: [{ toolName: 'complete', result: 'first summary' }] },
        { toolResults: [{ toolName: 'complete', result: 'second summary' }] },
      ],
    }))
    const result = await runAgentLoop(TASK)
    expect(result).toBe('first summary')
  })

  test('returns fallback for empty steps array', async () => {
    mockGenerateText.mockImplementation(async () => ({ steps: [] }))
    const result = await runAgentLoop(TASK)
    expect(result).toBe('Agent finished (max steps reached)')
  })

  test('returns fallback when steps have empty toolResults arrays', async () => {
    mockGenerateText.mockImplementation(async () => ({
      steps: [{ toolResults: [] }, { toolResults: [] }],
    }))
    const result = await runAgentLoop(TASK)
    expect(result).toBe('Agent finished (max steps reached)')
  })

  test('complete tool in earlier step wins over later non-complete tools', async () => {
    mockGenerateText.mockImplementation(async () => ({
      steps: [
        {
          toolResults: [
            { toolName: 'complete', result: 'done here' },
            { toolName: 'run_command', result: 'some output' },
          ],
        },
      ],
    }))
    const result = await runAgentLoop(TASK)
    expect(result).toBe('done here')
  })
})
