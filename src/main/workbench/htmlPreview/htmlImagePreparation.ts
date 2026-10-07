import { promises as fs } from 'node:fs'
import { isContainedPath } from './htmlPreviewProtocol'

export interface PreparedHtmlImage { filename: string; relativeUrl: string; created: boolean }

function actualExtension(bytes: Uint8Array, mimeType: string): '.png' | '.jpg' | '.gif' | '.webp' | '.svg' | null {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))) return '.gif'
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return '.webp'
  if (mimeType === 'image/svg+xml') {
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
      if (/<svg(?:\s|>)/i.test(source)) return '.svg'
    } catch { /* Invalid UTF-8 is not a valid selected SVG. */ }
  }
  return null
}

const mimeForExtension: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

/** Validate selected image bytes and carry them in the HTML's own save transaction. */
export async function prepareHtmlImage(input: {
  entryRealPath: string
  rootRealPath: string
  operationId: string
  name: string
  mimeType: string
  bytes: Uint8Array
}): Promise<PreparedHtmlImage> {
  const { bytes, rootRealPath, entryRealPath } = input
  if (!bytes.length) throw new Error('图片不能为空')
  const extension = actualExtension(bytes, input.mimeType.toLowerCase())
  if (!extension || mimeForExtension[extension] !== input.mimeType.toLowerCase()) throw new Error('图片格式与实际字节不符')
  if (!isContainedPath(rootRealPath, entryRealPath) || await fs.realpath(entryRealPath) !== entryRealPath) throw new Error('HTML 文件路径已变化')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(input.operationId) || input.operationId.includes('..')) throw new Error('操作标识无效')
  if (!input.name) throw new Error('图片名称无效')
  // The normal UTF-8 save and SaveAs paths carry the selected bytes with the HTML.
  return { filename: '', relativeUrl: `data:${input.mimeType.toLowerCase()};base64,${Buffer.from(bytes).toString('base64')}`, created: false }
}
