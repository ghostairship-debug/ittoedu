/** UTF-8 and SSE framing are independent of transport packet boundaries. */
export async function* serverSentEvents(body: ReadableStream<Uint8Array>, maxBytes: number): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = '', data: string[] = [], total = 0, first = true
  const line = (value: string): string | undefined => {
    if (first) { value = value.replace(/^\uFEFF/, ''); first = false }
    if (value === '') { const result = data.length ? data.join('\n') : undefined; data = []; return result }
    if (value.startsWith(':')) return
    const colon = value.indexOf(':')
    const field = colon < 0 ? value : value.slice(0, colon)
    let text = colon < 0 ? '' : value.slice(colon + 1)
    if (text.startsWith(' ')) text = text.slice(1)
    if (field === 'data') data.push(text)
  }
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) { pending += decoder.decode(); break }
      total += chunk.value.byteLength
      if (total > maxBytes) throw new Error('response-too-large')
      pending += decoder.decode(chunk.value, { stream: true })
      for (;;) {
        const match = /[\r\n]/.exec(pending)
        if (!match) break
        const index = match.index
        if (pending[index] === '\r' && index === pending.length - 1) break
        const width = pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1
        const event = line(pending.slice(0, index))
        pending = pending.slice(index + width)
        if (event !== undefined) yield event
      }
    }
    // EOF does not dispatch an unterminated event. Provider requires a framed [DONE].
    if (pending.endsWith('\r')) {
      const event = line(pending.slice(0, -1))
      if (event !== undefined) yield event
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
