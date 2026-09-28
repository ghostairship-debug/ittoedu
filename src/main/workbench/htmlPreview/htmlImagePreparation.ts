import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { HTML_PREVIEW_IMAGE_MAX_BYTES } from '../../../shared/workbench/htmlPreview'
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
      if (/<svg(?:\s|>)/i.test(source.slice(0, 64 * 1024))) return '.svg'
    } catch { /* Invalid UTF-8 is not a valid selected SVG. */ }
  }
  return null
}

const mimeForExtension: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

/** Write real selected bytes durably before the document transaction. Never follows an existing symlink. */
export async function prepareHtmlImage(input: {
  entryRealPath: string
  rootRealPath: string
  operationId: string
  name: string
  mimeType: string
  bytes: Uint8Array
}): Promise<PreparedHtmlImage> {
  const { bytes, rootRealPath, entryRealPath } = input
  if (!bytes.length || bytes.length > HTML_PREVIEW_IMAGE_MAX_BYTES) throw new Error('图片大小不受支持')
  const extension = actualExtension(bytes, input.mimeType.toLowerCase())
  if (!extension || mimeForExtension[extension] !== input.mimeType.toLowerCase()) throw new Error('图片格式与实际字节不符')
  if (!isContainedPath(rootRealPath, entryRealPath) || await fs.realpath(entryRealPath) !== entryRealPath) throw new Error('HTML 文件路径已变化')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(input.operationId) || input.operationId.includes('..')) throw new Error('操作标识无效')
  if (!input.name || input.name.length > 200) throw new Error('图片名称无效')
  const folder = path.join(path.dirname(entryRealPath), `${path.parse(entryRealPath).name}.assets`)
  if (!isContainedPath(rootRealPath, folder)) throw new Error('图片目录越界')
  try {
    const item = await fs.lstat(folder)
    if (!item.isDirectory() || item.isSymbolicLink() || await fs.realpath(folder) !== folder) throw new Error('图片目录不是安全的实体文件夹')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.mkdir(folder)
  }
  const filename = path.join(folder, `image-${input.operationId}${extension}`)
  const relativeUrl = `${encodeURIComponent(path.basename(folder))}/${encodeURIComponent(path.basename(filename))}`
  let created = false
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filename, 'wx')
    created = true
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      if (created) {
        await handle?.close().catch(() => {})
        handle = null
        await fs.unlink(filename).catch(() => {})
      }
      throw error
    }
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('图片目标文件不是普通文件')
    const existing = await fs.readFile(filename)
    const a = createHash('sha256').update(bytes).digest('hex')
    const b = createHash('sha256').update(existing).digest('hex')
    if (a !== b) throw new Error('同一操作标识对应了不同图片')
  } finally { await handle?.close() }
  return { filename, relativeUrl, created }
}
