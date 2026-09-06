import { z } from 'zod'
import { parseComponentPackageFiles } from '../../components/importComponentPackage'

export const dynamicPackageFilesSchema = z.record(z.string().min(1).max(500), z.string().max(24_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))

export function parseDynamicPackageCandidate(files: Record<string, string>) {
  const encoded = Object.entries(files)
  if (!encoded.length || encoded.length > 512 || encoded.reduce((sum, [, data]) => sum + data.length, 0) > 24_000_000) throw new Error('组件候选超过文件数量或资源上限')
  return parseComponentPackageFiles(Object.fromEntries(encoded.map(([path, data]) => [path, Uint8Array.from(atob(data), char => char.charCodeAt(0))])))
}
