import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { componentCatalogSchema } from '@/shared/componentCatalog'
import {
  readCatalogComponentPackage,
  scanComponentCatalogDirectory,
} from '@/main/componentCatalogScanner'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()))) {
      throw new Error(`拒绝删除非临时目录：${resolved}`)
    }
    await fs.rm(resolved, { recursive: true, force: true })
  }))
})

function catalogPackage(sha256 = '0'.repeat(64)) {
  return {
    packageId: 'com.example.catalog-card',
    version: '1.0.0',
    name: '目录卡片',
    description: '用于验证组件目录的测试卡片',
    subject: [],
    schoolStage: [],
    tags: ['test'],
    category: '测试',
    packagePath: 'packages/catalog-card.h5component',
    thumbnailPath: 'thumbnails/catalog-card.svg',
    sha256,
    componentSchemaVersion: 4 as const,
    runtimeApiVersion: 4 as const,
    renderMode: 'dom' as const,
    supportedScopes: ['scene'] as const,
    quality: 'experimental' as const,
    maintainer: 'unassigned',
    verifiedCases: [],
    license: { status: 'unknown' as const },
    releaseBlockers: ['license-unverified'],
  }
}

describe('Component Catalog V1', () => {
  it('接受 API4 experimental 并禁止未授权条目升级为 stable', () => {
    const experimental = componentCatalogSchema.safeParse({
      catalogVersion: 1,
      name: '测试目录',
      packages: [catalogPackage()],
    })
    expect(experimental.success).toBe(true)

    const stable = componentCatalogSchema.safeParse({
      catalogVersion: 1,
      packages: [{ ...catalogPackage(), quality: 'stable' }],
    })
    expect(stable.success).toBe(false)
  })

  it('accepts a catalog above the old package count and preserves unique package identities', () => {
    const packages = Array.from({ length: 2_001 }, (_, index) => ({ ...catalogPackage(),
      packageId: `com.example.card-${index}`, packagePath: `packages/card-${index}.h5component` }))
    const catalog = componentCatalogSchema.parse({ catalogVersion: 1, packages })
    expect(catalog.packages).toHaveLength(2_001)
    expect(catalog.packages.at(-1)?.packageId).toBe('com.example.card-2000')
    expect(componentCatalogSchema.safeParse({ catalogVersion: 1, packages: [...packages, packages[0]] }).success).toBe(false)
  })

  it('禁止目录路径逃离来源根目录', () => {
    const result = componentCatalogSchema.safeParse({
      catalogVersion: 1,
      packages: [{ ...catalogPackage(), packagePath: '../outside.h5component' }],
    })
    expect(result.success).toBe(false)
  })

  it('拒绝会破坏更新排序的非标准语义化版本', () => {
    for (const version of ['01.0.0', '1.0.0-.', '1.0.0-beta..1']) {
      const result = componentCatalogSchema.safeParse({
        catalogVersion: 1,
        packages: [{ ...catalogPackage(), version }],
      })
      expect(result.success, version).toBe(false)
    }
  })

  it('扫描时校验哈希，使用时再次校验并读取精确包字节', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-catalog-'))
    temporaryRoots.push(root)
    await fs.mkdir(path.join(root, 'packages'), { recursive: true })
    await fs.mkdir(path.join(root, 'thumbnails'), { recursive: true })
    const packageBytes = new TextEncoder().encode('not-executed-test-package')
    const sha256 = createHash('sha256').update(packageBytes).digest('hex')
    await fs.writeFile(path.join(root, 'packages', 'catalog-card.h5component'), packageBytes)
    await fs.writeFile(
      path.join(root, 'thumbnails', 'catalog-card.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'utf8',
    )
    await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify({
      catalogVersion: 1,
      name: '测试目录',
      packages: [catalogPackage(sha256)],
    }), 'utf8')

    const scanned = await scanComponentCatalogDirectory(root, 'prompt')
    expect(scanned.source).toMatchObject({
      label: '测试目录',
      trust: 'prompt',
      packageCount: 1,
    })
    expect(scanned.packages[0]).toMatchObject({
      packageId: 'com.example.catalog-card',
      sha256,
      sourceTrust: 'prompt',
    })
    expect(scanned.packages[0]?.thumbnailDataUrl).toMatch(/^data:image\/svg\+xml;base64,/)

    const loaded = await readCatalogComponentPackage(
      scanned,
      'com.example.catalog-card',
      '1.0.0',
    )
    expect(loaded.sha256).toBe(sha256)
    expect([...loaded.bytes]).toEqual([...packageBytes])

    await fs.writeFile(
      path.join(root, 'packages', 'catalog-card.h5component'),
      'changed-after-scan',
      'utf8',
    )
    await expect(readCatalogComponentPackage(
      scanned,
      'com.example.catalog-card',
      '1.0.0',
    )).rejects.toThrow('SHA-256')
  })

  it('reads real catalog, package and thumbnail files above the former byte ceilings', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-catalog-'))
    temporaryRoots.push(root)
    await fs.mkdir(path.join(root, 'packages'))
    await fs.mkdir(path.join(root, 'thumbnails'))
    const bytes = Buffer.alloc(50 * 1024 * 1024 + 1, 120)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await fs.writeFile(path.join(root, 'packages/catalog-card.h5component'), bytes)
    await fs.writeFile(path.join(root, 'thumbnails/catalog-card.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(5 * 1024 * 1024)}--></svg>`)
    await fs.writeFile(path.join(root, 'catalog.json'), JSON.stringify({ catalogVersion: 1, packages: [catalogPackage(sha256)] }) + ' '.repeat(2 * 1024 * 1024))
    const scanned = await scanComponentCatalogDirectory(root, 'trusted')
    expect(scanned.issues).toEqual([])
    expect(scanned.packages).toHaveLength(1)
    expect(scanned.packages[0]?.thumbnailDataUrl?.length).toBeGreaterThan(5 * 1024 * 1024)
    const loaded = await readCatalogComponentPackage(scanned, 'com.example.catalog-card', '1.0.0')
    expect(loaded.bytes.length).toBe(bytes.length)
    expect(loaded.sha256).toBe(sha256)
  })
})
