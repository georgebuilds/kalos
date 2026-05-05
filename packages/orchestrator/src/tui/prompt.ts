import * as readline from 'node:readline/promises'
import { ansi } from './ansi.js'

export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`  ${question}: `)
  rl.close()
  return answer.trim()
}

const CTRL_C = '\x03'
const BACKSPACE = '\x7f'

let _rawModeActive = false
process.on('exit', () => {
  try {
    if (_rawModeActive) process.stdin.setRawMode(false)
  } catch {
    /* best effort */
  }
})

export async function secret(question: string): Promise<string> {
  process.stdout.write(`  ${question}: `)
  _rawModeActive = true
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise((resolve) => {
    let input = ''

    const cleanup = () => {
      _rawModeActive = false
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
    }

    const onData = (data: Buffer) => {
      const key = data.toString('utf8')
      if (key === CTRL_C) {
        cleanup()
        process.stdout.write('\n')
        process.exit(1)
      }
      // Handle pastes and multi-byte input by iterating code points.
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          cleanup()
          process.stdout.write('\n')
          resolve(input)
          return
        }
        if (ch === BACKSPACE || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1)
            process.stdout.write('\b \b')
          }
          continue
        }
        // Reject ASCII control chars; accept everything else (printable + multi-byte).
        const code = ch.charCodeAt(0)
        if (code < 32 || code === 127) continue
        input += ch
        process.stdout.write('•')
      }
    }

    process.stdin.on('data', onData)
  })
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} [Y/n]`)
  return answer === '' || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
}

export async function pressEnter(message = 'Press Enter to continue'): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await rl.question(`\n  ${message}...`)
  rl.close()
  process.stdout.write('\n')
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  successMsg: string,
): Promise<T> {
  let i = 0
  const interval = setInterval(() => {
    process.stdout.write(
      `${ansi.clearLine}  ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]!}  ${message}`,
    )
  }, 80)

  try {
    const result = await fn()
    clearInterval(interval)
    process.stdout.write(`${ansi.clearLine}  ✅  ${successMsg}\n`)
    return result
  } catch (err) {
    clearInterval(interval)
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`${ansi.clearLine}  ❌  ${msg}\n`)
    throw err
  }
}
