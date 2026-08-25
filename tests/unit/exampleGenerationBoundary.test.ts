import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildSampleExampleOutputs,
  checkSampleExampleOutputs,
  parseSampleExampleGenerationMode,
  SAMPLE_EXAMPLE_OUTPUT_PATHS,
} from '../../scripts/build-examples'
import {
  checkTrackedExampleOutputs,
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

const projectRoot = path.resolve(__dirname, '..', '..')
const examplesDirectory = path.join(projectRoot, 'examples')
const tempRoots: string[] = []

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
      SAMPLE_EXAMPLE_OUTPUT_PATHS.thumbnail,
    ].sort())

    for (const relativePath of Object.keys(first)) {
      const expected = first[relativePath]
      const repeated = second[relativePath]
      if (!expected || !repeated) throw new Error(`Missing generated output ${relativePath}`)
      expect(equalBytes(expected, repeated)).toBe(true)
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
