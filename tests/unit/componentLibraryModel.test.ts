import { describe, expect, it } from 'vitest'
import type { AvailableComponentCatalogPackage } from '@/shared/componentCatalog'
import type { ComponentDefinition } from '@/shared/contracts/component-platform/project'
import { compareSemanticVersions } from '@/renderer/components/componentCatalogStatus'
import {
  BUILT_IN_COMPONENT_CATALOG_SHA256,
  trustForManagedCatalogDigest,
} from '@/shared/builtInComponentCatalog'
import {
  componentCatalogInstallStatus,
  collectComponentLibrarySubjects,
  filterComponentLibraryPackages,
  GENERAL_COMPONENT_SUBJECT,
  planCatalogBatchJoin,
  selectAvailableBuiltInCatalogPackages,
  selectCurrentCatalogPackages,
} from '@/renderer/components/componentLibraryModel'

function catalogEntry(
  index: number,
  patch: Partial<AvailableComponentCatalogPackage> = {},
): AvailableComponentCatalogPackage {
  return {
    packageId: `com.example.component-${index}`,
    version: '1.0.0',
    name: `组件 ${index}`,
    description: `第 ${index} 个组件`,
    subject: [],
    schoolStage: ['小学'],
    tags: [`tag-${index}`],
    category: '课堂工具',
    packagePath: `packages/component-${index}.h5component`,
    thumbnailPath: `thumbnails/component-${index}.svg`,
    sha256: index.toString(16).padStart(64, '0'),
    componentSchemaVersion: 1,
    runtimeApiVersion: 5,
    renderMode: 'dom',
    supportedScopes: ['scene'],
    quality: 'experimental',
    maintainer: 'test',
    verifiedCases: [],
    sourceId: 'source:test',
    sourceLabel: '测试组件库',
    sourceTrust: 'built-in',
    ...patch,
  }
}

function embeddedPackage(entry: AvailableComponentCatalogPackage): ComponentDefinition {
  return { id: entry.packageId, title: entry.name, version: entry.version, role: 'content',
    implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
}

describe('component library model', () => {
  it('derives ordered common and subject categories from a 100-package catalog', () => {
    const subjects = [[], ['语文'], ['数学'], ['英语'], ['物理'], ['地理']]
    const entries = Array.from({ length: 100 }, (_, index) =>
      catalogEntry(index, { subject: subjects[index % subjects.length]! }),
    )

    expect(selectCurrentCatalogPackages(entries)).toHaveLength(100)
    expect(collectComponentLibrarySubjects(entries)).toEqual([
      GENERAL_COMPONENT_SUBJECT,
      '语文',
      '数学',
      '英语',
      '物理',
      '地理',
    ])
  })

  it('shows only the current package card and prefers reviewed source trust on ties', () => {
    const older = catalogEntry(1, { version: '1.0.0', sourceTrust: 'built-in' })
    const promptCurrent = catalogEntry(1, { version: '2.0.0', sourceTrust: 'prompt' })
    const builtInCurrent = catalogEntry(1, {
      version: '2.0.0',
      sourceId: 'source:official',
      sourceTrust: 'built-in',
    })

    expect(compareSemanticVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareSemanticVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0)
    expect(compareSemanticVersions('2.0.0-beta.10', '2.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareSemanticVersions('2.0.0-2', '2.0.0-alpha')).toBeLessThan(0)
    expect(compareSemanticVersions('1.0.0', '1.0.0')).toBe(0)
    expect(componentCatalogInstallStatus(older)).toBe('available')
    expect(componentCatalogInstallStatus(older, embeddedPackage(older))).toBe('embedded')
    expect(componentCatalogInstallStatus(builtInCurrent, embeddedPackage(older))).toBe('update-available')
    expect(componentCatalogInstallStatus(older, embeddedPackage(builtInCurrent))).toBe('embedded-newer')
    expect(selectCurrentCatalogPackages([older, promptCurrent, builtInCurrent]))
      .toEqual([builtInCurrent])
  })

  it('offers only current, unembedded built-in packages in the Flow insert menu', () => {
    const older = catalogEntry(1, { version: '1.0.0' })
    const current = catalogEntry(1, { version: '2.0.0' })
    const prompt = catalogEntry(2, { sourceTrust: 'prompt' })
    const trusted = catalogEntry(3, { sourceTrust: 'trusted' })
    const embedded = catalogEntry(4)
    const updateAvailable = catalogEntry(5, { version: '2.0.0' })
    const hashConflict = catalogEntry(6)
    const available = catalogEntry(7)
    const components = {
      [embedded.packageId]: embeddedPackage(embedded),
      [updateAvailable.packageId]: embeddedPackage(catalogEntry(5, { version: '1.0.0' })),
      [hashConflict.packageId]: embeddedPackage(catalogEntry(6, { sha256: 'f'.repeat(64) })),
    }

    expect(selectAvailableBuiltInCatalogPackages(
      [older, prompt, embedded, updateAvailable, hashConflict, available, current, trusted],
      components,
    )).toEqual([current, available])
    expect(selectAvailableBuiltInCatalogPackages([], components)).toEqual([])
  })

  it('filters by dynamic subject, stage, purpose, name, description, and tags', () => {
    const entries = [
      catalogEntry(1, {
        name: '拼音标注',
        description: '为课文标注拼音',
        subject: ['语文'],
        schoolStage: ['小学'],
        category: '文本标注',
        tags: ['拼音', '朗读'],
      }),
      catalogEntry(2, {
        name: '函数图像',
        subject: ['数学'],
        schoolStage: ['高中'],
        category: '函数',
      }),
    ]

    expect(filterComponentLibraryPackages(entries, {
      query: '朗读',
      subject: '语文',
      schoolStage: '小学',
      category: '文本标注',
    })).toEqual([entries[0]])
    expect(filterComponentLibraryPackages(entries, {
      query: '课文',
      subject: '数学',
      schoolStage: '',
      category: '',
    })).toEqual([])
  })

  it('checks trust only for packages that are not already embedded', () => {
    const prompt = catalogEntry(1, { sourceTrust: 'prompt' })
    const builtIn = catalogEntry(2, { sourceTrust: 'built-in' })

    expect(planCatalogBatchJoin([prompt], {
      [prompt.packageId]: embeddedPackage(prompt),
    })).toEqual({ entries: [], requiresTrustConfirmation: false })
    expect(planCatalogBatchJoin([builtIn], {})).toEqual({
      entries: [builtIn],
      requiresTrustConfirmation: false,
    })
    expect(planCatalogBatchJoin([prompt], {})).toEqual({
      entries: [prompt],
      requiresTrustConfirmation: true,
    })
  })
})

describe('built-in component catalog trust', () => {
  it('grants built-in trust only to the reviewed catalog digest', () => {
    expect(trustForManagedCatalogDigest(BUILT_IN_COMPONENT_CATALOG_SHA256))
      .toBe('built-in')
    expect(trustForManagedCatalogDigest(BUILT_IN_COMPONENT_CATALOG_SHA256.toUpperCase()))
      .toBe('built-in')
    expect(trustForManagedCatalogDigest('0'.repeat(64))).toBe('prompt')
  })
})
