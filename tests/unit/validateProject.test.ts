import { strToU8, unzipSync, zipSync } from 'fflate'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'
import {
  createImageNode,
  createProject,
  createRectangleNode,
} from '@/renderer/project/createProject'
import { createProjectArchive } from '@/renderer/project/projectArchive'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type {
  CourseProjectDocument,
  LayerItem,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import {
  courseProjectValidationExitCode,
  runValidateProjectCli,
  serializeCourseProjectValidationReport,
  validateCourseProjectArchiveBytes,
} from '../../scripts/validate-project'

function blankArchiveData(): CourseProjectArchiveData {
  return {
    project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    assetFiles: {},
    componentFiles: {},
  }
}

function slideScene(project: CourseProjectDocument) {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('expected a slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected a slide scene')
  return scene
}

function nextLayerOrder(project: CourseProjectDocument): number {
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('expected a slide surface')
  const items = [
    ...project.globalLayerItems.map((entry) => entry.item),
    ...surface.surfaceLayerItems.map((entry) => entry.item),
    ...slideScene(project).layerItems,
  ]
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

function componentFiles(): Record<string, Uint8Array> {
  return {
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: 'com.example.validator',
      name: '校验组件',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 160, height: 90 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {},
      supportedScopes: ['scene'],
      renderMode: 'dom',
    })),
    'runtime.js': strToU8(
      "window.CoursewareComponent.define({id:'com.example.validator',runtimeApiVersion:4,create(){return{destroy(){}}}})",
    ),
  }
}

function completeContextArchive(): {
  bytes: Uint8Array
  imageLayerItemId: string
} {
  const source = blankArchiveData()
  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  source.project.assets.hero = {
    id: 'hero',
    filename: 'hero.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/hero.png',
    byteLength: imageBytes.byteLength,
    width: 320,
    height: 180,
  }
  source.assetFiles.hero = imageBytes
  const image = createImageNode({
    id: 'state-image',
    assetId: 'hero',
    x: 120,
    y: 120,
    width: 320,
    height: 180,
  })
  const scene = slideScene(source.project)
  scene.layerItems.push(sceneNodeToCourseLayerItem(image, nextLayerOrder(source.project)))
  const component = parseComponentPackageFiles(componentFiles())
  source.project.componentPackages[component.manifest.id] = component.metadata
  source.componentFiles[component.key] = component.files
  const componentItem: LayerItem = {
    layerItemId: 'validator-component',
    label: component.manifest.name,
    frame: { mode: 'absolute', x: 400, y: 160, width: 240, height: 180 },
    order: nextLayerOrder(source.project),
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'component',
    component: {
      packageId: component.manifest.id,
      version: component.manifest.version,
    },
    props: { ...component.manifest.defaultProps },
  }
  scene.layerItems.push(componentItem)
  scene.interactions.push({
    id: 'image-replay',
    enabled: true,
    trigger: { type: 'node.click', nodeId: image.id },
    conditions: [],
    actions: [{
      id: 'replay',
      start: 'after-previous',
      delayMs: 0,
      action: { type: 'scene.replay' },
    }],
  })
  return {
    bytes: createCourseProjectArchive(source),
    imageLayerItemId: image.id,
  }
}

function migrationMarkerArchive(): Uint8Array {
  const source = blankArchiveData()
  const runtime = {
    layerItemId: 'legacy-runtime',
    label: '迁移运行时',
    frame: { mode: 'legacy-whole-canvas', x: 0, y: 0, width: 1280, height: 720 },
    order: nextLayerOrder(source.project),
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'legacy-runtime-v2',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})',
      content: { values: {} },
      assets: {},
    },
  }
  const project = structuredClone(source.project) as unknown as { surfaces: Array<{ type: string; scenes: Array<{ layerItems: unknown[] }> }> }
  project.surfaces[0]!.scenes[0]!.layerItems.push(runtime)
  return zipSync({
    'project.json': strToU8(JSON.stringify(project)),
  })
}

function publicValidatorCommand(
  lessonPath: string,
  script = 'validate:course-project',
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const npmCli = process.env.npm_execpath ?? path.resolve(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  )
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [npmCli, 'run', '--silent', script, '--', lessonPath],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error)
          return
        }
        resolve({
          exitCode: typeof error?.code === 'number' ? error.code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        })
      },
    )
  })
}

describe('headless Course Project V9 validation', () => {
  it('returns a deterministic four-surface report for a valid archive', () => {
    const source = blankArchiveData()
    const bytes = createCourseProjectArchive(source, {
      mtime: '2026-08-12T00:00:00.000Z',
    })

    const report = validateCourseProjectArchiveBytes(bytes, 'lesson.h5lesson')

    expect(Object.keys(report)).toEqual([
      'reportVersion',
      'status',
      'input',
      'measurement',
      'schema',
      'project',
      'projectHealth',
      'exportPreflight',
      'protocols',
      'stableIds',
      'migrationMarkers',
      'summary',
      'fatal',
    ])
    expect(report).toMatchObject({
      reportVersion: 1,
      status: 'valid',
      input: { filename: 'lesson.h5lesson' },
      schema: { valid: true, schemaVersion: 9, issues: [] },
      project: {
        id: source.project.id,
        locationCount: 1,
        surfaceCount: 1,
        assetCount: 0,
        componentPackageCount: 0,
      },
      protocols: {
        project: 9,
        publishedCourse: 2,
        runtime: [2, 3],
        component: 4,
        interaction: 1,
      },
      measurement: { mode: 'deterministic-fallback' },
      fatal: null,
    })
    expect(Object.keys(report.exportPreflight ?? {})).toEqual([
      'single-html',
      'web-package',
      'pdf',
      'pptx',
    ])
    expect(courseProjectValidationExitCode(report)).toBe(0)
    expect(serializeCourseProjectValidationReport(report)).toBe(
      serializeCourseProjectValidationReport(
        validateCourseProjectArchiveBytes(bytes, 'lesson.h5lesson'),
      ),
    )
  })

  it('keeps the reachable duplicate stable-id guard and adds an owner-stable target', () => {
    const source = blankArchiveData()
    const firstSurface = source.project.surfaces[0]
    if (firstSurface?.type !== 'slide') throw new Error('expected a slide surface')
    const firstScene = firstSurface.scenes[0]
    if (!firstScene) throw new Error('expected a slide scene')
    const sharedIdItem = sceneNodeToCourseLayerItem(
      createRectangleNode({ id: 'duplicate-across-surfaces' }),
      0,
    )
    firstScene.layerItems.push(sharedIdItem)
    const secondSurface = structuredClone(firstSurface)
    secondSurface.id = 'second-surface'
    secondSurface.scenes[0]!.id = 'second-scene'
    source.project.surfaces.push(secondSurface)
    source.project.locations.push({
      id: 'second-location',
      label: '第二页',
      kind: 'slide-scene',
      surfaceId: secondSurface.id,
      sceneId: secondSurface.scenes[0]!.id,
    })
    source.project.mixedPrintPlan = {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        {
          id: 'print-first',
          kind: 'slide-scenes',
          surfaceId: firstSurface.id,
          sceneIds: [firstScene.id],
        },
        {
          id: 'print-second',
          kind: 'slide-scenes',
          surfaceId: secondSurface.id,
          sceneIds: [secondSurface.scenes[0]!.id],
        },
      ],
    }

    const report = validateCourseProjectArchiveBytes(
      createCourseProjectArchive(source),
      'duplicate-stable-id.h5lesson',
    )

    expect(report.schema.valid).toBe(true)
    expect(report.status).toBe('invalid')
    expect(courseProjectValidationExitCode(report)).toBe(1)
    expect(report.projectHealth?.items).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'duplicate-stable-id',
        path: ['surfaces', 1, 'scenes', 0, 'layerItems', 0, 'layerItemId'],
        target: {
          version: 1,
          kind: 'layer-item',
          owner: 'scene',
          projectId: source.project.id,
          surfaceId: secondSurface.id,
          sceneId: secondSurface.scenes[0]!.id,
          layerItemId: sharedIdItem.layerItemId,
        },
      }),
    ])
  })

  it('returns exit 1 for leftover V9 migration markers', () => {
    const report = validateCourseProjectArchiveBytes(
      migrationMarkerArchive(),
      'legacy-markers.h5lesson',
    )

    expect(report.status).toBe('unreadable')
    expect(courseProjectValidationExitCode(report)).toBe(2)
    expect(report.schema).toMatchObject({ valid: false, schemaVersion: 9 })
  })

  it('loads real asset and component bytes without V8 canvas-overflow checks', () => {
    const fixture = completeContextArchive()
    const report = validateCourseProjectArchiveBytes(
      fixture.bytes,
      'complete-context.h5lesson',
    )

    expect(report).toMatchObject({
      status: 'valid',
      schema: { valid: true, schemaVersion: 9 },
      project: { assetCount: 1, componentPackageCount: 1 },
      fatal: null,
    })
    expect(courseProjectValidationExitCode(report)).toBe(0)
    const htmlItems = report.exportPreflight?.['single-html'].items ?? []
    const absentCodes = new Set<string>([
      'asset-bytes-missing',
      'component-bytes-missing',
      'component-hash-mismatch',
      'node-fully-outside-canvas',
    ])
    expect(htmlItems.some((item) => absentCodes.has(item.code))).toBe(false)
    for (const target of ['pdf', 'pptx'] as const) {
      expect(report.exportPreflight?.[target].items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'static-export-interactions-omitted',
            target: {
              version: 1,
              kind: 'project',
              projectId: report.project?.id,
            },
          }),
        ]),
      )
    }
  })

  it('returns exit 2 for Project V8 without calling it the current format', () => {
    const bytes = createProjectArchive({
      project: createProject({ includeDefaultController: false, controls: 'none' }),
      assetFiles: {},
      componentFiles: {},
    })
    const report = validateCourseProjectArchiveBytes(bytes, 'legacy-v8.h5lesson')
    expect(report).toMatchObject({
      status: 'unreadable',
      schema: { valid: false, schemaVersion: 8 },
      fatal: { code: 'unsupported-project-version' },
    })
    expect(courseProjectValidationExitCode(report)).toBe(2)
    expect(JSON.stringify(report)).not.toContain('只接受 Project V8')
    expect(report.fatal?.message).toContain('不是当前 Course Project V9')
  })

  it('returns exit 2 for an old schema and for missing declared bytes', () => {
    const source = blankArchiveData()
    const oldProject = { ...source.project, schemaVersion: 7 }
    const oldReport = validateCourseProjectArchiveBytes(zipSync({
      'project.json': strToU8(JSON.stringify(oldProject)),
    }), 'old.h5lesson')
    expect(oldReport).toMatchObject({
      status: 'unreadable',
      schema: { valid: false, schemaVersion: 7, issues: [] },
      fatal: { code: 'unsupported-project-version' },
    })
    expect(courseProjectValidationExitCode(oldReport)).toBe(2)

    source.project.assets.hero = {
      id: 'hero',
      filename: 'hero.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/hero.png',
      byteLength: 4,
      width: 10,
      height: 10,
    }
    source.assetFiles.hero = new Uint8Array([1, 2, 3, 4])
    const files = unzipSync(createCourseProjectArchive(source))
    delete files['assets/hero.png']
    const missingReport = validateCourseProjectArchiveBytes(
      zipSync(files),
      'missing-asset.h5lesson',
    )
    expect(missingReport).toMatchObject({
      status: 'unreadable',
      fatal: {
        code: 'archive-invalid',
        message: expect.stringContaining('hero.png'),
      },
    })

    const missingComponent = blankArchiveData()
    const packageId = 'com.example.missing'
    missingComponent.project.componentPackages[packageId] = {
      packageId,
      version: '1.0.0',
      name: '缺失组件',
      manifestPath: `components/${packageId}/1.0.0/manifest.json`,
      runtimePath: `components/${packageId}/1.0.0/runtime.js`,
      contentSha256: '0'.repeat(64),
    }
    const componentReport = validateCourseProjectArchiveBytes(zipSync({
      'project.json': strToU8(JSON.stringify(missingComponent.project)),
    }), 'missing-component.h5lesson')
    expect(componentReport).toMatchObject({
      status: 'unreadable',
      fatal: {
        code: 'archive-invalid',
        message: expect.stringContaining(packageId),
      },
    })
  })

  it('reports structured schema paths for an invalid Course Project V9 document', () => {
    const files = unzipSync(createCourseProjectArchive(blankArchiveData()))
    const project = JSON.parse(
      new TextDecoder().decode(files['project.json']),
    ) as Record<string, unknown>
    delete project.locations
    files['project.json'] = strToU8(JSON.stringify(project))

    const report = validateCourseProjectArchiveBytes(
      zipSync(files),
      'schema-invalid.h5lesson',
    )

    expect(report).toMatchObject({
      status: 'unreadable',
      schema: {
        valid: false,
        schemaVersion: 9,
        issues: [
          expect.objectContaining({
            path: ['locations'],
            code: expect.any(String),
            message: expect.any(String),
          }),
        ],
      },
      fatal: { code: 'schema-invalid' },
    })
    expect({
      project: report.project,
      projectHealth: report.projectHealth,
      exportPreflight: report.exportPreflight,
      protocols: report.protocols,
      stableIds: report.stableIds,
      migrationMarkers: report.migrationMarkers,
    }).toEqual({
      project: null,
      projectHealth: null,
      exportPreflight: null,
      protocols: null,
      stableIds: null,
      migrationMarkers: null,
    })
    expect(report.summary).toEqual({
      error: 0,
      warning: 0,
      info: 0,
      total: 0,
      canExport: false,
    })
    expect(report.fatal).not.toHaveProperty('target')
    report.schema.issues.forEach((issue) => expect(issue).not.toHaveProperty('target'))
    expect(courseProjectValidationExitCode(report)).toBe(2)
  })

  it('does not claim a Project version when the declaration is malformed', () => {
    const source = blankArchiveData()
    const malformed = { ...source.project, schemaVersion: '9' }
    const report = validateCourseProjectArchiveBytes(zipSync({
      'project.json': strToU8(JSON.stringify(malformed)),
    }), 'malformed-version.h5lesson')

    expect(report).toMatchObject({
      status: 'unreadable',
      schema: {
        valid: false,
        schemaVersion: null,
      },
      fatal: { code: expect.stringMatching(/schema-invalid|unsupported-project-version|archive-invalid/) },
    })
  })

  it('keeps CLI stdout machine-readable and uses stable exit codes', async () => {
    const bytes = createCourseProjectArchive(blankArchiveData())
    const stdout: string[] = []
    const stderr: string[] = []
    const exitCode = await runValidateProjectCli(['lesson.h5lesson'], {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      read: async () => bytes,
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0]!)).toMatchObject({
      reportVersion: 1,
      status: 'valid',
      schema: { schemaVersion: 9 },
    })

    const invalidStdout: string[] = []
    const invalidStderr: string[] = []
    const invalidExit = await runValidateProjectCli([], {
      stdout: (value) => invalidStdout.push(value),
      stderr: (value) => invalidStderr.push(value),
      read: async () => new Uint8Array(),
    })
    expect(invalidExit).toBe(2)
    expect(JSON.parse(invalidStdout[0]!)).toMatchObject({
      status: 'unreadable',
      fatal: { code: 'usage-error' },
    })
    expect(invalidStderr.join('')).toContain('validate:course-project')
    expect(invalidStderr.join('')).not.toContain('只接受 Project V8')
  })

  it('runs the public command with pure JSON, stable exit codes, and no input writes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'validate-course-project-cli-'))
    const lessonPath = path.join(directory, 'lesson.h5lesson')
    const completePath = path.join(directory, 'complete-context.h5lesson')
    const markerPath = path.join(directory, 'legacy-markers.h5lesson')
    const oldPath = path.join(directory, 'old.h5lesson')
    const v8Path = path.join(directory, 'legacy-v8.h5lesson')
    const schemaPath = path.join(directory, 'schema-invalid.h5lesson')
    const missingAssetPath = path.join(directory, 'missing-asset.h5lesson')
    try {
      const validBytes = createCourseProjectArchive(blankArchiveData())
      await writeFile(lessonPath, validBytes)
      const valid = await publicValidatorCommand(lessonPath)
      expect(valid.exitCode).toBe(0)
      expect(valid.stderr).toBe('')
      expect(JSON.parse(valid.stdout)).toMatchObject({
        reportVersion: 1,
        status: 'valid',
        schema: { schemaVersion: 9 },
      })
      expect(await readFile(lessonPath)).toEqual(Buffer.from(validBytes))

      const alias = await publicValidatorCommand(lessonPath, 'validate:project')
      expect(alias.exitCode).toBe(0)
      expect(JSON.parse(alias.stdout)).toMatchObject({
        status: 'valid',
        schema: { schemaVersion: 9 },
      })
      expect(alias.stderr).not.toContain('只接受 Project V8')

      const complete = completeContextArchive()
      await writeFile(completePath, complete.bytes)
      const completeResult = await publicValidatorCommand(completePath)
      expect(completeResult.exitCode).toBe(0)
      expect(completeResult.stderr).toBe('')
      const completeReport = JSON.parse(completeResult.stdout) as {
        project: { assetCount: number; componentPackageCount: number }
        exportPreflight: Record<string, { items: Array<{ code: string }> }>
      }
      expect(completeReport.project).toMatchObject({
        assetCount: 1,
        componentPackageCount: 1,
      })
      expect(completeReport.exportPreflight['single-html']!.items.some(
        (item) => item.code === 'node-fully-outside-canvas',
      )).toBe(false)
      expect(await readFile(completePath)).toEqual(Buffer.from(complete.bytes))

      const markerBytes = migrationMarkerArchive()
      await writeFile(markerPath, markerBytes)
      const markerResult = await publicValidatorCommand(markerPath)
      expect(markerResult.exitCode).toBe(2)
      expect(JSON.parse(markerResult.stdout)).toMatchObject({
        status: 'unreadable',
        schema: { valid: false, schemaVersion: 9 },
      })

      const old = { ...blankArchiveData().project, schemaVersion: 7 }
      await writeFile(oldPath, zipSync({
        'project.json': strToU8(JSON.stringify(old)),
      }))
      const oldResult = await publicValidatorCommand(oldPath)
      expect(oldResult.exitCode).toBe(2)
      expect(oldResult.stderr).not.toContain('只接受 Project V8')
      expect(JSON.parse(oldResult.stdout)).toMatchObject({
        status: 'unreadable',
        fatal: { code: 'unsupported-project-version' },
      })

      const v8Bytes = createProjectArchive({
        project: createProject({ includeDefaultController: false, controls: 'none' }),
        assetFiles: {},
        componentFiles: {},
      })
      await writeFile(v8Path, v8Bytes)
      const v8Result = await publicValidatorCommand(v8Path)
      expect(v8Result.exitCode).toBe(2)
      expect(v8Result.stderr).not.toContain('只接受 Project V8')
      expect(JSON.parse(v8Result.stdout)).toMatchObject({
        status: 'unreadable',
        fatal: { code: 'unsupported-project-version' },
      })

      const schemaFiles = unzipSync(createCourseProjectArchive(blankArchiveData()))
      const schemaProject = JSON.parse(
        new TextDecoder().decode(schemaFiles['project.json']),
      ) as Record<string, unknown>
      delete schemaProject.locations
      schemaFiles['project.json'] = strToU8(JSON.stringify(schemaProject))
      await writeFile(schemaPath, zipSync(schemaFiles))
      const schemaResult = await publicValidatorCommand(schemaPath)
      expect(schemaResult.exitCode).toBe(2)
      expect(JSON.parse(schemaResult.stdout)).toMatchObject({
        status: 'unreadable',
        schema: {
          valid: false,
          schemaVersion: 9,
          issues: [expect.objectContaining({ path: ['locations'] })],
        },
        fatal: { code: 'schema-invalid' },
      })

      const missingAsset = blankArchiveData()
      missingAsset.project.assets.hero = {
        id: 'hero',
        filename: 'hero.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/hero.png',
        byteLength: 4,
        width: 10,
        height: 10,
      }
      await writeFile(missingAssetPath, zipSync({
        'project.json': strToU8(JSON.stringify(missingAsset.project)),
      }))
      const missingAssetResult = await publicValidatorCommand(missingAssetPath)
      expect(missingAssetResult.exitCode).toBe(2)
      expect(JSON.parse(missingAssetResult.stdout)).toMatchObject({
        status: 'unreadable',
        fatal: {
          code: 'archive-invalid',
          message: expect.stringContaining('hero.png'),
        },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 45_000)
})
