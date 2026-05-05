import { ansi } from './ansi.js'

export const bold = (s: string) => `${ansi.bold}${s}${ansi.reset}`
export const dim = (s: string) => `${ansi.dim}${s}${ansi.reset}`
export const green = (s: string) => `${ansi.green}${s}${ansi.reset}`
export const yellow = (s: string) => `${ansi.yellow}${s}${ansi.reset}`
export const cyan = (s: string) => `${ansi.cyan}${s}${ansi.reset}`
export const red = (s: string) => `${ansi.red}${s}${ansi.reset}`
export const gray = (s: string) => `${ansi.gray}${s}${ansi.reset}`

export function rule(char = '─', width = 60): string {
  return char.repeat(width)
}

// Approximate visible terminal width: strip ANSI codes, count chars
// Emoji/wide chars are counted as 2 columns
function visibleLength(s: string): number {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '')
  let len = 0
  for (const ch of stripped) {
    const cp = ch.codePointAt(0) ?? 0
    // Emoji and CJK characters are 2 columns wide
    len += cp > 0x2e7f ? 2 : 1
  }
  return len
}

export function box(lines: string[]): string {
  const maxVis = Math.max(...lines.map(visibleLength))
  const innerWidth = maxVis + 4 // 2 padding on each side for the longest line

  const top = `╔${'═'.repeat(innerWidth)}╗`
  const bottom = `╚${'═'.repeat(innerWidth)}╝`

  const middle = lines.map((l) => {
    const vis = visibleLength(l)
    const totalPad = innerWidth - vis
    const leftPad = Math.floor(totalPad / 2)
    const rightPad = totalPad - leftPad
    return `║${' '.repeat(leftPad)}${l}${' '.repeat(rightPad)}║`
  })

  return [top, ...middle, bottom].join('\n')
}

export function stepHeader(
  n: number | string,
  total: number,
  emoji: string,
  title: string,
): string {
  const r = rule()
  const label = `  [${n}/${total}]  ${emoji}  ${title}`
  return `\n${r}\n${label}\n${r}\n`
}

export function statusLine(icon: string, label: string, value?: string): string {
  const v = value ? `   ${value}` : ''
  return `  ${icon}  ${label}${v}`
}

export function indent(s: string, n = 2): string {
  const pad = ' '.repeat(n)
  return s
    .split('\n')
    .map((line) => pad + line)
    .join('\n')
}
