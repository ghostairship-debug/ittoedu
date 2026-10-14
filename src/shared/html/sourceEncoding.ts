/** Decode portable source bytes while keeping the original bytes with their owner. */
export function decodeHtmlSource(bytes: Uint8Array, html = true): { text: string; notices: string[] } {
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096))
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
    : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8'
    : html ? /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(prefix)?.[1] ?? 'utf-8' : 'utf-8'
  const notices: string[] = []
  let decoder: TextDecoder
  try { decoder = new TextDecoder(encoding) }
  catch { decoder = new TextDecoder('utf-8'); notices.push(`源文件声明的 ${encoding} 编码不可用，按 UTF-8 读取；原始字节已保留`) }
  const text = decoder.decode(bytes)
  if (text.includes('\uFFFD')) notices.push('部分源文字无法解码，已保留其余内容与原始字节，请核对这些字符')
  return { text, notices }
}
