import { createHash } from 'node:crypto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'

function packageFiles(runtimeSuffix = ''): Record<string, Uint8Array> {
  return {
    'runtime.js': strToU8(
      `window.CoursewareComponent.define({id:'com.example.integrity',runtimeApiVersion:4,create(){return{destroy(){}}}})${runtimeSuffix}`,
    ),
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: 'com.example.integrity',
      name: 'Integrity',
      version: '4.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 160, height: 90 },
      preserveAspectRatio: false,
      assets: { icon: 'assets/icon.txt' },
      defaultProps: {},
      supportedScopes: ['scene'],
      renderMode: 'dom',
    })),
    'assets/icon.txt': strToU8('icon'),
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('component canonical content integrity', () => {
  it('matches the frozen v1 SHA-256 framing contract', () => {
    expect(componentContentSha256({
      'a.txt': strToU8('hello'),
      '目录/β.bin': new Uint8Array([0, 1, 255]),
    })).toBe('de26484191f1b4623799c3f39e6704dcc32288cf1f8e868b056d6931d796a18a')
  })

  it('is independent of entry order and ZIP encoding but sensitive to paths and bytes', () => {
    const files = packageFiles()
    const reordered = Object.fromEntries(Object.entries(files).reverse())
    const firstZip = zipSync(files, {
      level: 0,
      mtime: new Date('2026-08-12T00:00:00.000Z'),
    })
    const secondZip = zipSync(reordered, {
      level: 6,
      mtime: new Date('2026-08-12T01:00:00.000Z'),
    })

    expect(sha256(firstZip)).not.toBe(sha256(secondZip))
    expect(componentContentSha256(files)).toBe(componentContentSha256(reordered))
    expect(componentContentSha256({ ...files, 'assets/icon.txt': strToU8('changed') }))
      .not.toBe(componentContentSha256(files))
    const renamed: Record<string, Uint8Array> = {
      ...files,
      'assets/icon-2.txt': files['assets/icon.txt']!,
    }
    delete renamed['assets/icon.txt']
    expect(componentContentSha256(renamed)).not.toBe(componentContentSha256(files))
  })

  it('uses unambiguous file boundaries', () => {
    expect(componentContentSha256({ a: strToU8('bc') }))
      .not.toBe(componentContentSha256({ ab: strToU8('c') }))
    expect(componentContentSha256({ a: strToU8('b'), c: new Uint8Array() }))
      .not.toBe(componentContentSha256({ a: strToU8(''), bc: new Uint8Array() }))
  })

  it('rejects an archive whose embedded executable bytes no longer match the locked content hash', () => {
    const parsed = parseComponentPackageFiles(packageFiles())
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    project.componentPackages[parsed.metadata.packageId] = parsed.metadata
    const archive = createCourseProjectArchive({
      project,
      assetFiles: {},
      componentFiles: { [parsed.key]: parsed.files },
    })
    const files = unzipSync(archive)
    const runtimePath = `${parsed.metadata.runtimePath}`
    files[runtimePath] = strToU8(`${parsed.runtimeSource}\n/*tampered*/`)

    expect(() => openCourseProjectArchive(zipSync(files))).toThrow(
      /内容校验|SHA-256/,
    )
  })
})
