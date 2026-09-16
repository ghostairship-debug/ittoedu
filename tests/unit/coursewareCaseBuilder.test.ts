import { controllerPackage } from '../fixtures/teacherController'
import { buildCoursewareCase } from '../../scripts/build-courseware-case'
import { createCoursewareBuilderV2 } from '../../src/renderer/course/coursewareBuilderV2'
import { createCoursewareCaseBuilderApi } from '../../src/renderer/course/coursewareCaseBuilderApi'
import { createCoursewareBuilderCatalogPort } from '../../scripts/courseware-builder-v2-host'
import { queryCourseAgentCapabilities, type CourseAgentCapabilityData } from '../../src/shared/courseAgentCapabilities'
import generatedCapabilities from '../../src/shared/generated/courseAgentCapabilities.json'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('external courseware case builder', () => {
  it('executes the complete discovered narrow edit example and reads fresh Builder targets and receipts', async () => {
    const session = createCoursewareBuilderV2({ surfaceType: 'slide', title: 'Discovered narrow edit' })
    const inserted = await session.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: '原题目' } },
      { kind: 'create', scope: session.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
    expect(inserted.status).toBe('committed')
    const id = inserted.affected[0]!.id
    const view = session.observe({ itemIds: [id], includeContent: true })
    const target = view.targets.content[0]!
    const query = { ids: ['native.content'], operation: 'edit', surface: 'slide' as const, owner: 'scene' as const, detail: 'full' as const }
    const found = session.discover(query)
    expect(found).toEqual(createCoursewareCaseBuilderApi().discover(query))
    const input = found.cards![0]!.content.examples[0].input
    const receipt = await session.execute('native.content', input, { kind: 'update', target })
    expect(receipt.status).toBe('committed')
    const after = session.observe({ itemIds: [id], includeContent: true })
    expect(after.targets.content[0]!.documentRevision).toBe(target.documentRevision + 1)
    expect(JSON.stringify(after.items)).toContain('原题目')
    expect(JSON.stringify(after.items)).toContain('"fontSize":44')
    expect(session.readReceipts({ after: 1 }).receipts).toEqual([receipt])
    const instance = session.discover({ ids: ['component.package'], operation: 'patch', mode: 'instance', surface: 'slide', owner: 'scene', detail: 'full' })
    expect(instance.cards![0]!.content.examples[0]).toMatchObject({ operation: 'patch', mode: 'instance' })
  })

  it('shares exact read-only discovery with the app and builds a discovered Recipe through the same Facade', async () => {
    const session = createCoursewareBuilderV2({ surfaceType: 'slide', title: 'Discover Recipe' })
    const api = createCoursewareCaseBuilderApi()
    const query = { kind: 'recipe' as const, surface: 'slide' as const, owner: 'scene' as const }
    const found = session.discover(query)
    expect(found).toEqual(queryCourseAgentCapabilities(generatedCapabilities as CourseAgentCapabilityData, query))
    expect(api.discover(query)).toEqual(found)
    const card = session.readCapability(found.entries[0]!.id)
    expect(card).toEqual(api.readCapability(found.entries[0]!.id))
    if (!('content' in card)) throw new Error('Expected recipe content')
    const view = session.observe()
    const receipt = await session.execute('recipe.apply', card.content.input, { kind: 'create', scope: session.createScope({
      parent: { kind: 'course-locations' }, insertion: { kind: 'after', siblingId: view.scope.locationId },
    }) })
    expect(receipt.status).toBe('committed')
    expect(session.finish().project.locations).toHaveLength(2)
    expect(() => session.discover({ semanticVersion: 'outdated' })).toThrow('版本')
  })

  it('reads paginated fresh targets and stage receipts without repeatedly returning a project or prior history', async () => {
    const session = createCoursewareBuilderV2({ surfaceType: 'slide', title: 'Compact observations' })
    const ids: string[] = []
    for (let index = 0; index < 24; index++) {
      const receipt = await session.execute('native.content', { operation: 'insert', template: { nativeType: 'text', text: `讲解 ${index}` } },
        { kind: 'create', scope: session.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } }) })
      expect(receipt.status).toBe('committed')
      ids.push(receipt.affected[0]!.id)
    }
    const first = session.observe()
    expect(first).not.toHaveProperty('project')
    expect(first).not.toHaveProperty('receipts')
    expect(first.targets.content).toHaveLength(20)
    expect(first.targets.nextOffset).toBe(20)
    expect(session.observe({ offset: 20 }).targets.content).toHaveLength(4)
    const target = session.observe({ itemIds: [ids.at(-1)!], includeContent: true })
    expect(target.targets.content).toHaveLength(1)
    expect(target.targets.content[0]?.documentRevision).toBe(24)
    expect(JSON.stringify(target.items)).toContain('讲解 23')
    expect(Buffer.byteLength(JSON.stringify(target))).toBeLessThan(Buffer.byteLength(JSON.stringify(session.snapshot())) / 4)
    const recent = session.readReceipts({ after: 20 })
    expect(recent.receipts).toHaveLength(4)
    expect(session.readReceipts({ after: recent.cursor }).receipts).toEqual([])
    expect(() => session.readReceipts({ after: 100 })).toThrow('游标')
    expect(() => session.observe({ itemIds: ['missing'] })).toThrow('当前 scope')
    const copy = session.activateScope({ locationId: first.scope.locationId })
    Reflect.set(copy.scope, 'locationId', 'external-mutation')
    expect(session.observe().scope.locationId).toBe(first.scope.locationId)
    expect(session.snapshot()).toHaveProperty('project')
  })

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
    vi.unstubAllEnvs()
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('does not grant catalog trust to an unreviewed external directory', async () => {
    const catalogRoot = path.join(temporaryRoot, 'catalog')
    await mkdir(catalogRoot)
    await writeFile(path.join(catalogRoot, 'catalog.json'), JSON.stringify({ catalogVersion: 1, name: 'Unreviewed', packages: [] }))
    vi.stubEnv('COURSEWARE_COMPONENTS_DIR', catalogRoot)
    const port = createCoursewareBuilderCatalogPort(editorRoot)
    const catalog = await port.load()
    expect(catalog.sources[0]?.trust).toBe('prompt')
    await expect(port.read({ sourceId: catalog.sources[0]!.sourceId, packageId: 'invented', version: '1' })).rejects.toThrow('受信')
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
          encodeBase64(value: string | Uint8Array): string
          documents: { teachingPlan: { content: string } }
          api: { project: { createBlankCourseProject: (input: unknown) => unknown } }
        }) => {
          expect(context.encodeBase64('电路✓')).toBe('55S16Lev4pyT')
          expect(context.encodeBase64(new Uint8Array([0,255,128]))).toBe('AP+A')
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
            componentFiles: { [`${controllerPackage.manifest.id}@${controllerPackage.manifest.version}`]: controllerPackage.files },
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
