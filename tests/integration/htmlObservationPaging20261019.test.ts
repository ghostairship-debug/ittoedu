// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { HtmlActionService, type HtmlActionObservation, type PublishedActionPreviewPort } from '../../src/main/workbench/observation/HtmlActionService'
import type { HtmlActionFramePort, PublishedActionAutomationContext } from '../../src/main/workbench/observation/HtmlActionDesktopPort'
import type { HtmlPageElement } from '../../src/main/workbench/observation/HtmlActionPageScript'
import type { HtmlPreviewAutomationContext } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { ObservationImageStore } from '../../src/main/workbench/observation/ObservationImageStore'
import type { ViewObservationSnapshot } from '../../src/shared/workbench/viewObservation'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vS8AAAAASUVORK5CYII=', 'base64'))
const opened: HtmlActionService[] = []
afterEach(() => { for (const service of opened.splice(0)) service.dispose() })

function fixture(rootCount = 260, childCount = 2) {
  let revision = 1, observes = 0, captures = 0, actions = 0, frameToken = 'root', failAction = false
  const context = (): HtmlPreviewAutomationContext => ({ webContentsId: 1, tabId: 'preview', bindingPath: 'D:\\lesson\\demo.html',
    lease: { leaseId: `lease-${revision}`, loadId: `load-${revision}`, documentId: 'doc', epoch: 'epoch', revision,
      bindingVersion: 1, url: 'courseware-preview://preview.app/file/demo.html' } })
  const elements: HtmlPageElement[] = Array.from({ length: rootCount }, (_, index) => ({ path: [index], fingerprint: `root-${index}`,
    tag: index === rootCount - 1 ? 'input' : 'button', role: index === 17 ? 'RoleOnlyMarker' : '',
    label: index % 50 === 0 ? `Needle ${index}` : `Root item ${index}`,
    text: index === rootCount - 1 ? `${'long text '.repeat(80)}TEXT_TAIL_MARKER` : `Root text ${index}`,
    editable: index === rootCount - 1, ...(index === rootCount - 1 ? { value: 'ValueOnlyMarker' } : {}),
    rect: { x: 1, y: 1, width: 80, height: 20 } }))
  elements.push(...Array.from({ length: childCount }, (_, index): HtmlPageElement => ({ path: [index], fingerprint: `child-${index}`,
    frameToken: 'nested', frameProcessId: 2, tag: 'button', role: '', label: `Nested control ${index}`, text: `Nested text ${index}`,
    editable: false, rect: { x: 100, y: 100, width: 80, height: 20 } })))
  const frames: HtmlActionFramePort = {
    async frameToken() { return frameToken },
    async observe(current) {
      observes++
      return { url: 'lease' in current ? current.lease.url : current.url, title: 'Paging', readyState: 'complete', pageIndex: 0, pageCount: 1,
        structure: ['Needle feedback tail', 'Unrelated structure'], diagnostics: [], elements,
        viewport: { width: 500, height: 400 }, observationScope: { kind: 'visible-preview-frames', viewport: { width: 400, height: 300 },
          frames: [{ frameId: 1, url: context().lease.url, status: 'observed', returnedElements: rootCount, matchedElements: rootCount, truncatedElements: 0 },
            ...(childCount ? [{ frameId: 2, url: 'about:srcdoc', status: 'observed' as const, returnedElements: childCount, matchedElements: childCount, truncatedElements: 0 }] : [])] } }
    },
    async capture() { captures++; return { png, width: 800, height: 600 } },
    async act() { actions++; if (failAction) { failAction = false; throw new Error('Lost action result') } return { applied: true } },
    async navigate() {}, onDiagnostic() { return () => {} },
  }
  const publishedContext: PublishedActionAutomationContext = { kind: 'published', runId: 'published', webContentsId: 9,
    frameToken: 'root', frameProcessId: 3, url: 'courseware-editor://app/observation.html',
    identity: { documentId: 'doc', epoch: 'epoch', revision: 1, projectId: 'project', locationId: 'page', stateId: null } }
  const published: PublishedActionPreviewPort = { async contextForTarget() { return publishedContext }, async currentContext(current) { return current },
    async readState() { return { locationId: 'page', stateId: null, structure: ['Published page'], diagnostics: [] } } }
  const service = new HtmlActionService({ frames, images: new ObservationImageStore(), published, preview: {
    async automationContext(leaseId, loadId, expected) {
      const current = context()
      if (leaseId !== current.lease.leaseId || loadId !== current.lease.loadId || expected !== revision) throw new Error('HTML 源码版本已变化')
      return current
    },
    async automationContextForDocument(input) {
      if (input.documentId !== 'doc' || input.epoch !== 'epoch' || input.revision !== revision) throw new Error('HTML 文档来源不匹配')
      return context()
    },
  } })
  opened.push(service)
  const project = createBlankCourseProjectV10('Paging'); project.id = 'project'
  const snapshot: ViewObservationSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 1,
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'Paging' },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { service, frames, publishedTarget: { identity: publishedContext.identity, snapshot },
    document: () => ({ documentId: 'doc', epoch: 'epoch', revision }),
    async begin() { await service.beginDocumentRun('run', { documentId: 'doc', epoch: 'epoch', revision }) },
    counts: () => ({ observes, captures, actions }), setRevision(next: number) { revision = next },
    replaceFrame() { frameToken = 'replaced' }, failNextAction() { failAction = true } }
}

it('keeps each frame reachable in the first overview and pages the same complete capture without replacing handles', async () => {
  const f = fixture(); await f.begin()
  const first = await f.service.observe('run')
  expect(first.elements).toHaveLength(240)
  expect(first.elements.some(element => element.label === 'Nested control 0')).toBe(true)
  expect(first.elements.some(element => element.label === 'Nested control 1')).toBe(true)
  expect(first.elementsPage).toMatchObject({ generation: 1, query: '', offset: 0, limit: 240, total: 262 })
  const cursor = first.elementsPage!.nextCursor!
  const next = await f.service.observe('run', { cursor })
  const repeated = await f.service.observe('run', { cursor })
  expect(next.elements).toHaveLength(22)
  expect(next.elementsPage).toMatchObject({ generation: 1, offset: 240, limit: 240, total: 262 })
  expect(next.elementsPage!.nextCursor).toBeUndefined()
  expect(next.elements.at(-1)).toMatchObject({ label: 'Root item 259', value: 'ValueOnlyMarker' })
  expect(next.elements.at(-1)!.text).toContain('TEXT_TAIL_MARKER')
  expect(next.elements.at(-1)!.text.length).toBeGreaterThan(240)
  expect(repeated.elements).toEqual(next.elements)
  expect(next.image.resourceId).toBe(first.image.resourceId)
  expect(f.counts()).toEqual({ observes: 1, captures: 1, actions: 0 })
  await f.service.input('run', { operationId: 'last-control', handle: next.elements.at(-1)!.handle, value: 'new answer' })
  expect(f.counts()).toEqual({ observes: 2, captures: 2, actions: 1 })
  await expect(f.service.observe('run', { cursor })).rejects.toMatchObject({ code: 'html-observation-cursor-expired', refresh: { tool: 'html.observe', input: { query: '' } } })
})

it('filters all searchable element fields and structure, and binds continuation to its original filter', async () => {
  const f = fixture(); await f.begin()
  const first = await f.service.observe('run', { query: 'Needle', limit: 2 })
  expect(first.elementsPage).toMatchObject({ query: 'Needle', total: 6, offset: 0, limit: 2 })
  expect(first.structure).toEqual(['Needle feedback tail'])
  const cursor = first.elementsPage!.nextCursor!
  const next = await f.service.observe('run', { cursor })
  expect(next.elements.map(element => element.label)).toEqual(['Needle 100', 'Needle 150'])
  await expect(f.service.observe('run', { cursor, query: 'Other' })).rejects.toMatchObject({ refresh: { input: { query: 'Needle' } } })
  expect(f.counts()).toEqual({ observes: 1, captures: 1, actions: 0 })
  for (const query of ['RoleOnlyMarker', 'ValueOnlyMarker', 'TEXT_TAIL_MARKER', 'input']) {
    const result = await f.service.observe('run', { query, detail: 'full' })
    expect(result.elements).toHaveLength(1)
    expect(result.elementsPage).toMatchObject({ query, offset: 0, total: 1 })
  }
  const full = await f.service.observe('run', { detail: 'full' })
  expect(full.elements).toHaveLength(262)
  expect(full.elementsPage!.nextCursor).toBeUndefined()
  const explicit = await f.service.observe('run', { detail: 'full', offset: 250, limit: 10_000 })
  expect(explicit.elements).toHaveLength(12)
  expect(explicit.elementsPage).toMatchObject({ offset: 250, limit: 10_000, total: 262 })
})

it('rejects old-generation and changed-source cursors with the original query and no implicit fresh capture', async () => {
  const f = fixture(); await f.begin()
  const first = await f.service.observe('run', { query: 'Needle', limit: 2 }), cursor = first.elementsPage!.nextCursor!
  const refreshed = await f.service.observe('run', { query: 'Needle', limit: 2 })
  expect(refreshed.generation).toBe(2)
  await expect(f.service.observe('run', { cursor })).rejects.toMatchObject({ refresh: { input: { query: 'Needle' } } })
  const currentCursor = refreshed.elementsPage!.nextCursor!
  f.setRevision(2)
  await expect(f.service.executeDocumentAction('run', f.document(), { name: 'html.observe', input: { cursor: currentCursor } }))
    .rejects.toMatchObject({ code: 'html-observation-cursor-expired', refresh: { input: { query: 'Needle' } } })
  expect(f.counts()).toEqual({ observes: 2, captures: 2, actions: 0 })
  const fresh = await f.service.executeDocumentAction('run', f.document(), { name: 'html.observe', input: { query: 'Needle', limit: 2 } })
  expect('generation' in fresh && fresh.generation).toBe(3)
  await expect(f.service.observe('run', { cursor: currentCursor })).rejects.toMatchObject({ refresh: { input: { query: 'Needle' } } })
  expect(f.counts()).toEqual({ observes: 3, captures: 3, actions: 0 })
})

it('checks current frame ownership for continuation and invalidates cursors on unknown actions', async () => {
  const f = fixture(); await f.begin()
  const first = await f.service.observe('run', { query: 'Needle', limit: 2 }), cursor = first.elementsPage!.nextCursor!
  f.failNextAction()
  const input = { operationId: 'one-click', handle: first.elements[0]!.handle }
  await expect(f.service.click('run', input)).rejects.toMatchObject({ code: 'html-action-outcome-unknown' })
  await expect(f.service.observe('run', { cursor })).rejects.toMatchObject({ refresh: { input: { query: 'Needle' } } })
  await expect(f.service.click('run', input)).rejects.toMatchObject({ code: 'html-action-outcome-unknown' })
  expect(f.counts()).toEqual({ observes: 1, captures: 1, actions: 1 })
  const refreshed = await f.service.observe('run', { query: 'Needle', limit: 2 })
  f.replaceFrame()
  await expect(f.service.observe('run', { cursor: refreshed.elementsPage!.nextCursor! })).rejects.toMatchObject({ refresh: { input: { query: 'Needle' } } })
  expect(f.counts()).toEqual({ observes: 2, captures: 2, actions: 1 })
  f.service.stopRun('run')
  await expect(f.service.observe('run', { cursor })).rejects.toThrow('停止')
})

it('returns all Published controls without an HTML page window and carries the captured CSS viewport', async () => {
  const f = fixture()
  const observed = await f.service.observePublished('published', f.publishedTarget)
  expect(observed.elements).toHaveLength(262)
  expect(observed.elementsPage).toBeUndefined()
  expect(observed.coverage).toEqual({ width: 800, height: 600, viewport: { width: 400, height: 300 } })
  expect(observed.structure).toContain('Published page')
  expect(observed.structure).toContain('Needle feedback tail')
})

it('retains each raw complete observation after a new generation without changing its historical handles', async () => {
  const f = fixture(); await f.begin()
  const first = await f.service.observe('run') as HtmlActionObservation & { fullObservation: HtmlActionObservation }
  const originalHandles = first.fullObservation.elements.map(element => element.handle)
  expect(first.elements).toHaveLength(240)
  expect(first.fullObservation.elements).toHaveLength(262)
  expect(first.fullObservation.generation).toBe(1)
  expect(Object.hasOwn(first.fullObservation, 'fullObservation')).toBe(false)
  const next = await f.service.observe('run', { query: 'Needle', limit: 2 }) as HtmlActionObservation & { fullObservation: HtmlActionObservation }
  expect(next.elements).toHaveLength(2)
  expect(next.fullObservation.elements).toHaveLength(262)
  expect(next.fullObservation.generation).toBe(2)
  expect(next.fullObservation.elements.every(element => !originalHandles.includes(element.handle))).toBe(true)
  expect(first.fullObservation.elements.map(element => element.handle)).toEqual(originalHandles)
  expect(first.fullObservation.generation).toBe(1)
  expect(first.fullObservation.image.resourceId).toBe(first.image.resourceId)
  expect(next.fullObservation.image.resourceId).not.toBe(first.image.resourceId)
})
