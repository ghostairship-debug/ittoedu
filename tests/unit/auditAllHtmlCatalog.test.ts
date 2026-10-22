// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { readCatalogComponentPackage, scanComponentCatalogDirectory } from '../../src/main/componentCatalogScanner'
import { selectCurrentCatalogPackages, collectComponentLibrarySubjects } from '../../src/renderer/components/componentLibraryModel'
import { compareSemanticVersions } from '../../src/renderer/components/componentCatalogStatus'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'

function entry(title: string): ComponentLibraryEntry {
  return { schemaVersion: 2, id: 'demo.component', title,
    definitions: { demo: { id: 'demo', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } } },
    example: { rootIds: ['example'], instances: { example: { id: 'example', definitionId: 'demo', data: {} } } }, assets: {}, resources: { assets: {}, components: {} } }
}
describe('R49 catalog records', () => {
  it('CA323 diagnoses one malformed optional field and keeps the package and UI helper usable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'audit-catalog-'))
    try {
      await writeFile(path.join(root, 'demo.h5component'), exportComponentLibraryArchive(entry('健康组件')))
      await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ packages: [{ packageId: 'demo.component', version: '1.0.0', subject: '数学' }] }))
      const result = await scanComponentCatalogDirectory(root, 'trusted')
      expect(result.packages).toHaveLength(1); expect(result.packages[0].subject).toEqual([])
      expect(result.issues.some(issue => issue.message.includes('catalog.subject'))).toBe(true)
      expect(collectComponentLibrarySubjects(result.packages)).toEqual(['通用组件'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('CA324 presents and reads the same concrete record for a repeated package version', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'audit-catalog-'))
    try {
      await writeFile(path.join(root, 'a.h5component'), exportComponentLibraryArchive(entry('甲')))
      await writeFile(path.join(root, 'b.h5component'), exportComponentLibraryArchive(entry('乙')))
      const result = await scanComponentCatalogDirectory(root, 'trusted'), [selected] = selectCurrentCatalogPackages(result.packages)
      const read = await readCatalogComponentPackage(result, selected.packageId, selected.version)
      expect(importComponentLibraryArchive(read.bytes).entry.title).toBe(selected.name)
      expect(result.issues.some(issue => issue.message.includes('同一组件版本'))).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('CA351 ignores build metadata in actual semantic version precedence', () => {
    expect(compareSemanticVersions('2.0.0+build.7', '10.0.0')).toBe(-1)
    expect(compareSemanticVersions('10.0.0+one', '10.0.0+two')).toBe(0)
    expect(compareSemanticVersions('10.0.0-beta.2+build', '10.0.0-beta.10')).toBe(-1)
  })
})
