/** Bound a single frame and unfinished buffer, never cumulative consumed stream bytes. */
export async function* serverSentEvents(body: ReadableStream<Uint8Array>, maxBytes: number, onActivity?: () => void): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending: string[] = [], pendingBytes = 0, pendingCR = false
  let data: string[] = [], eventBytes = 0, first = true
  const line = (value: string): string | undefined => {
    if (first) { value = value.replace(/^\uFEFF/, ''); first = false }
    if (value === '') { const result = data.length ? data.join('\n') : undefined; data = []; eventBytes = 0; if (result !== undefined) onActivity?.(); return result }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('response-too-large')
    if (value.startsWith(':')) { onActivity?.(); return }
    const colon = value.indexOf(':')
    const field = colon < 0 ? value : value.slice(0, colon)
    let text = colon < 0 ? '' : value.slice(colon + 1)
    if (text.startsWith(' ')) text = text.slice(1)
    if (field === 'data') {
      eventBytes += Buffer.byteLength(text, 'utf8') + (data.length ? 1 : 0)
      if (eventBytes > maxBytes) throw new Error('response-too-large')
      data.push(text)
    }
  }
  const append = (value: string) => {
    if (value) { pending.push(value); pendingBytes += Buffer.byteLength(value, 'utf8') }
  }
  const finishLine = () => {
    const value = pending.join('')
    pending = []; pendingBytes = 0
    return line(value)
  }
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) { append(decoder.decode()); break }
      const text = decoder.decode(chunk.value, { stream: true })
      let start = 0
      if (pendingCR && text.length) {
        pendingCR = false
        start = text[0] === '\n' ? 1 : 0
        const event = finishLine()
        if (event !== undefined) yield event
      }
      // Scan only newly decoded text. An unfinished line is joined once at its
      // delimiter, rather than copied and rescanned for every network fragment.
      const endings = /[\r\n]/g
      endings.lastIndex = start
      for (let match = endings.exec(text); match; match = endings.exec(text)) {
        const index = match.index
        append(text.slice(start, index))
        if (text[index] === '\r' && index === text.length - 1) { pendingCR = true; start = text.length; break }
        start = index + (text[index] === '\r' && text[index + 1] === '\n' ? 2 : 1)
        endings.lastIndex = start
        const event = finishLine()
        if (event !== undefined) yield event
      }
      append(text.slice(start))
      if (pendingBytes + (pendingCR ? 1 : 0) + eventBytes > maxBytes) throw new Error('response-too-large')
    }
    // EOF does not dispatch an unterminated event. Provider requires a framed [DONE].
    if (pendingCR) {
      const event = finishLine()
      if (event !== undefined) yield event
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
