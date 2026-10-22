import { describe, expect, it, vi } from 'vitest'
import { strFromU8, zipSync, strToU8, unzipSync } from 'fflate'
import { normalizeWorkProject, migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { resolveComponentBackground, resolveComponentSurfaceBackground, resolveComponentPresentation, componentSurface, type CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { componentFlowAuthoringSchema } from '../../src/shared/contracts/component-platform/schema'
import { componentBackgroundPaintStyles } from '../../src/shared/componentBackgroundPaint'
import { createComponentModelProjection } from '../../src/player/componentPlatform/modelProjection'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { openCourseProjectV10Archive, createCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { buildComponentPptx } from '../../src/renderer/export/componentPlatform/pptx'
import { createTextComponentData } from '../../src/components/text/data'

export function backgroundFixture(): CourseProjectV11 {
  return migrateCourseProjectV10({ schemaVersion: 10, id: 'background-lab', revision: 0, title: 'Background lab',
    definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { body: { id: 'body', definitionId: 'text', data: createTextComponentData('Readable foreground') },
      under: { id: 'under', definitionId: 'text', data: createTextComponentData('Global underlay'), frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['body'], flow: { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100 } } }],
    assets: {}, global: { underlay: ['under'], overlay: [] } })
}

describe('background ownership without Flow paper paint', () => {
  it('separates visible inherited paint from local painting, including named state inheritance', () => {
    const project = backgroundFixture(), surface = componentSurface(project, 'flow')!
    project.background = { color: '#123456' }
    expect(resolveComponentBackground(project, surface).color).toBe('#123456')
    expect(resolveComponentSurfaceBackground(project, surface)).toBeUndefined()
    project.instances.flow.container!.kind = 'slide'
    project.instances.flow.container!.presentation = { states: [{ id: 'inherit', title: 'Inherited', overrides: {}, background: { mode: 'inherit' } }] }
    const projected = resolveComponentPresentation(project, 'flow', 'inherit')
    expect(componentSurface(projected, 'flow')!.background).toBeUndefined()
    project.instances.flow.container!.background = { mode: 'own', color: 'transparent' }
    expect(resolveComponentSurfaceBackground(project, componentSurface(project, 'flow')!)!.color).toBe('transparent')
  })

  it.each([10, 11])('migrates only active non-default paper colors in Project %s and saves a single fact', version => {
    const current = backgroundFixture()
    const wire: any = version === 11 ? structuredClone(current) : { ...current, schemaVersion: 10, surfaces: [componentSurface(current, 'flow')!] }
    if (version === 10) { delete wire.instances.flow; delete wire.rootIds; delete wire.entry }
    const owner = version === 11 ? wire.instances.flow.container : wire.surfaces[0]
    owner.flow.layout.paperBackgroundColor = '#ffeedd'
    const migrated = normalizeWorkProject(wire)
    expect(componentSurface(migrated, 'flow')!.background).toEqual({ mode: 'own', color: '#ffeedd' })
    expect(componentSurface(migrated, 'flow')!.flow!.layout).not.toHaveProperty('paperBackgroundColor')
    const bytes = createCourseProjectV10Archive({ project: migrated, resources: { assets: {}, components: {} } })
    expect(JSON.parse(strFromU8(unzipSync(bytes)['project.json']))).toEqual(migrated)
    expect(openCourseProjectV10Archive(bytes).project).toEqual(migrated)
    owner.flow.layout.paperBackgroundColor = '#ffffff'
    expect(componentSurface(normalizeWorkProject(wire), 'flow')!.background).toBeUndefined()
    wire.background = { color: '#112233' }; owner.flow.layout.paperBackgroundColor = '#ffeedd'
    expect(componentSurface(normalizeWorkProject(wire), 'flow')!.background).toBeUndefined()
    owner.background = { mode: 'own', color: '#abcdef' }
    expect(componentSurface(normalizeWorkProject(wire), 'flow')!.background).toEqual(owner.background)
    expect(owner.flow.layout.paperBackgroundColor).toBe('#ffeedd') // Original remains intact.
  })

  it('reads old GLX at the archive boundary but rejects new paper writes', () => {
    const raw: any = backgroundFixture(); raw.instances.flow.container.flow.layout.paperBackgroundColor = '#aabbcc'
    const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(raw)) })
    expect(componentSurface(openCourseProjectV10Archive(bytes).project, 'flow')!.background!.color).toBe('#aabbcc')
    expect(componentFlowAuthoringSchema.safeParse(raw.instances.flow.container.flow).success).toBe(false)
  })

  it('does not add white beneath transparent CSS Paint, images or missing color', () => {
    expect(componentBackgroundPaintStyles(undefined, () => undefined)).toEqual([])
    expect(componentBackgroundPaintStyles({ assetId: 'image' }, () => 'data:image/png;base64,AA')[0].backgroundColor).toBe('transparent')
    const styles = componentBackgroundPaintStyles({ paint: { layers: [
      { style: { 'background-image': 'linear-gradient(transparent,rgba(1,2,3,.5))' }, resourceBindings: {} },
      { style: { 'background-color': 'rgba(4,5,6,.2)' }, resourceBindings: {} },
    ] } }, () => undefined)
    expect(styles).toHaveLength(2); expect(styles[0].backgroundColor).toBeUndefined()
  })

  it('paints Project below global planes and Surface above, with no paint on Flow paper or local inherited shells', () => {
    const project = backgroundFixture(); project.background = { color: '#123456' }
    const root = document.createElement('div'); document.body.append(root)
    const runtime = { bind: vi.fn(), bindTarget: vi.fn(), assetUrl: vi.fn() } as unknown as ComponentPlatformRuntime
    const projection = createComponentModelProjection({ root, runtime, signal: new AbortController().signal })
    const sync = () => projection.sync({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
    sync()
    const surface = root.querySelector<HTMLElement>('[data-component-surface="flow"]')!
    const paper = surface.querySelector<HTMLElement>('[data-flow-paper]') ?? surface.querySelector('article')!
    expect(paper.querySelector(':scope > [data-component-background-paint]')).toBeNull()
    expect(surface.querySelector(':scope > [data-component-background-paint]')).toBeNull()
    project.instances.flow.container!.background = { mode: 'own', color: '#abcdef' }; sync()
    expect((surface.querySelector(':scope > [data-component-background-paint] > div') as HTMLElement).style.backgroundColor).toBe('rgb(171, 205, 239)')
    project.instances.flow.container!.background = { mode: 'inherit' }; sync()
    expect(surface.querySelector(':scope > [data-component-background-paint]')).toBeNull()
    projection.dispose(); root.remove()
  })

  it('orders static Print and native PPTX independent backgrounds above Global Underlay', async () => {
    const project = backgroundFixture(); project.background = { color: '#112233' }; project.instances.flow.container!.background = { mode: 'own', color: '#abcdef' }
    const printed = new DOMParser().parseFromString((await buildComponentPrintHtml(project, { surfaceId: 'flow' })).html, 'text/html')
    expect(printed.querySelector<HTMLElement>('[data-surface-background]')!.style.zIndex).toBe('1')
    expect(printed.querySelector<HTMLElement>('[data-component-output="under"]')!.style.zIndex).toBe('0')
    project.instances.flow.container!.kind = 'slide'; delete project.instances.flow.container!.flow
    project.instances.flow.container!.designSize = { width: 800, height: 600 }
    project.instances.body.frame = { width: 500, height: 70, transform: [1, 0, 0, 1, 20, 30] }
    const xml = strFromU8(unzipSync((await buildComponentPptx(project)).bytes)['ppt/slides/slide1.xml'])
    expect(xml.indexOf('Global underlay')).toBeLessThan(xml.indexOf('flow:surface-color'))
    expect(xml.indexOf('flow:surface-color')).toBeLessThan(xml.indexOf('Readable foreground'))
  })
})

import { normalizeCourseDocumentRecovery } from '../../src/core/drivers/workProjectRecovery'
import { createDocumentAcceptedChange, applyDocumentHistoryEntry, applyDocumentAcceptedChange, documentRecoveryModels } from '../../src/core/documents/documentStateEffects'
import { describeComponentChanges } from '../../src/core/drivers/courseV10Operations'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'

it('migrates paper facts in retained effect history even when current and saved models have none', () => {
  const old: any = backgroundFixture(); old.instances.flow.container.flow.layout.paperBackgroundColor = '#ffeedd'
  const next = backgroundFixture(); next.revision = 1
  const before: DocumentModel = { kind: 'course-v10', project: old, resources: { assets: {}, components: {} } }
  const after: DocumentModel = { ...before, project: next }
  const effect = createDocumentAcceptedChange(before, after, describeComponentChanges(old, next))
  const state = { schemaVersion: 3, documentId: 'test', epoch: 'epoch', sequence: 1, revision: 1, savedRevision: 1,
    model: after, savedModel: after, binding: { kind: 'memory', title: 'Test' },
    past: [{ id: 'edit', label: 'Edit', effects: [effect] }], future: [],
    operations: [{ operationId: 'op', digest: 'digest', result: {}, effect }], stoppedRuns: [] } as unknown as DurableDocumentState
  const migrated = normalizeCourseDocumentRecovery(state)
  const undone = applyDocumentHistoryEntry(migrated.model, migrated.past[0], 'inverse')
  expect(undone.kind === 'course-v10' && componentSurface(undone.project, 'flow')!.background!.color).toBe('#ffeedd')
  expect(applyDocumentHistoryEntry(undone, migrated.past[0], 'forward')).toEqual(migrated.model)
  expect(applyDocumentAcceptedChange(migrated.model, migrated.operations[0].effect!, 'inverse')).toEqual(undone)
  for (const model of documentRecoveryModels(migrated)) expect(JSON.stringify(model)).not.toContain('paperBackgroundColor')
  const future = normalizeCourseDocumentRecovery({ ...state, model: before, savedModel: before, past: [], future: state.past })
  expect(applyDocumentHistoryEntry(future.model, future.future[0], 'forward')).toEqual(after)
  expect(normalizeCourseDocumentRecovery(migrated)).toBe(migrated)
})

import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'

it('keeps static white paper transparent, maps CSS colors, and includes inherited parent Surface color', async () => {
  const project=backgroundFixture()
  project.instances.flow.container!.background={mode:'own',color:'transparent'}
  let xml=strFromU8(unzipSync((await buildComponentDocx(project,{surfaceId:'flow'})).bytes)['word/document.xml'])
  expect(xml).not.toContain('<w:background')
  project.instances.flow.container!.background={mode:'own',color:'rgb(170,187,204)'}
  xml=strFromU8(unzipSync((await buildComponentDocx(project,{surfaceId:'flow'})).bytes)['word/document.xml'])
  expect(xml).toContain('<w:background w:color="AABBCC"')
  expect(xml).not.toContain('Global underlay')
  project.definitions.parent={id:'parent',role:'mixed',implementation:{kind:'builtin',key:'guoling.container.slide'}}
  project.instances.parent={id:'parent',definitionId:'parent',data:{},childIds:['flow'],container:{kind:'slide',background:{mode:'own',color:'#abcdef'}}}
  project.rootIds=['parent'];project.entry={rootInstanceId:'parent'};project.instances.flow.container!.background={mode:'inherit'}
  xml=strFromU8(unzipSync((await buildComponentDocx(project,{surfaceId:'flow'})).bytes)['word/document.xml'])
  expect(xml).toContain('<w:background w:color="ABCDEF"')
  expect(xml).not.toContain('Global underlay')
  const printed=new DOMParser().parseFromString((await buildComponentPrintHtml(project,{surfaceId:'flow'})).html,'text/html')
  expect(printed.querySelector<HTMLElement>('[data-surface-background] [data-component-background-paint] > div')!.style.backgroundColor).toBe('rgb(171, 205, 239)')
})

it('retains template Underlay inheritance and imports legacy library paper only at its read boundary', () => {
  const project=backgroundFixture();project.background={color:'#112233'}
  const resources={assets:{},components:{}}
  const extracted=extractComponentLibraryEntry(project,resources,{id:'template',title:'Dynamic template',surfaceIds:['flow']})
  expect(extracted.entry.example.instances.flow.container!.background).toBeUndefined()
  expect(extracted.entry.global!.underlay).toEqual(['under'])
  expect(extracted.diagnostics).toContainEqual(expect.objectContaining({code:'background-host-inherited'}))
  const files=unzipSync(exportComponentLibraryArchive(extracted.entry)),manifest=JSON.parse(strFromU8(files['manifest.json']))
  manifest.entry.example.instances.flow.container.flow.layout.paperBackgroundColor='#ccbbaa'
  files['manifest.json']=strToU8(JSON.stringify(manifest))
  const imported=importComponentLibraryArchive(zipSync(files)).entry
  expect(imported.example.instances.flow.container!.background).toEqual({mode:'own',color:'#ccbbaa'})
  expect(imported.example.instances.flow.container!.flow!.layout).not.toHaveProperty('paperBackgroundColor')
})
