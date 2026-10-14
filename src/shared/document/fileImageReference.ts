import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Resolve source Markdown images identically in the renderer and file owner. */
export function resolveFileDocumentImage(href: string) {
  const parts: string[] = []
  const pathname = href.split(/[?#]/)[0]!
  let decoded = pathname
  try { decoded = decodeURIComponent(pathname) } catch { /* Literal percent filenames remain usable. */ }
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('图示引用越出课例目录'); parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  const relativePath = parts.join('/')
  return { assetId: `file-${bytesToHex(sha256(new TextEncoder().encode(relativePath)))}`, source: { kind: 'relative' as const, path: relativePath } }
}
