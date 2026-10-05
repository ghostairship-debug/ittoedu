// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { readCatalogComponentPackage, scanComponentCatalogDirectory } from '../../src/main/componentCatalogScanner'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'

it('keeps usable archives with invalid optional catalog/archive metadata, preserving core failures and valid enrichment', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-l0-optional-catalog-'))
  const entry: ComponentLibraryEntry = { schemaVersion: 1, id: 'card', title: '可编辑卡片',
    definitions: { card: { id: 'card', role: 'content', version: '1.0.0', implementation: { kind: 'builtin', key: 'fixture' } } },
    example: { rootIds: ['card'], instances: { card: { id: 'card', definitionId: 'card', data: { title: '保持正文' } } } },
    assets: {}, resources: { assets: {}, components: {} } }
  try {
    const archive = exportComponentLibraryArchive(entry, '1.0.0', { description: '包内说明' })
    await fs.writeFile(path.join(root, 'good.h5component'), archive)
    const optionalEntry = { ...entry, id: 'optional-card' }
    const optionalFiles = unzipSync(exportComponentLibraryArchive(optionalEntry, '1.0.0', {
      description: '将被损坏的说明', subject: ['科学'], schoolStage: ['小学'], tags: ['卡片'], sourceCourse: '原课件',
    }))
    const optionalManifest = JSON.parse(strFromU8(optionalFiles['manifest.json']))
    optionalManifest.metadata.description = 42
    optionalFiles['manifest.json'] = strToU8(JSON.stringify(optionalManifest))
    await fs.writeFile(path.join(root, 'bad-optional.h5component'), zipSync(optionalFiles))
    await fs.writeFile(path.join(root, 'broken.h5component'), strToU8('broken archive'))
    const missingFiles = unzipSync(archive), manifest = JSON.parse(strFromU8(missingFiles['manifest.json']))
    manifest.resources.assets.missing = 'assets/missing.png'
    missingFiles['manifest.json'] = strToU8(JSON.stringify(manifest))
    await fs.writeFile(path.join(root, 'missing-resource.h5component'), zipSync(missingFiles))
    for (const metadata of [undefined, null, { packages: [null] }, { name: '目录说明', packages: [null,
      { packageId: 'card', version: '1.0.0', description: '合法条目说明' }] }]) {
      const catalog = path.join(root, 'catalog.json')
      if (metadata === undefined) await fs.rm(catalog, { force: true })
      else await fs.writeFile(catalog, JSON.stringify(metadata))
      const scanned = await scanComponentCatalogDirectory(root, 'trusted')
      expect(scanned.source.packageCount).toBe(2)
      expect(scanned.packages.find(pkg => pkg.packageId === 'card')).toMatchObject({ packageId: 'card', name: '可编辑卡片', runtimeApiVersion: 5,
        description: metadata && 'name' in metadata ? '合法条目说明' : '包内说明' })
      const file = await readCatalogComponentPackage(scanned, 'card', '1.0.0')
      expect(importComponentLibraryArchive(file.bytes).entry).toEqual(entry)
      expect(scanned.packages.find(pkg => pkg.packageId === 'optional-card')).toMatchObject({ runtimeApiVersion: 5,
        subject: ['科学'], schoolStage: ['小学'], tags: ['卡片'], source: { kind: 'local', reference: '原课件' } })
      const optionalFile = await readCatalogComponentPackage(scanned, 'optional-card', '1.0.0')
      const imported = importComponentLibraryArchive(optionalFile.bytes)
      expect(imported.entry).toEqual(optionalEntry)
      expect(imported.metadata).toEqual({ subject: ['科学'], schoolStage: ['小学'], tags: ['卡片'], sourceCourse: '原课件' })
      expect(imported.diagnostics).toEqual([{ code: 'metadata-invalid', message: expect.stringContaining('metadata.description') }])
      expect(scanned.issues.find(issue => issue.packageId === 'optional-card')).toMatchObject({ code: 'catalog-invalid', message: expect.stringContaining('metadata.description') })
      expect(scanned.issues.filter(issue => issue.code === 'catalog-invalid')).toHaveLength(metadata === undefined ? 1 : 2)
      expect(scanned.issues.filter(issue => issue.code === 'package-unreadable')).toHaveLength(2)
      expect(scanned.issues.find(issue => issue.message.includes('missing-resource.h5component'))?.message).toContain('组件资源缺失')
    }
  } finally {
    const resolved = path.resolve(root), parent = path.resolve(os.tmpdir())
    if (path.dirname(resolved) !== parent) throw new Error('Expected a direct temporary fixture directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
