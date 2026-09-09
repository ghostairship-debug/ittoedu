import { z } from 'zod'
import { parseComponentPackageFiles } from '../../components/importComponentPackage'

export const dynamicPackageFilesSchema = z.record(z.string().min(1).max(500), z.union([
  z.string().max(24_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  z.object({ encoding: z.literal('utf8'), text: z.string().max(18_000_000) }).strict(),
]))

export function decodeDynamicPackageFiles(files: z.infer<typeof dynamicPackageFilesSchema>) {
  const entries = Object.entries(dynamicPackageFilesSchema.parse(files))
  if (entries.length > 512) throw new Error('组件候选超过文件数量或资源上限')
  let totalBytes = 0
  const decoded = entries.map(([path, data]) => {
    const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), char => char.charCodeAt(0)) : new TextEncoder().encode(data.text)
    totalBytes += bytes.byteLength
    if (totalBytes > 18_000_000) throw new Error('组件候选超过文件数量或资源上限')
    return [path, bytes] as const
  })
  return Object.fromEntries(decoded)
}

export function parseDecodedDynamicPackageCandidate(files: Readonly<Record<string, Uint8Array>>) {
  const entries = Object.values(files)
  if (!entries.length || entries.length > 512 || entries.reduce((sum, bytes) => sum + bytes.byteLength, 0) > 18_000_000) throw new Error('组件候选超过文件数量或资源上限')
  return parseComponentPackageFiles(files)
}

export function parseDynamicPackageCandidate(files: z.infer<typeof dynamicPackageFilesSchema>) {
  return parseDecodedDynamicPackageCandidate(decodeDynamicPackageFiles(files))
}
