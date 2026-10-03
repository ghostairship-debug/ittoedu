// @vitest-environment node
import { expect, it } from 'vitest'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { decodeDynamicPackageFiles, dynamicPackageFilesSchema, parseDynamicPackageCandidate } from '../../src/renderer/authoring/tools/dynamicPackageCandidate'

it('accepts large component source/base64 while preserving exact encoding validation', () => {
  const source = 'x'.repeat(18_000_001)
  const base64 = 'AAAA'.repeat(6_000_001)
  expect(dynamicPackageFilesSchema.safeParse({ 'large.js': { encoding: 'utf8', text: source }, 'large.bin': base64 }).success).toBe(true)
  for (const value of ['A', 'AA=', 'AAAA=', 'AA===', 'AAAA?', 'AAAA\n', '=AAA']) {
    expect(dynamicPackageFilesSchema.safeParse({ 'bad.bin': value }).success, value).toBe(false)
  }
  expect(decodeDynamicPackageFiles({ 'one.bin': 'YQ==', 'two.bin': 'YWI=' })).toEqual({
    'one.bin': new Uint8Array([97]), 'two.bin': new Uint8Array([97, 98]),
  })
})

it('parses a real component candidate above the former file count and total byte limits', () => {
  const pkg = createDefaultTeacherControllerPackage()
  const files = Object.fromEntries(Object.entries(pkg.files).map(([name, bytes]) => [name,
    { encoding: 'utf8' as const, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }]))
  const content = 'x'.repeat(36_000)
  for (let index = 0; index < 513; index++) files[`extras/resource-${index}.txt`] = { encoding: 'utf8', text: content }
  const parsed = parseDynamicPackageCandidate(files)
  expect(Object.keys(parsed.files).length).toBeGreaterThan(512)
  expect(Object.values(parsed.files).reduce((sum, bytes) => sum + bytes.length, 0)).toBeGreaterThan(18_000_000)
  expect(parsed.manifest.id).toBe(pkg.manifest.id)
  expect(parsed.runtimeSource).toBe(pkg.runtimeSource)
  expect(() => parseDynamicPackageCandidate({ ...files, '../escape.bin': 'YQ==' } as never)).toThrow()
})
