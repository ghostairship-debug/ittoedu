// @vitest-environment node
import { chromium, type Page } from '@playwright/test'
import { expect, it } from 'vitest'
import { domAuthoringFactorySource, createDomAuthoring } from '../../src/components/web/authoringDom'
import { installOwnedDocumentAuthoring } from '../../src/components/web/ownedDocumentAuthoring'
import { authoredDocumentBootstrap, authoredDocumentProgramsSource } from '../../src/components/web/authoredDocumentBootstrap'
import { anchorOwnedDocumentAuthoring, ownedDocumentExecutionSource } from '../../src/components/web/ownedDocumentIdentity'
import { authorSpotEdits } from '../../src/core/components/authoring/componentAuthorEdits'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import type { ComponentAuthorRecord, ComponentAuthorSpot } from '../../src/shared/contracts/component-platform'
import { testContainerInstance } from '../helpers/glxWorkFixture'

const childHtml = `<!doctype html><!-- <head data-fake="wrong"> --><html><head data-blob-head="kept" data-quote="a>b"><style>body{margin:10px;font:18px Arial}h2{display:inline-block;margin:0;font-size:22px}</style></head><body data-boots="0" data-clicks="0"><h2 id="nested-title">Nested Blob title</h2><button id="nested-button">Nested counter</button><script>document.body.dataset.boots=String(Number(document.body.dataset.boots)+1);document.getElementById('nested-button').onclick=()=>document.body.dataset.clicks=String(Number(document.body.dataset.clicks)+1);<\/script></body></html>`
const original = `<!doctype html><html><head></head><body><iframe id="known" style="width:620px;height:130px;transform:scale(.75);transform-origin:0 0"></iframe><script>window.__rootBoots=(window.__rootBoots||0)+1;const source=${JSON.stringify(childHtml).replace(/</g, '\\u003c')};document.getElementById('known').src=URL.createObjectURL(new Blob([source],{type:'text/html'}));<\/script></body></html>`
type Report = ReturnType<ReturnType<typeof installOwnedDocumentAuthoring>['reports']>[number]
const token = '__guoling_parser_blob_test'
async function mount(page: Page, html: string, records: Record<string, ComponentAuthorRecord> = {}, authoring = true) {
  const prepared = authoredDocumentBootstrap({ html }, { nonce: 'blob-test', instanceId: 'web', resources: {}, authoring,
    bridge: programs => `${authoredDocumentProgramsSource(programs)};window.__q={records:${JSON.stringify(records)},pointers:[]};window.__q.owner=(${installOwnedDocumentAuthoring.toString()})(${JSON.stringify(programs.property)},'',${domAuthoringFactorySource()},{records:()=>window.__q.records,resources:()=>({}),bindings:()=>({}),observe:${authoring},activity:()=>({active:true,visible:true,playing:false}),blobCarriers:()=>window[${JSON.stringify(programs.property)}].blobCarriers,onPointer:value=>window.__q.pointers.push(value)});window.dispatchEvent(new CustomEvent('__runtime.activity',{detail:{active:true,visible:true,playing:false}}));`,
  })
  await page.locator('#root').evaluate((element, html) => { (element as HTMLIFrameElement).srcdoc = html }, prepared)
  const root = page.frameLocator('#root'), child = root.frameLocator('#known')
  await child.locator('#nested-title').waitFor()
  if (authoring) await expect.poll(() => root.locator('body').evaluate(() => (window as any).__q.owner.reports().length)).toBeGreaterThan(0)
  return { root, child }
}

it('anchors only the source-known non-srcdoc leaf and retains static srcdoc identity semantics', () => {
  const anchored = anchorOwnedDocumentAuthoring(original, 'pending:0:frame-key')
  expect(anchored.documentPath).toBe('key:frame-key')
  expect(ownedDocumentExecutionSource(anchored.html)).toBe(original)
  expect(anchored.html).toContain('data-cw-author-key="frame-key"')
  expect(() => anchorOwnedDocumentAuthoring(original, 'pending:0:frame-key/pending:0:inner')).toThrow('源码已不存在')
  const staticSource = `<iframe srcdoc="&lt;p&gt;Static title&lt;/p&gt;"></iframe>`
  const staticAnchor = anchorOwnedDocumentAuthoring(staticSource, 'pending:0:static-key')
  expect(ownedDocumentExecutionSource(staticAnchor.html)).toBe(ownedDocumentExecutionSource(staticSource))
})

it('serializes the one owned Blob tree, blocks edit business, preserves canonical records and retires pending navigation', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(), errors: string[] = []
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<iframe id="root" sandbox="allow-scripts" style="width:900px;height:600px"></iframe>')
    let mounted
    try { mounted = await mount(page, original) } catch (error) { console.error(JSON.stringify({ pageErrors: errors, frames: page.frames().map(frame => frame.url()) })); throw error }
    let { root, child } = mounted
    const reports = () => root.locator('body').evaluate(() => (window as any).__q.owner.reports()) as Promise<Report[]>
    const title = () => reports().then(values => values.find(value => value.authoring.record.binding.path.at(-1)?.attributes?.id === 'nested-title')!)
    const first = await title()
    expect(first.authoring.record.scope?.['document:path']).toMatch(/^pending:0:/)
    expect(first.bindingStatus).toBe('bound')
    expect(await child.locator('head').getAttribute('data-blob-head')).toBe('kept')
    expect(await child.locator('head').getAttribute('data-quote')).toBe('a>b')
    await child.locator('#nested-button').click()
    await expect.poll(() => child.locator('body').getAttribute('data-clicks')).toBe('0')
    await expect.poll(() => child.locator('body').getAttribute('data-boots')).toBe('1')
    expect(await root.locator('body').evaluate(() => (window as any).__rootBoots)).toBe(1)
    expect(await root.locator('body').evaluate(() => (window as any).__q.pointers.at(-1).authorKey)).toBeTruthy()

    const project = createBlankCourseProjectV10('Blob author identity')
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
    project.instances.web = { id: 'web', definitionId: 'web', authoring: { records: {} }, data: { html: original } }
    testContainerInstance(project, 0).childIds = ['web']
    const resources = { assets: {}, components: {} }
    const session = await DocumentSession.create({ documentId: 'blob-document', epoch: 'live', saved: true,
      binding: { kind: 'untitled', suggestedName: 'blob.glx' }, model: { kind: 'course-v10', project, resources } }, new CourseV10Driver(),
    { async append() {}, async save(): Promise<never> { throw new Error('No file save in the Blob author fixture') } })
    const spot: ComponentAuthorSpot = { id: 'title', instanceId: 'web', mountGeneration: 1, kind: first.kind, initialValue: first.rawText,
      authorKey: first.authoring.authorKey, scope: first.authoring.record.scope, binding: first.authoring.record.binding,
      bindingStatus: first.bindingStatus, fieldScope: 'authoring', dataPath: ['records', first.authoring.authorKey, 'overrides', 'text'],
      localBounds: { width: first.rect.width, height: first.rect.height, transform: [1, 0, 0, 1, first.rect.x, first.rect.y] } }
    const edits = authorSpotEdits(project, spot, 'Nested after', resources)
    expect((await session.execute({ documentId: session.documentId, epoch: 'live', operationId: 'edit', actor: 'human', baseRevision: 0,
      mutation: { type: 'command', command: captureComponentOperation(project, edits) } })).status).toBe('applied')
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected course')
    const html = (model.project.instances.web.data as { html: string }).html
    expect(ownedDocumentExecutionSource(html)).toBe(original)
    const records = model.project.instances.web.authoring!.records!
    await root.locator('body').evaluate((_, records) => { const q = (window as any).__q; q.records = records; q.owner.update() }, records)
    await expect.poll(() => child.locator('#nested-title').textContent()).toBe('Nested after')
    await expect.poll(() => child.locator('body').getAttribute('data-boots')).toBe('1')
    expect(session.read().undoDepth).toBe(1)
    for (const type of ['undo', 'redo'] as const) {
      expect((await session.execute({ documentId: session.documentId, epoch: 'live', operationId: type, actor: 'human',
        baseRevision: session.readIdentity().revision, mutation: { type } })).status).toBe('applied')
      const value = session.read().model
      if (value.kind !== 'course-v10') throw new Error('Expected course')
      await root.locator('body').evaluate((_, records) => { const q = (window as any).__q; q.records = records; q.owner.update() }, value.project.instances.web.authoring?.records ?? {})
      await expect.poll(() => child.locator('#nested-title').textContent()).toBe(type === 'undo' ? 'Nested Blob title' : 'Nested after')
      await expect.poll(() => child.locator('body').getAttribute('data-boots')).toBe('1')
    }
    ;({ root, child } = await mount(page, html, records))
    await expect.poll(() => child.locator('#nested-title').textContent()).toBe('Nested after')
    expect((await title()).authoring.record.scope?.['document:path']).toMatch(/^key:/)
    await expect.poll(() => child.locator('body').getAttribute('data-boots')).toBe('1')
    // A pending local Blob must never replay after a later explicit navigation.
    await root.locator('body').evaluate(() => {
      const q = (window as any).__q, frame = document.getElementById('known') as HTMLIFrameElement
      const delayed = new Blob([''], { type: 'text/html' })
      delayed.text = () => new Promise(resolve => { q.resolveDelayed = resolve })
      q.delayedUrl = URL.createObjectURL(delayed); frame.src = q.delayedUrl; frame.src = 'about:blank'
    })
    await expect.poll(() => reports().then(values => values.length)).toBe(0)
    await root.locator('body').evaluate((_, html) => (window as any).__q.resolveDelayed(html), childHtml)
    await expect.poll(() => child.locator('body').textContent()).toBe('')
    expect(await root.locator('body').evaluate((_, token) => (window as any)[token].blobCarriers.frames().length, token)).toBe(0)
    await root.locator('body').evaluate(() => URL.revokeObjectURL((window as any).__q.delayedUrl))
    const readonlyChild = childHtml.replace('</script>', "document.getElementById('nested-button').click();</script>")
    const readonlyHtml = original.replace(JSON.stringify(childHtml).replace(/</g, '\\u003c'), JSON.stringify(readonlyChild).replace(/</g, '\\u003c'))
    ;({ root, child } = await mount(page, readonlyHtml, {}, false))
    await expect.poll(() => child.locator('body').getAttribute('data-clicks')).toBe('1')
    await child.locator('#nested-button').click()
    await expect.poll(() => child.locator('body').getAttribute('data-clicks')).toBe('2')
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30_000)
