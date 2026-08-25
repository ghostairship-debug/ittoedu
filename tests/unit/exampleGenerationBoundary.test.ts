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
} from '../../scripts/exampleGenerationBoundary'
import {
  parseInteractiveLessonGenerationMode,
} from '../../scripts/build-interactive-lesson'
import {
  parseRenderHostBenchmarkGenerationMode,
} from '../../scripts/build-render-host-benchmark'

const projectRoot = path.resolve(__dirname, '..', '..')
const examplesDirectory = path.join(projectRoot, 'examples')
const tempRoots: string[] = []

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

    const before = await Promise.all(Object.values(SAMPLE_EXAMPLE_OUTPUT_PATHS).map(
      async (relativePath) => [relativePath, new Uint8Array(await readFile(
        path.join(examplesDirectory, relativePath),
      ))] as const,
    ))
    await checkSampleExampleOutputs()
    const after = await Promise.all(Object.values(SAMPLE_EXAMPLE_OUTPUT_PATHS).map(
      async (relativePath) => [relativePath, new Uint8Array(await readFile(
        path.join(examplesDirectory, relativePath),
      ))] as const,
    ))

    for (const [relativePath, bytes] of before) {
      const afterBytes = after.find(([candidate]) => candidate === relativePath)?.[1]
      expect(afterBytes).toBeDefined()
      expect(equalBytes(bytes, afterBytes!)).toBe(true)
    }
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
