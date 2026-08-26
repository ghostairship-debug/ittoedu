import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildSampleExampleOutputs,
  checkSampleExampleOutputs,
  parseSampleExampleGenerationMode,
  SAMPLE_EXAMPLE_INPUT_PATHS,
  SAMPLE_EXAMPLE_OUTPUT_PATHS,
} from '../../scripts/build-examples'
import {
  checkTrackedExampleOutputs,
  createTimezoneStableZipMtime,
  equalBytes,
  normalizeLineEndings,
} from '../../scripts/exampleGenerationBoundary'
import {
  buildInteractiveLessonOutputs,
  checkInteractiveLessonOutputs,
  INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS,
  parseInteractiveLessonGenerationMode,
} from '../../scripts/build-interactive-lesson'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import {
  parseRenderHostBenchmarkGenerationMode,
} from '../../scripts/build-render-host-benchmark'
import { importComponentPackage } from '../../src/renderer/components/importComponentPackage'

const projectRoot = path.resolve(__dirname, '..', '..')
const examplesDirectory = path.join(projectRoot, 'examples')
const tempRoots: string[] = []

/** Resolves the tsx entry point from its manifest rather than a `dist/` guess. */
function resolveTsxCli(): string {
  const packageRoot = path.resolve(projectRoot, 'node_modules', 'tsx')
  const { bin } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const entry = typeof bin === 'string' ? bin : bin?.tsx
  if (!entry) throw new Error('无法定位 tsx CLI 入口')
  return path.resolve(packageRoot, entry)
}

/**
 * fflate 从 mtime 的**本地**日历分量推导 ZIP 的 DOS 时间戳，所以把绝对时刻
 * 交给它会让每个时区写出不同的归档字节。宿主时区只能在子进程里真正换掉
 * （`TZ=Asia/Shanghai cmd` 这种内联前缀在 Git Bash 里会被 MSYS 路径转换吃掉），
 * 因此这个探针在子进程里重建示例与课例归档，回报字节摘要和 `project.json`
 * 里的业务字段。
 */
const TIMEZONE_PROBE_PROGRAM = [
  "const { createHash } = await import('node:crypto')",
  "const { unzipSync } = await import('fflate')",
  'const samples = await import(process.env.EXAMPLE_SAMPLE_MODULE_URL)',
  'const lesson = await import(process.env.EXAMPLE_LESSON_MODULE_URL)',
  'const outputs = { ...(await samples.buildSampleExampleOutputs()) }',
  'const lessonOutputs = await lesson.buildInteractiveLessonOutputs()',
  'for (const [name, bytes] of Object.entries(lessonOutputs.tracked)) outputs[name] = bytes',
  'const digests = {}',
  'const projects = {}',
  'for (const [name, bytes] of Object.entries(outputs)) {',
  "  digests[name] = createHash('sha256').update(bytes).digest('hex')",
  "  if (!name.endsWith('.h5lesson')) continue",
  "  const project = JSON.parse(new TextDecoder().decode(unzipSync(bytes)['project.json']))",
  '  projects[name] = {',
  '    createdAt: project.createdAt,',
  '    updatedAt: project.updatedAt,',
  '    componentPackages: Object.fromEntries(Object.entries(project.componentPackages)',
  '      .map(([id, meta]) => [id, {',
  '        contentSha256: meta.contentSha256,',
  '        importedAt: meta.importedAt ?? null,',
  '      }])),',
  '  }',
  '}',
  'console.log(JSON.stringify({ digests, projects }))',
].join('\n')

interface TimezoneProbeResult {
  digests: Record<string, string>
  projects: Record<string, {
    createdAt: string
    updatedAt: string
    componentPackages: Record<string, { contentSha256: string; importedAt: string | null }>
  }>
}

function buildExampleArchivesInTimezone(timezone: string): TimezoneProbeResult {
  const stdout = execFileSync(
    process.execPath,
    [resolveTsxCli(), '--input-type=module', '--eval', TIMEZONE_PROBE_PROGRAM],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        TZ: timezone,
        EXAMPLE_SAMPLE_MODULE_URL: pathToFileURL(
          path.join(projectRoot, 'scripts', 'build-examples.ts'),
        ).href,
        EXAMPLE_LESSON_MODULE_URL: pathToFileURL(
          path.join(projectRoot, 'scripts', 'build-interactive-lesson.ts'),
        ).href,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  const payload = stdout.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)
  if (!payload) throw new Error(`TZ=${timezone} 的跨时区探针没有输出`)
  return JSON.parse(payload) as TimezoneProbeResult
}

async function snapshotTrackedOutputs(
  outputPaths: Readonly<Record<string, string>>,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const entries = await Promise.all(Object.values(outputPaths).map(
    async (relativePath) => [relativePath, new Uint8Array(await readFile(
      path.join(examplesDirectory, relativePath),
    ))] as const,
  ))
  return new Map(entries)
}

async function expectCheckDoesNotWrite(
  outputPaths: Readonly<Record<string, string>>,
  runCheck: () => Promise<void>,
): Promise<void> {
  const before = await snapshotTrackedOutputs(outputPaths)
  await runCheck()
  const after = await snapshotTrackedOutputs(outputPaths)
  for (const [relativePath, bytes] of before) {
    const afterBytes = after.get(relativePath)
    expect(afterBytes).toBeDefined()
    expect(equalBytes(bytes, afterBytes!)).toBe(true)
  }
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('example generation boundary', () => {
  it('rebuilds tracked sample outputs deterministically and checks them without writing', async () => {
    const first = await buildSampleExampleOutputs()
    const second = await buildSampleExampleOutputs()
    expect(Object.keys(first).sort()).toEqual([
      SAMPLE_EXAMPLE_OUTPUT_PATHS.component,
      SAMPLE_EXAMPLE_OUTPUT_PATHS.project,
    ].sort())

    for (const relativePath of Object.keys(first)) {
      const expected = first[relativePath]
      const repeated = second[relativePath]
      if (!expected || !repeated) throw new Error(`Missing generated output ${relativePath}`)
      expect(equalBytes(expected, repeated)).toBe(true)
    }

    const projectBytes = first[SAMPLE_EXAMPLE_OUTPUT_PATHS.project]
    const componentBytes = first[SAMPLE_EXAMPLE_OUTPUT_PATHS.component]
    if (!projectBytes || !componentBytes) throw new Error('Missing generated sample archives')
    const reopened = openCourseProjectArchive(projectBytes)
    const slide = reopened.project.surfaces[0]
    const slideLocations = reopened.project.locations.filter(
      (location) => location.kind === 'slide-scene',
    )
    expect(reopened.project.schemaVersion).toBe(9)
    expect(reopened.project.playback.controls).toBe('canvas')
    expect(reopened.project.globalLayerItems).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          kind: 'native',
          content: expect.objectContaining({ nativeType: 'teacher-controller' }),
        }),
        visibility: { mode: 'all', locationIds: [] },
      }),
    ])
    expect(slide?.type).toBe('slide')
    expect(slide?.type === 'slide' ? slide.scenes : []).toHaveLength(2)
    expect(slideLocations).toHaveLength(2)
    expect(reopened.project.componentPackages['com.example.sample-counter'])
      .toMatchObject({ packageId: 'com.example.sample-counter', version: '4.0.0' })
    const secondScene = slide?.type === 'slide' ? slide.scenes[1] : undefined
    expect(secondScene?.layerItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layerItemId: 'component_sample_counter',
        kind: 'component',
        component: {
          packageId: 'com.example.sample-counter',
          version: '4.0.0',
        },
      }),
    ]))

    const imported = importComponentPackage(componentBytes)
    const embeddedFiles = reopened.componentFiles[imported.key]
    expect(embeddedFiles).toBeDefined()
    expect(Object.keys(embeddedFiles ?? {}).sort()).toEqual(Object.keys(imported.files).sort())
    for (const [relativePath, bytes] of Object.entries(imported.files)) {
      expect(equalBytes(embeddedFiles?.[relativePath] ?? new Uint8Array(), bytes)).toBe(true)
    }

    const before = await snapshotTrackedOutputs(SAMPLE_EXAMPLE_OUTPUT_PATHS)
    await checkSampleExampleOutputs()
    const after = await snapshotTrackedOutputs(SAMPLE_EXAMPLE_OUTPUT_PATHS)

    for (const [relativePath, bytes] of before) {
      const afterBytes = after.get(relativePath)
      expect(afterBytes).toBeDefined()
      expect(equalBytes(bytes, afterBytes!)).toBe(true)
    }
  })

  it('carries the counter thumbnail as an input asset instead of regenerating it', async () => {
    const thumbnailPath = SAMPLE_EXAMPLE_INPUT_PATHS.thumbnail
    // 组件包内的条目名就是这张图的文件名，由输入路径推出，避免两处各写一份。
    const thumbnailName = path.posix.basename(thumbnailPath)

    // 这张 PNG 曾经是生成产物：现场栅格化一段带 `<text>` 的 SVG，却又要求与已提交
    // 字节逐字节相同。栅格化的输出取决于宿主字体、字体 hinting/抗锯齿的系统默认值
    // 和图形库版本，所以那两个要求不可能同时成立。它现在是输入：不在产物集合里，
    // `--refresh` 不会重写它，`--check` 也不会拿它跟一份重画的图比对。
    const outputs = await buildSampleExampleOutputs()
    expect(Object.values(SAMPLE_EXAMPLE_OUTPUT_PATHS)).not.toContain(thumbnailPath)
    expect(Object.keys(outputs)).not.toContain(thumbnailPath)

    // 降级为输入并没有放弃对它的验证：它仍原样嵌进下面两份归档，而这两份归档继续
    // 逐字节比对已提交字节，所以改动这张图照样会让 `--check` 失败。
    const trackedThumbnail = new Uint8Array(
      await readFile(path.join(examplesDirectory, thumbnailPath)),
    )
    expect(trackedThumbnail.byteLength).toBeGreaterThan(0)

    const componentBytes = outputs[SAMPLE_EXAMPLE_OUTPUT_PATHS.component]
    const projectBytes = outputs[SAMPLE_EXAMPLE_OUTPUT_PATHS.project]
    if (!componentBytes || !projectBytes) throw new Error('Missing generated sample archives')
    const imported = importComponentPackage(componentBytes)
    expect(equalBytes(imported.files[thumbnailName] ?? new Uint8Array(), trackedThumbnail))
      .toBe(true)
    const embedded = openCourseProjectArchive(projectBytes).componentFiles[imported.key]
    expect(equalBytes(embedded?.[thumbnailName] ?? new Uint8Array(), trackedThumbnail))
      .toBe(true)
  })

  it('checks tracked interactive lesson outputs without writing', async () => {
    const outputs = await buildInteractiveLessonOutputs()
    expect(Object.keys(outputs.tracked)).toEqual([
      INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.lesson,
    ])
    const lesson = outputs.tracked[INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.lesson]
    if (!lesson) throw new Error('Missing generated V9 lesson fixture')
    const reopened = openCourseProjectArchive(lesson)
    const slide = reopened.project.surfaces[0]
    expect(reopened.project.schemaVersion).toBe(9)
    expect(slide?.type).toBe('slide')
    expect(slide?.type === 'slide' ? slide.scenes : []).toHaveLength(3)
    expect(reopened.project.componentPackages).toEqual({})
    expect(reopened.componentFiles).toEqual({})
    expect(outputs.html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(outputs.html).toContain('"format":"h5course-published"')
    expect(outputs.html).toContain('"formatVersion":2')
    expect(outputs.html).toContain('"sourceSchemaVersion":9')
    expect(outputs.html).not.toMatch(/window\.__H5_LESSON_PAYLOAD__\s*=/)

    await expectCheckDoesNotWrite(
      INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS,
      checkInteractiveLessonOutputs,
    )
  }, 60_000)

  it('derives a timezone-stable ZIP mtime from the UTC business instant', () => {
    const mtime = createTimezoneStableZipMtime('2026-07-20T00:00:00.000Z')
    // 本地日历分量固定，DOS 时间戳才能在每个时区编码出同样的字节。
    expect([mtime.getFullYear(), mtime.getMonth() + 1, mtime.getDate()]).toEqual([2026, 7, 20])
    expect([mtime.getHours(), mtime.getMinutes(), mtime.getSeconds(), mtime.getMilliseconds()])
      .toEqual([12, 0, 0, 0])
    // 不带时区的字面量会按本地时间解析，必须在这一步被挡住。
    expect(() => createTimezoneStableZipMtime('2026-07-20T00:00:00')).toThrow(/UTC ISO/)
    expect(() => createTimezoneStableZipMtime('2026-07-20')).toThrow(/UTC ISO/)
    expect(() => createTimezoneStableZipMtime('not-an-instant')).toThrow(/UTC ISO/)
  })

  it('rebuilds tracked sample and lesson archives identically in every timezone', async () => {
    const trackedPaths = [
      ...Object.values(SAMPLE_EXAMPLE_OUTPUT_PATHS),
      ...Object.values(INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS),
    ]
    const trackedDigests = Object.fromEntries(await Promise.all(trackedPaths.map(
      async (relativePath) => [
        relativePath,
        createHash('sha256')
          .update(await readFile(path.join(examplesDirectory, relativePath)))
          .digest('hex'),
      ] as const,
    )))

    const utc = buildExampleArchivesInTimezone('UTC')
    const shanghai = buildExampleArchivesInTimezone('Asia/Shanghai')
    const losAngeles = buildExampleArchivesInTimezone('America/Los_Angeles')

    expect(shanghai).toEqual(utc)
    expect(losAngeles).toEqual(utc)
    // 锚定到已提交字节，否则三个子进程可以一起漂走而测试仍然通过。
    expect(utc.digests).toEqual(trackedDigests)

    // ZIP 封装时间换了写法，写进工程数据的业务字段不能跟着换。
    expect(utc.projects[SAMPLE_EXAMPLE_OUTPUT_PATHS.project]).toEqual({
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      componentPackages: {
        'com.example.sample-counter': {
          contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          importedAt: null,
        },
      },
    })
    expect(utc.projects[INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.lesson]).toEqual({
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      componentPackages: {},
    })
  }, 300_000)

  it('normalizes CRLF and lone CR line endings before embedding text', () => {
    expect(normalizeLineEndings('a\r\nb\nc\rd')).toBe('a\nb\nc\nd')
    expect(normalizeLineEndings('a\nb')).toBe('a\nb')
    expect(normalizeLineEndings('')).toBe('')
  })

  it('reports missing and stale fixtures without creating or changing them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'courseware-example-check-'))
    tempRoots.push(root)
    const expected = Uint8Array.from([1, 2, 3])

    await expect(checkTrackedExampleOutputs(root, { 'fixture.bin': expected }, '测试示例'))
      .rejects.toThrow(/缺少 tracked fixture/)

    const fixturePath = path.join(root, 'fixture.bin')
    await writeFile(fixturePath, expected)
    const before = new Uint8Array(await readFile(fixturePath))
    await expect(checkTrackedExampleOutputs(root, { 'fixture.bin': expected }, '测试示例'))
      .resolves.toBeUndefined()
    expect(equalBytes(new Uint8Array(await readFile(fixturePath)), before)).toBe(true)

    await writeFile(fixturePath, Uint8Array.from([1, 2, 4]))
    await expect(checkTrackedExampleOutputs(root, { 'fixture.bin': expected }, '测试示例'))
      .rejects.toThrow(/fixture 已过期/)
  })

  it('keeps refresh explicit and routes E2E preparation through check plus ignored HTML prepare', async () => {
    const packageJson = JSON.parse(await readFile(
      path.join(projectRoot, 'package.json'),
      'utf8',
    )) as { scripts?: Record<string, string> }
    const scripts = packageJson.scripts ?? {}

    expect(scripts['refresh:examples']).toContain('refresh:sample-examples')
    expect(scripts['check:examples']).toContain('check:sample-examples')
    expect(scripts['check:examples']).not.toContain('build:player')
    expect(scripts['build:examples']).toBe('npm run refresh:sample-examples')
    expect(scripts['pretest:e2e']).toContain('npm run build:player')
    expect(scripts['pretest:e2e']).toContain('npm run check:examples')
    expect(scripts['pretest:e2e']).toContain('npm run prepare:lesson-demo:fixture')
    expect(scripts['pretest:e2e']).not.toContain('npm run build:examples')
    expect(scripts['pretest:e2e']).not.toContain('npm run build:lesson-demo:fixture')
    expect(scripts['pretest:e2e']).not.toContain('npm run build:render-benchmark:fixture')
  })

  it('accepts only explicit generation modes', () => {
    expect(parseSampleExampleGenerationMode([])).toBe('refresh')
    expect(parseSampleExampleGenerationMode(['--check'])).toBe('check')
    expect(parseInteractiveLessonGenerationMode(['--prepare'])).toBe('prepare')
    expect(parseRenderHostBenchmarkGenerationMode(['--refresh'])).toBe('refresh')
    expect(() => parseSampleExampleGenerationMode(['--unknown'])).toThrow(/Usage:/)
    expect(() => parseInteractiveLessonGenerationMode(['--unknown'])).toThrow(/Usage:/)
    expect(() => parseRenderHostBenchmarkGenerationMode(['--unknown'])).toThrow(/Usage:/)
  })
})
