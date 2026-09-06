import { buildCoursewareCase } from '../../scripts/build-courseware-case'
import { createCoursewareBuilderV2 } from '../../src/renderer/course/coursewareBuilderV2'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('external courseware case builder', () => {
  it('keeps Builder V2 snapshots private and rejects stale steps without a second write', async () => {
    const builder = createCoursewareBuilderV2({ surfaceType: 'slide', title: 'V2 私有工作会话' })
    const scope = builder.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } })
    const copy = builder.snapshot()
    copy.project.title = '外部修改快照'
    const request = { operation: 'insert', template: { nativeType: 'text', text: '先解释再练习', width: 1100, height: 130 } }
    const created = await builder.execute('native.content', request, { kind: 'create', scope })
    expect(created.status).toBe('committed')
    const stale = await builder.execute('native.content', request, { kind: 'create', scope })
    expect(stale.status).toBe('stale')
    const output = builder.finish()
    expect(output.project.title).toBe('V2 私有工作会话')
    expect(output.project.revision).toBe(1)
    expect(output.receipts).toHaveLength(2)
    const slide = output.project.surfaces[0]!
    if (slide.type !== 'slide') throw new Error('Expected Slide')
    expect(slide.scenes[0]!.layerItems.find(item => item.layerItemId === created.affected[0]!.id)!.frame).toMatchObject({ width: 1100, height: 130 })
  })
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'courseware-case-builder-'))
  })

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  })

  async function createExternalCase(): Promise<string> {
    const caseDir = path.join(temporaryRoot, '外部 课例 #1')
    await mkdir(path.join(caseDir, 'implementation'), { recursive: true })
    await writeFile(path.join(caseDir, '01-teaching-plan.md'), '# 已确认教学策划\n', 'utf8')
    await writeFile(path.join(caseDir, '02-presentation-script.md'), '# 已确认呈现脚本\n', 'utf8')
    await writeFile(path.join(caseDir, 'implementation', 'build.mjs'), `
export default function buildCoursewareCase(context) {
  if (context.apiVersion !== 1) throw new Error('unexpected builder API version')
  if (!context.documents.teachingPlan.content.includes('教学策划')) throw new Error('missing plan')
  const project = context.api.project.createBlankCourseProject({
    id: 'project_external_case_builder',
    title: '任意目录课件',
    now: '2026-09-01T00:00:00.000Z',
    controls: 'canvas',
  })
  return { project, assetFiles: {}, componentFiles: {} }
}
`, 'utf8')
    return caseDir
  }

  it('builds V9 and offline HTML in a non-Git external directory through the product facade', async () => {
    const caseDir = await createExternalCase()
    const summary = await buildCoursewareCase({
      caseDir,
      builder: 'implementation/build.mjs',
      teachingPlan: '01-teaching-plan.md',
      presentationScript: '02-presentation-script.md',
      project: '交付/任意目录课件.h5lesson',
      html: '交付/任意目录课件.html',
      force: false,
    }, {
      editorRoot,
      playerBundle: 'window.CoursewarePlayer={mount(){}};',
      importBuilder: async () => ({
        default: (context: {
          apiVersion: number
          documents: { teachingPlan: { content: string } }
          api: { project: { createBlankCourseProject: (input: unknown) => unknown } }
        }) => {
          if (context.apiVersion !== 1) throw new Error('unexpected builder API version')
          if (!context.documents.teachingPlan.content.includes('教学策划')) {
            throw new Error('missing plan')
          }
          return {
            project: context.api.project.createBlankCourseProject({
              id: 'project_external_case_builder',
              title: '任意目录课件',
              now: '2026-09-01T00:00:00.000Z',
              controls: 'canvas',
            }),
            assetFiles: {},
            componentFiles: {},
          }
        },
      }),
    })

    expect(summary).toMatchObject({
      status: 'built',
      projectId: 'project_external_case_builder',
      title: '任意目录课件',
      locations: 1,
      surfaces: 1,
    })
    const lessonPath = path.join(caseDir, '交付', '任意目录课件.h5lesson')
    const htmlPath = path.join(caseDir, '交付', '任意目录课件.html')
    const reopened = openCourseProjectArchive(await readFile(lessonPath))
    expect(reopened.project).toMatchObject({
      schemaVersion: 9,
      id: 'project_external_case_builder',
      title: '任意目录课件',
    })
    expect(await readFile(htmlPath, 'utf8')).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(await readdir(caseDir)).not.toContain('.git')
    expect((await readdir(caseDir)).some((name) => name.startsWith('.courseware-case-build-')))
      .toBe(false)

    await expect(buildCoursewareCase({
      caseDir,
      builder: 'implementation/build.mjs',
      teachingPlan: '01-teaching-plan.md',
      presentationScript: '02-presentation-script.md',
      project: '交付/任意目录课件.h5lesson',
      html: '交付/任意目录课件.html',
      force: false,
    }, {
      editorRoot,
      playerBundle: 'window.CoursewarePlayer={mount(){}};',
      importBuilder: async () => ({ default: () => { throw new Error('should not run') } }),
    })).rejects.toThrow('使用 --force')
  })

  it('rejects outputs that escape the external case directory', async () => {
    const caseDir = await createExternalCase()
    await expect(buildCoursewareCase({
      caseDir,
      builder: 'implementation/build.mjs',
      teachingPlan: '01-teaching-plan.md',
      presentationScript: '02-presentation-script.md',
      project: '../escaped.h5lesson',
      html: 'courseware.html',
      force: false,
    }, {
      editorRoot,
      playerBundle: 'window.CoursewarePlayer={mount(){}};',
    })).rejects.toThrow('逃逸课例目录')
  })
})
