const sensitiveKey = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|credential(?:ref)?)$/i
const assignmentName = '(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)'
const assignmentValue = new RegExp(`(${assignmentName}\\s*[:=]\\s*)[^\\s,;]+`, 'gi')
const unfinishedAssignment = new RegExp(`${assignmentName}\\s*(?:[:=]\\s*)?$`, 'i')
export function redactExecutionString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[凭据已隐藏]')
    .replace(assignmentValue, '$1[已隐藏]')
    .replace(/\b[A-Za-z]:[\\/](?:[^\s"<>|]+[\\/])*([^\\/\s"<>|]+)/g, '[本地路径]/$1')
    .replace(/\/(?:Users|home)\/[^\s"<>]+/g, '[本地路径]')
}
/** Same display semantics in Main windows and local views; never a business receipt. */
export function readableExecutionText(value: string): string {
  const redact = (input: unknown): unknown => {
    if (typeof input === 'string') return redactExecutionString(input)
    if (Array.isArray(input)) return input.map(redact)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, sensitiveKey.test(key) ? '[已隐藏]' : redact(child)]))
    return input
  }
  try { return JSON.stringify(redact(JSON.parse(value)), null, 2) }
  catch { return redactExecutionString(value) }
}

/** Only irreversible plain text uses this display-only append path. Potential JSON
 * keeps the complete parser/redactor above. No old body or safe full text is retained. */
export class ExecutionPlainTextWindow {
  readonly limit: number
  private pending: string
  private stableLength = 0
  private prefix = ''
  private tail: { text: string; total: number } | undefined
  static accepts(value: string): boolean {
    const first = /\S/u.exec(value)?.[0]
    return first !== undefined && !/[\[\{"\-0-9tfn]/.test(first)
  }
  constructor(value: string, limit: number) {
    this.limit = limit; this.pending = value; this.consume()
  }
  append(value: string): void { this.pending += value; this.tail = undefined; this.consume() }
  private consume(): void {
    let boundary = 0
    for (const match of this.pending.matchAll(/\s/gu)) boundary = match.index! + match[0].length
    if (!boundary) return
    // Both expressions come directly from rules that can span whitespace in the
    // existing redactor. Recheck after pulling back: secret=Bearer <space> must
    // retain both prefixes so the ordered replacement passes still agree.
    for (;;) {
      const closed = this.pending.slice(0, boundary)
      const bearer = /\bBearer\s+$/i.exec(closed), assignment = unfinishedAssignment.exec(closed)
      let next = Math.min(boundary, bearer?.index ?? boundary, assignment?.index ?? boundary)
      if (next === boundary) break
      // A matching key can be a suffix inside another secret/path token. Pull
      // that entire token into the tail before rerunning the ordered rules.
      while (next > 0 && !/\s/u.test(this.pending[next - 1]!)) next--
      boundary = next
    }
    if (!boundary) return
    const safe = redactExecutionString(this.pending.slice(0, boundary))
    this.stableLength += safe.length
    if (this.prefix.length < this.limit) this.prefix += safe.slice(0, this.limit - this.prefix.length).split('').join('')
    this.pending = this.pending.slice(boundary); this.tail = undefined
  }
  page(): { text: string; total: number } {
    if (!this.tail) {
      const safe = redactExecutionString(this.pending)
      this.tail = { text: safe.slice(0, Math.max(0, this.limit - this.prefix.length)).split('').join(''), total: safe.length }
    }
    return { text: this.prefix + this.tail.text, total: this.stableLength + this.tail.total }
  }
}
