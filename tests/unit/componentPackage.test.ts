import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentManifest } from '@/shared/componentTypes'
import { UserFacingError } from '@/shared/errors'
import {
  importComponentPackage,
  parseComponentPackageFiles,
} from '@/renderer/components/importComponentPackage'
import {
  ComponentRegistry,
  executeComponentRuntime,
  tryExecuteComponentRuntime,
} from '@/renderer/components/executeComponentRuntime'
import {
  ComponentPackageStore,
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '@/renderer/components/componentPackageStore'

function manifest(overrides: Partial<ComponentManifest> = {}): ComponentManifest {
  return {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: 'com.example.counter',
    name: '示例计数器',
    version: '4.0.0',
    description: '测试组件',
    entry: 'runtime.js',
    thumbnail: 'thumbnail.png',
    defaultSize: { width: 480, height: 280 },
    minSize: { width: 160, height: 100 },
    preserveAspectRatio: true,
    assets: { icon: 'assets/icon.png' },
    defaultProps: { initialValue: 0 },
    supportedScopes: ['scene'],
    renderMode: 'phaser',
    ...overrides,
  }
}

function filesFor(
  componentManifest: ComponentManifest = manifest(),
): Record<string, Uint8Array> {
  return {
    'manifest.json': strToU8(JSON.stringify(componentManifest)),
    [componentManifest.entry]: strToU8(
      `window.CoursewareComponent.define({
        id: ${JSON.stringify(componentManifest.id)},
        runtimeApiVersion: ${componentManifest.runtimeApiVersion},
        create: function () { return { destroy: function () {} } }
      })`,
    ),
    ...(componentManifest.thumbnail === undefined
      ? {}
      : { [componentManifest.thumbnail]: new Uint8Array([137, 80, 78, 71]) }),
    'assets/icon.png': new Uint8Array([9, 8, 7, 0, 255]),
  }
}

describe('component package import', () => {
  it('unpacks and validates manifest, runtime, thumbnail, and assets', () => {
    const sourceFiles = filesFor()
    const imported = importComponentPackage(zipSync(sourceFiles))

    expect(imported.key).toBe('com.example.counter@4.0.0')
    expect(imported.manifest).toEqual(manifest())
    expect(imported.runtimeSource).toContain('CoursewareComponent.define')
    expect(imported.metadata).toEqual({
      packageId: 'com.example.counter',
      version: '4.0.0',
      name: '示例计数器',
      manifestPath: 'components/com.example.counter@4.0.0/manifest.json',
      runtimePath: 'components/com.example.counter@4.0.0/runtime.js',
      thumbnailPath: 'components/com.example.counter@4.0.0/thumbnail.png',
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    for (const [path, bytes] of Object.entries(sourceFiles)) {
      expect([...imported.files[path]!]).toEqual([...bytes])
    }
  })

  it('rejects a missing manifest and invalid required manifest fields', () => {
    expect(() =>
      importComponentPackage(
        zipSync({ 'runtime.js': strToU8('window.CoursewareComponent.define({})') }),
      ),
    ).toThrowError(
      expect.objectContaining({
        title: '组件导入失败',
        message: expect.stringContaining('manifest.json'),
      }),
    )

    const invalid = {
      ...manifest(),
      defaultSize: undefined,
    }
    expect(() =>
      importComponentPackage(
        zipSync({
          'manifest.json': strToU8(JSON.stringify(invalid)),
          'runtime.js': strToU8(''),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('manifest 校验失败'),
      }),
    )
  })

  it.each([
    {
      label: 'runtime',
      mutate: (files: Record<string, Uint8Array>) => delete files['runtime.js'],
      message: 'runtime',
    },
    {
      label: 'thumbnail',
      mutate: (files: Record<string, Uint8Array>) => delete files['thumbnail.png'],
      message: '缩略图',
    },
    {
      label: 'asset',
      mutate: (files: Record<string, Uint8Array>) => delete files['assets/icon.png'],
      message: '组件素材',
    },
  ])('rejects a declared but missing $label file', ({ mutate, message }) => {
    const files = filesFor()
    mutate(files)
    expect(() => importComponentPackage(zipSync(files))).toThrowError(
      expect.objectContaining({ message: expect.stringContaining(message) }),
    )
  })

  it('rejects ZIP traversal and manifest entry traversal paths', () => {
    const packageFiles = filesFor()
    packageFiles['../outside.js'] = new Uint8Array([1])
    expect(() => importComponentPackage(zipSync(packageFiles))).toThrowError(
      expect.objectContaining({ message: expect.stringMatching(/路径穿越|无效路径/) }),
    )

    const unsafeManifest = manifest({ entry: '../runtime.js' })
    expect(() =>
      parseComponentPackageFiles({
        'manifest.json': strToU8(JSON.stringify(unsafeManifest)),
        'runtime.js': new Uint8Array([1]),
        'thumbnail.png': new Uint8Array([1]),
        'assets/icon.png': new Uint8Array([1]),
      }),
    ).toThrowError(expect.objectContaining({ title: '组件包无效' }))
  })

  it('rejects package identity and version mismatches', () => {
    expect(() =>
      parseComponentPackageFiles(filesFor(), {
        expectedId: 'com.example.other',
      }),
    ).toThrowError(expect.objectContaining({ message: expect.stringContaining('ID 不匹配') }))

    expect(() =>
      parseComponentPackageFiles(filesFor(), {
        expectedVersion: '2.0.0',
      }),
    ).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('版本不匹配') }),
    )
  })

  it('reports unsupported higher component schema versions in Chinese', () => {
    const higher = {
      ...manifest(),
      schemaVersion: 5,
    }
    expect(() =>
      importComponentPackage(
        zipSync({
          ...filesFor(),
          'manifest.json': strToU8(JSON.stringify(higher)),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        title: '组件格式版本不支持',
        message: expect.stringContaining('版本 5'),
      }),
    )
  })

  it.each([1, 2, 3])('rejects legacy Component API %s packages', (legacyVersion) => {
    const legacy = {
      ...manifest(),
      schemaVersion: legacyVersion,
      runtimeApiVersion: legacyVersion,
    }
    expect(() => importComponentPackage(zipSync({
      ...filesFor(),
      'manifest.json': strToU8(JSON.stringify(legacy)),
    }))).toThrowError(expect.objectContaining({
      title: '旧组件格式不受支持',
    }))
  })

  it('rejects module runtimes that cannot execute offline as a plain script', () => {
    const packageFiles = filesFor()
    packageFiles['runtime.js'] = strToU8("import value from './dep.js'")
    expect(() => importComponentPackage(zipSync(packageFiles))).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('import') }),
    )
  })
})

describe('component runtime registry', () => {
  const validRuntime = `
    window.CoursewareComponent.define({
      id: 'com.example.counter',
      runtimeApiVersion: 4,
      create: function () {
        return { destroy: function () {} }
      }
    })
  `

  it('registers a matching runtime definition in a pure registry', () => {
    const registry = new ComponentRegistry()
    const definition = executeComponentRuntime(validRuntime, 'com.example.counter', {
      registry,
    })

    expect(definition.id).toBe('com.example.counter')
    expect(registry.get('com.example.counter')).toBe(definition)
    expect(registry.size).toBe(1)
  })

  it('rejects a runtime definition whose ID does not match the package', () => {
    const source = validRuntime.replace('com.example.counter', 'com.example.other')
    expect(() => executeComponentRuntime(source, 'com.example.counter')).toThrowError(
      expect.objectContaining({
        title: '组件注册失败',
        message: expect.stringContaining('ID 不匹配'),
      }),
    )
  })

  it('returns an error result instead of crashing when runtime evaluation throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = tryExecuteComponentRuntime(
      "throw new Error('boom')",
      'com.example.counter',
    )
    consoleSpy.mockRestore()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UserFacingError)
      expect(result.error.title).toBe('组件加载失败')
      expect(result.error.message).not.toContain('boom')
    }
  })

  it('does not leave a partial registry entry when code throws after define()', () => {
    const registry = new ComponentRegistry()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = tryExecuteComponentRuntime(
      `${validRuntime}\nthrow new Error('after registration')`,
      'com.example.counter',
      { registry },
    )
    consoleSpy.mockRestore()

    expect(result.ok).toBe(false)
    expect(registry.size).toBe(0)
  })

  it('rejects missing registration and duplicate registry definitions', () => {
    expect(() =>
      executeComponentRuntime('void 0', 'com.example.counter'),
    ).toThrowError(expect.objectContaining({ message: expect.stringContaining('没有注册') }))

    const registry = new ComponentRegistry()
    executeComponentRuntime(validRuntime, 'com.example.counter', { registry })
    expect(() =>
      executeComponentRuntime(validRuntime, 'com.example.counter', { registry }),
    ).toThrowError(expect.objectContaining({ message: expect.stringContaining('重复注册') }))
  })
})

describe('ComponentPackageStore', () => {
  it('stores defensive byte copies and exposes embeddable files and metadata', () => {
    const store = new ComponentPackageStore()
    const archive = zipSync(filesFor())
    const imported = store.import(archive)
    imported.files['runtime.js']![0] = 0

    const stored = store.get('com.example.counter@4.0.0')
    expect(stored).toBeDefined()
    expect(stored!.runtimeSource.charCodeAt(0)).not.toBe(0)
    expect(store.toArchiveFiles()['com.example.counter@4.0.0']).toBeDefined()
    expect(store.toMetadataRecord()['com.example.counter@4.0.0']).toEqual(
      imported.metadata,
    )
  })

  it('rejects an accidental duplicate package and allows explicit replacement', () => {
    const store = new ComponentPackageStore()
    const archive = zipSync(filesFor())
    store.import(archive)
    expect(() => store.import(archive)).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('已经导入') }),
    )
    expect(() => store.import(archive, { replace: true })).not.toThrow()
    expect(store.size).toBe(1)
  })

  it('converts between serializable archive files and Store package data', () => {
    const parsed = parseComponentPackageFiles(filesFor())
    const project = {
      componentPackages: {
        [parsed.manifest.id]: parsed.metadata,
      },
    }
    const archiveFiles = componentPackagesToArchiveFiles({
      [parsed.manifest.id]: parsed,
    })
    const packages = componentPackagesFromArchive(
      project,
      archiveFiles,
    )

    expect(Object.keys(archiveFiles)).toEqual(['com.example.counter@4.0.0'])
    expect(packages['com.example.counter']?.manifest).toEqual(parsed.manifest)
    expect([
      ...packages['com.example.counter']!.files['assets/icon.png']!,
    ]).toEqual([9, 8, 7, 0, 255])
  })
})
