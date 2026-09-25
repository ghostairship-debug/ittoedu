import type { DocumentFileRef, DocumentFileVersion, OpenDocumentResult } from '../document/ports'
import type { DocumentSnapshot } from './document'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Content identity remains stable across reopening. Host epoch/revision separately enforce CAS. */
export function markdownSnapshotVersion(snapshot: Pick<DocumentSnapshot, 'model'>): DocumentFileVersion {
  if (snapshot.model.kind !== 'markdown') throw new Error('目标不是 Markdown 文档')
  const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
  const text = (source: string) => new TextEncoder().encode(source)
  const attachments = Object.entries(snapshot.model.resources.assets).map(([relativePath, bytes]) => ({ relativePath, contentVersion: hash(bytes) }))
  for (const [relativePath, files] of Object.entries(snapshot.model.resources.components)) attachments.push({ relativePath,
    contentVersion: hash(text(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])))) })
  return { contentVersion: hash(text(snapshot.model.source)), attachments: attachments.sort((a, b) => a.relativePath.localeCompare(b.relativePath)) }
}

export function markdownSnapshotDocument(ref: DocumentFileRef, snapshot: DocumentSnapshot): OpenDocumentResult {
  if (snapshot.model.kind !== 'markdown') throw new Error('目标不是 Markdown 文档')
  return { ref, source: snapshot.model.source, version: markdownSnapshotVersion(snapshot), diagnostics: [] }
}

export function markdownRefPath(ref: DocumentFileRef): string {
  return ref.kind === 'file' ? ref.path : `${ref.lessonDirectory.replace(/[\\/]$/, '')}/${ref.relativePath}`
}
