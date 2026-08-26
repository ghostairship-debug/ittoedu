// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(__dirname, '..', '..')

function resolveTsxCli(): string {
  const packageRoot = path.resolve(projectRoot, 'node_modules', 'tsx')
  const { bin } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const entry = typeof bin === 'string' ? bin : bin?.tsx
  if (!entry) throw new Error('无法定位 tsx CLI 入口')
  return path.resolve(packageRoot, entry)
}

const TIMEZONE_PROBE_PROGRAM = [
  "const { createHash } = await import('node:crypto')",
  'const courseFactory = await import(process.env.COURSE_FACTORY_MODULE_URL)',
  'const flowFactory = await import(process.env.FLOW_FACTORY_MODULE_URL)',
  'const producer = await import(process.env.COURSE_PRODUCER_MODULE_URL)',
  'const packages = await import(process.env.COURSE_PACKAGES_MODULE_URL)',
  'const docx = await import(process.env.FLOW_DOCX_MODULE_URL)',
  'const archives = await import(process.env.COURSE_ARCHIVE_MODULE_URL)',
  'const runner = await import(process.env.AUTHORING_RUNNER_MODULE_URL)',
  'const zipTime = await import(process.env.ARCHIVE_TIMESTAMP_MODULE_URL)',
  'const ids = (prefix) => { let next = 0; return () => `${prefix}-${++next}` }',
  "const now = '2026-08-27T00:00:00.000Z'",
  "const playerBundle = 'window.__PLAYER__=true;'",
  'const slideProject = courseFactory.createBlankCourseProject({',
  "  id: 'timezone-slide', now, controls: 'none', includeDefaultController: false,",
  "  idFactory: ids('slide'),",
  '})',
  'const sources = { project: slideProject, assetFiles: {}, components: {} }',
  'const syncWeb = packages.buildPublishedCourseWebPackage(sources, playerBundle)',
  'const asyncWeb = await packages.buildPublishedCourseWebPackageAsync(sources, playerBundle)',
  'const flowProject = flowFactory.createBlankFlowCourseProject({',
  "  id: 'timezone-flow', now, controls: 'none', includeDefaultController: false,",
  "  idFactory: ids('flow'),",
  '})',
  'const published = producer.buildPublishedCourseV2Payload({',
  '  project: flowProject, assetFiles: {}, components: {},',
  '})',
  "const flow = published.surfaces.find((surface) => surface.type === 'flow')",
  "if (!flow) throw new Error('missing flow surface')",
  'const flowDocx = docx.buildFlowDocx(flow).bytes',
  'const projectArchive = archives.createCourseProjectArchive({',
  '  project: slideProject, assetFiles: {}, componentFiles: {},',
  "}, { mtime: zipTime.createTimezoneStableZipMtime(now) })",
  "const sceneId = slideProject.locations.find((location) => location.kind === 'slide-scene').sceneId",
  "const observed = runner.withInitialState(projectArchive, sceneId, 'state_initial')",
  'const digest = (bytes) => createHash(\'sha256\').update(bytes).digest(\'hex\')',
  'console.log(JSON.stringify({',
  '  syncWeb: digest(syncWeb), asyncWeb: digest(asyncWeb),',
  '  flowDocx: digest(flowDocx), authoringObservation: digest(observed),',
  '}))',
].join('\n')

function buildArchivesInTimezone(timezone: string): Record<string, string> {
  const moduleUrl = (relativePath: string) => pathToFileURL(path.join(projectRoot, relativePath)).href
  const stdout = execFileSync(
    process.execPath,
    [resolveTsxCli(), '--input-type=module', '--eval', TIMEZONE_PROBE_PROGRAM],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        TZ: timezone,
        COURSE_FACTORY_MODULE_URL: moduleUrl('src/renderer/project/createCourseProject.ts'),
        FLOW_FACTORY_MODULE_URL: moduleUrl('src/renderer/project/createFlowCourseProject.ts'),
        COURSE_PRODUCER_MODULE_URL: moduleUrl('src/renderer/export/course/buildPublishedCourse.ts'),
        COURSE_PACKAGES_MODULE_URL: moduleUrl('src/renderer/export/course/buildCoursePackages.ts'),
        FLOW_DOCX_MODULE_URL: moduleUrl('src/renderer/export/course/flowDocx.ts'),
        COURSE_ARCHIVE_MODULE_URL: moduleUrl('src/renderer/project/courseProjectArchive.ts'),
        AUTHORING_RUNNER_MODULE_URL: moduleUrl('scripts/run-courseware-authoring.ts'),
        ARCHIVE_TIMESTAMP_MODULE_URL: moduleUrl('src/shared/archiveTimestamp.ts'),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  const payload = stdout.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)
  if (!payload) throw new Error(`TZ=${timezone} 的产品归档探针没有输出`)
  return JSON.parse(payload) as Record<string, string>
}

describe('product archive timezone stability', () => {
  it('keeps sync/async web packages, Flow DOCX and authoring observations stable', () => {
    const utc = buildArchivesInTimezone('UTC')
    expect(buildArchivesInTimezone('Asia/Shanghai')).toEqual(utc)
    expect(buildArchivesInTimezone('America/Los_Angeles')).toEqual(utc)
    expect(utc.asyncWeb).toBe(utc.syncWeb)
  }, 120_000)
})
