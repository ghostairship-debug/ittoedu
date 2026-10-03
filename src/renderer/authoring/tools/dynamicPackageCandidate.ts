import { z } from 'zod'
import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'

export const dynamicPackageFilesSchema = z.record(z.string().min(1).max(500), z.union([
  z.string().refine(value => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'base64 素材字节无效'),
  z.object({ encoding: z.literal('utf8'), text: z.string() }).strict(),
]))

export function decodeDynamicPackageFiles(files: z.infer<typeof dynamicPackageFilesSchema>) {
  const entries = Object.entries(dynamicPackageFilesSchema.parse(files))
  const decoded = entries.map(([path, data]) => {
    const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), char => char.charCodeAt(0)) : new TextEncoder().encode(data.text)
    return [path, bytes] as const
  })
  return Object.fromEntries(decoded)
}

export function parseDecodedDynamicPackageCandidate(files: Readonly<Record<string, Uint8Array>>) {
  const entries = Object.values(files)
  if (!entries.length) throw new Error('组件候选不能为空')
  return parseComponentPackageFiles(files)
}

export function parseDynamicPackageCandidate(files: z.infer<typeof dynamicPackageFilesSchema>) {
  return parseDecodedDynamicPackageCandidate(decodeDynamicPackageFiles(files))
}
