import { testContainerInstance } from '../helpers/glxWorkFixture'
// @vitest-environment node
import { chromium, type FrameLocator, type Page } from '@playwright/test'
import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5'
import { expect, it } from 'vitest'
import { domAuthoringFactorySource, createDomAuthoring } from '../../src/components/web/authoringDom'
import { authoredDocumentBootstrap, authoredDocumentProgramsSource } from '../../src/components/web/authoredDocumentBootstrap'
import { installOwnedDocumentAuthoring } from '../../src/components/web/ownedDocumentAuthoring'
import { createAuthoringFrameGeometry } from '../../src/components/web/authoringFrame'
import { resolveWebResourceBindings } from '../../src/components/web/resources'
import { webRuntimeResourceAddress } from '../../src/components/web/resourceUrlLease'
import { webDataSchema } from '../../src/components/web/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { authorSpotEdits } from '../../src/core/components/authoring/componentAuthorEdits'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentAuthorSpot, ComponentAuthorRecord } from '../../src/shared/contracts/component-platform'
import type { DocumentResources } from '../../src/shared/workbench/document'

type OwnedReport = ReturnType<ReturnType<typeof installOwnedDocumentAuthoring>['reports']>[number]
const sameTitle = 'Same title', pageCopyTitle = 'Page copy title'
const svg = (color: string, width: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="12"><rect width="100%" height="100%" fill="${color}"/></svg>`
const media = { original: svg('red', 20), replacement: svg('blue', 40) }
const resourceUrls = Object.fromEntries(Object.entries(media).map(([id, source]) => [id, `data:image/svg+xml,${encodeURIComponent(source)}`]))
const bindings = { 'cw-resource:original': 'original', 'cw-resource:replacement': 'replacement' }
const quote = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

function documentHtml(extra = '') {
  return `<!doctype html><html><head><style>
    body{margin:0;font:16px/24px sans-serif;perspective:1000px}p{position:absolute;left:10px;top:8px;width:230px;height:26px;margin:0}
    img{position:absolute;left:10px;top:48px;width:40px;height:24px}button{position:absolute;left:100px;top:48px}
    iframe{position:absolute;box-sizing:content-box}
    </style></head><body><p id="title">${sameTitle}</p><img id="photo" src="cw-resource:original">
    <button id="counter">Count 0</button>${extra}<script>
      window.__boots=(window.__boots||0)+1;let count=0;
      document.getElementById('counter').addEventListener('click',event=>event.currentTarget.textContent='Count '+ ++count);
    </script></body></html>`
}

function modelFixture() {
  const grandchild = documentHtml()
  const child = documentHtml(`<iframe id="grandchild" sandbox="allow-scripts" style="left:18px;top:90px;width:285px;height:125px;border:3px solid black" srcdoc="${quote(grandchild)}"></iframe>`)
  const html = documentHtml(`<iframe id="child" sandbox="allow-scripts" style="left:20px;top:90px;width:360px;height:280px;border:5px solid black;transform:scale(.9);transform-origin:top left" srcdoc="${quote(child)}"></iframe>
    <iframe id="sibling" sandbox="allow-scripts" style="left:440px;top:90px;width:320px;height:230px;border:2px solid black" srcdoc="${quote(documentHtml())}"></iframe>`)
  const project = createBlankCourseProjectV10('Owned nested documents')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.instances.web = { id: 'web', definitionId: 'web', authoring: { records: {} }, data: { html, resourceBindings: bindings,
    textOverrides: [{ original: sameTitle, text: pageCopyTitle }] } }
  testContainerInstance(project, 0).childIds = ['web']
  const resources: DocumentResources = { assets: {}, components: {} }
  for (const [id, source] of Object.entries(media)) {
    project.assets[id] = { id, path: `assets/${id}.svg`, mimeType: 'image/svg+xml' }
    resources.assets[id] = new TextEncoder().encode(source)
  }
  return { project, resources }
}

async function mount(page: Page, html: string, records: Record<string, ComponentAuthorRecord> = {}) {
  const projected = resolveWebResourceBindings({ id: 'web', definitionId: 'web', data: { html, resourceBindings: bindings,
    textOverrides: [{ original: sameTitle, text: pageCopyTitle }] } }, id => resourceUrls[id] ? webRuntimeResourceAddress(id) : undefined)
  const prepared = authoredDocumentBootstrap(webDataSchema.parse(projected.data), {
    nonce: 'nested-authoring', instanceId: 'web', resources: resourceUrls,
    bridge: programs => `${authoredDocumentProgramsSource(programs)};
      const q=window.__nestedFixture={records:${JSON.stringify(records)},resources:${JSON.stringify(resourceUrls)},bindings:${JSON.stringify(bindings)},doubleClicks:[]};
      q.owner=(${installOwnedDocumentAuthoring.toString()})(${JSON.stringify(programs.property)},'',${domAuthoringFactorySource()},{
        records:()=>q.records,resources:()=>q.resources,bindings:()=>q.bindings,observe:true,
        onDoubleClick:point=>q.doubleClicks.push(point)
      },(${createAuthoringFrameGeometry.toString()}));`,
  })
  await page.locator('#root').evaluate((element, source) => { (element as HTMLIFrameElement).srcdoc = source }, prepared)
  const root = page.frameLocator('#root'), child = root.frameLocator('#child'), grandchild = child.frameLocator('#grandchild')
  const sibling = root.frameLocator('#sibling')
  await grandchild.locator('#title').waitFor()
  return { root, child, grandchild, sibling }
}

const reports = (root: FrameLocator): Promise<OwnedReport[]> => root.locator('body').evaluate(() => (window as any).__nestedFixture.owner.reports())
const documentPath = (report: OwnedReport) => report.authoring.record.scope?.['document:path'] ?? ''
function pendingPath(values: OwnedReport[], indices: string) {
  const report = values.find(value => documentPath(value).split('/').map(segment => /^pending:(\d+):/.exec(segment)?.[1]).join('/') === indices)
  if (!report) throw new Error(`No initial document observation at ${indices}`)
  return documentPath(report)
}
const anchoredPath = (path: string) => path.replace(/(^|\/)pending:\d+:([^/]+)/g, '$1key:$2')
function titleReport(values: OwnedReport[], path: string) {
  const result = values.find(value => value.kind === 'text' && value.authoring.record.scope?.['document:path'] === path
    && value.authoring.record.binding.path.at(-1)?.attributes?.id === 'title')
  if (!result) throw new Error(`No title observation in owned document ${path}`)
  return result
}
function iframeIn(document: DefaultTreeAdapterTypes.ParentNode, id: string): DefaultTreeAdapterTypes.Element {
  for (const node of document.childNodes) {
    if ('tagName' in node && node.tagName === 'iframe' && node.attrs.some(attribute => attribute.name === 'id' && attribute.value === id)) return node
    if ('childNodes' in node) {
      const found = (() => { try { return iframeIn(node, id) } catch { return undefined } })()
      if (found) return found
    }
  }
  throw new Error(`No iframe ${id}`)
}
function withoutFrameKeys(html: string): string {
  const parsed = parse(html)
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node && node.tagName === 'iframe') {
      node.attrs = node.attrs.filter(attribute => attribute.name !== 'data-cw-author-key')
      const srcdoc = node.attrs.find(attribute => attribute.name === 'srcdoc')
      if (srcdoc) srcdoc.value = withoutFrameKeys(srcdoc.value)
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parsed)
  return serialize(parsed)
}
function changeNestedSource(html: string, action: 'insert' | 'reorder'): string {
  const parsed = parse(html), srcdoc = iframeIn(parsed, 'child').attrs.find(attribute => attribute.name === 'srcdoc')!
  const child = parse(srcdoc.value), original = iframeIn(child, 'grandchild'), siblings = original.parentNode!.childNodes
  if (action === 'insert') {
    const added = parseFragment(`<iframe id="inserted" sandbox="allow-scripts" style="left:18px;top:90px;width:285px;height:125px;border:3px solid black" srcdoc="${quote(documentHtml())}"></iframe>`).childNodes[0]!
    added.parentNode = original.parentNode
    siblings.splice(siblings.indexOf(original), 0, added)
  } else {
    const added = iframeIn(child, 'inserted')
    siblings.splice(siblings.indexOf(original), 1)
    siblings.splice(siblings.indexOf(added), 0, original)
  }
  srcdoc.value = serialize(child)
  return serialize(parsed)
}
function spot(report: OwnedReport): ComponentAuthorSpot {
  return { id: report.handle, instanceId: 'web', mountGeneration: 1, kind: report.kind,
    authorKey: report.authoring.authorKey, scope: report.authoring.record.scope, binding: report.authoring.record.binding,
    bindingStatus: report.bindingStatus, initialValue: report.rawText,
    localBounds: report.geometry?.frame ?? { width: report.rect.width, height: report.rect.height,
      transform: [1, 0, 0, 1, report.rect.x, report.rect.y] } }
}

it('edits a newly observed opaque grandchild through the document writer and cold replay while preserving scoped peers, resources and live programs', async () => {
  const { project, resources } = modelFixture(), browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } }), errors: string[] = []
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><iframe id="root" sandbox="allow-scripts" style="width:900px;height:450px;border:0"></iframe>')
  try {
    let frames = await mount(page, (project.instances.web.data as { html: string }).html)
    await expect.poll(async () => (await reports(frames.root)).filter(value => value.authoring.record.binding.path.at(-1)?.attributes?.id === 'title').length).toBe(3)
    const observed = await reports(frames.root), childPath = pendingPath(observed, '0'), nestedPath = pendingPath(observed, '0/0'), siblingPath = pendingPath(observed, '1')
    const nestedTitle = titleReport(observed, nestedPath), stableNestedPath = anchoredPath(nestedPath), stableChildPath = anchoredPath(childPath)
    expect([childPath, nestedPath, siblingPath].map(path => titleReport(observed, path).rawText)).toEqual([sameTitle, sameTitle, sameTitle])
    expect(new Set([childPath, nestedPath, siblingPath].map(path => titleReport(observed, path).authoring.authorKey)).size).toBe(3)
    expect(nestedTitle.bindingStatus).toBe('bound')
    expect(nestedTitle.authoring.record.binding.baseline).toBe(sameTitle)
    expect(await frames.grandchild.locator('#title').textContent()).toBe(pageCopyTitle)
    for (const realm of [frames.root, frames.child, frames.grandchild]) expect(await realm.locator('body').evaluate(element => getComputedStyle(element).perspective)).toBe('1000px')
    expect(nestedTitle.rect.width).toBeGreaterThan(0)
    // Browser automation can inspect opaque realms; their own parent access remains forbidden.
    expect(await frames.grandchild.locator('body').evaluate(() => {
      try { return Boolean(parent.document.body) } catch { return false }
    })).toBe(false)

    const center = { x: nestedTitle.rect.x + nestedTitle.rect.width / 2, y: nestedTitle.rect.y + nestedTitle.rect.height / 2 }
    expect(await frames.root.locator('body').evaluate((_body, point) => (window as any).__nestedFixture.owner.hit(point.x, point.y), center)).toBe(nestedTitle.authoring.authorKey)
    await frames.grandchild.locator('#title').dblclick({ position: { x: 16, y: 12 } })
    await expect.poll(() => frames.root.locator('body').evaluate(() => (window as any).__nestedFixture.doubleClicks.length)).toBe(1)
    const doubleClick = await frames.root.locator('body').evaluate(() => (window as any).__nestedFixture.doubleClicks[0])
    expect(doubleClick.authorKey).toBe(nestedTitle.authoring.authorKey)
    expect(doubleClick.x).toBeGreaterThanOrEqual(nestedTitle.rect.x)
    expect(doubleClick.x).toBeLessThanOrEqual(nestedTitle.rect.x + nestedTitle.rect.width)
    expect(doubleClick.y).toBeGreaterThanOrEqual(nestedTitle.rect.y)
    expect(doubleClick.y).toBeLessThanOrEqual(nestedTitle.rect.y + nestedTitle.rect.height)

    await frames.grandchild.locator('#counter').click()
    expect(await frames.grandchild.locator('#counter').textContent()).toBe('Count 1')
    const image = observed.find(value => value.kind === 'image' && documentPath(value) === nestedPath)!
    expect(image.rawText).toBe('cw-resource:original')
    const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'nested', epoch: 'epoch',
      binding: { kind: 'untitled', suggestedName: 'nested' }, model: { kind: 'course-v10', project, resources } }, driver,
    { async append() {}, async save() { throw new Error('Unused in serialization test') } })
    const edits = [...authorSpotEdits(project, spot(nestedTitle), 'Local grandchild title', resources),
      ...authorSpotEdits(project, spot(image), 'cw-resource:replacement', resources)]
    const result = await session.execute({ documentId: 'nested', epoch: 'epoch', baseRevision: 0, operationId: 'nested-local-edit', actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(project, edits) } })
    expect(result.status).toBe('applied')
    expect(session.read().undoDepth).toBe(1)
    const changed = session.read().model
    if (changed.kind !== 'course-v10') throw new Error('Expected V10')
    const records = changed.project.instances.web.authoring!.records!
    expect(Object.values(records).map(record => record.scope?.['document:path'])).toEqual([stableNestedPath, stableNestedPath])
    const anchoredHtml = (changed.project.instances.web.data as { html: string }).html
    expect(anchoredHtml).toContain('data-cw-author-key=')
    expect(withoutFrameKeys(anchoredHtml)).toBe(withoutFrameKeys((project.instances.web.data as { html: string }).html))
    await frames.root.locator('body').evaluate((_body, records) => { const q = (window as any).__nestedFixture; q.records = records; q.owner.update() }, records)
    await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe('Local grandchild title')
    await expect.poll(async () => titleReport(await reports(frames.root), stableNestedPath).authoring.authorKey).toBe(nestedTitle.authoring.authorKey)
    await expect.poll(() => frames.grandchild.locator('#photo').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(40)
    expect(await frames.grandchild.locator('#counter').textContent()).toBe('Count 1')
    expect(await frames.grandchild.locator('body').evaluate(() => (window as any).__boots)).toBe(1)
    for (const peer of [frames.root, frames.child, frames.sibling]) {
      expect(await peer.locator('#title').textContent()).toBe(pageCopyTitle)
      expect(await peer.locator('#photo').evaluate(async (node: HTMLImageElement) => ({
        width: node.naturalWidth, height: node.naturalHeight, source: await (await fetch(node.currentSrc)).text(),
      }))).toEqual({ width: 20, height: 12, source: media.original })
    }

    await frames.root.locator('body').evaluate((_body, key) => (window as any).__nestedFixture.owner.preview(key, { translateX: 12 }), nestedTitle.authoring.authorKey)
    await expect.poll(() => frames.grandchild.locator('#title').evaluate(element => element.style.translate)).toContain('12px')
    await frames.root.locator('body').evaluate((_body, key) => (window as any).__nestedFixture.owner.preview(key, null), nestedTitle.authoring.authorKey)
    await expect.poll(() => frames.grandchild.locator('#title').evaluate(element => element.style.translate)).toBe('')
    await frames.grandchild.locator('#counter').click()
    expect(await frames.grandchild.locator('#counter').textContent()).toBe('Count 2')

    const undoneResult = await session.execute({ documentId: 'nested', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: 'undo-nested-local-edit', actor: 'human', mutation: { type: 'undo' } })
    expect(undoneResult.status).toBe('applied')
    const undone = session.read().model
    if (undone.kind !== 'course-v10') throw new Error('Expected undone V10')
    expect((undone.project.instances.web.data as { html: string }).html).toBe((project.instances.web.data as { html: string }).html)
    await frames.root.locator('body').evaluate((_body, records) => { const q = (window as any).__nestedFixture; q.records = records; q.owner.update() },
      undone.project.instances.web.authoring?.records ?? {})
    await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe(pageCopyTitle)
    await expect.poll(async () => titleReport(await reports(frames.root), nestedPath).rawText).toBe(sameTitle)
    const afterUndo = titleReport(await reports(frames.root), nestedPath)
    const reeditedResult = await session.execute({ documentId: 'nested', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: 'reedit-after-undo', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(undone.project,
        authorSpotEdits(undone.project, spot(afterUndo), 'Reedited after undo', undone.resources)) } })
    expect(reeditedResult.status).toBe('applied')
    const reedited = session.read().model
    if (reedited.kind !== 'course-v10') throw new Error('Expected reedited V10')
    await frames.root.locator('body').evaluate((_body, records) => { const q = (window as any).__nestedFixture; q.records = records; q.owner.update() },
      reedited.project.instances.web.authoring!.records)
    await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe('Reedited after undo')
    await expect.poll(async () => titleReport(await reports(frames.root), stableNestedPath).authoring.authorKey).toBe(afterUndo.authoring.authorKey)
    expect(await frames.grandchild.locator('#counter').textContent()).toBe('Count 2')
    expect(await frames.grandchild.locator('body').evaluate(() => (window as any).__boots)).toBe(1)
    // Continue the cold/source cases from the original saved snapshot.
    await frames.root.locator('body').evaluate((_body, records) => { const q = (window as any).__nestedFixture; q.records = records; q.owner.update() }, records)
    await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe('Local grandchild title')

    const cold = driver.load(driver.serialize(changed))
    if (cold.kind !== 'course-v10') throw new Error('Expected cold V10')
    expect(cold.project.instances.web.authoring).toEqual(changed.project.instances.web.authoring)
    await frames.root.locator('body').evaluate(() => (window as any).__nestedFixture.owner.dispose())
    frames = await mount(page, (cold.project.instances.web.data as { html: string }).html, cold.project.instances.web.authoring!.records)
    await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe('Local grandchild title')
    await expect.poll(() => frames.grandchild.locator('#photo').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(40)
    await expect.poll(async () => titleReport(await reports(frames.root), stableNestedPath).authoring.authorKey).toBe(nestedTitle.authoring.authorKey)
    for (const peer of [frames.root, frames.child, frames.sibling]) expect(await peer.locator('#title').textContent()).toBe(pageCopyTitle)
    await frames.grandchild.locator('#counter').click()
    expect(await frames.grandchild.locator('#counter').textContent()).toBe('Count 1')
    // A newly loaded child receives the current author state, including image bindings.
    await frames.child.locator('#grandchild').evaluate(element => { const frame = element as HTMLIFrameElement; frame.srcdoc = frame.srcdoc })
    await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe('Local grandchild title')
    await expect.poll(() => frames.grandchild.locator('#photo').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(40)
    expect(await frames.grandchild.locator('#counter').textContent()).toBe('Count 0')
    await expect.poll(async () => titleReport(await reports(frames.root), stableNestedPath).authoring.authorKey).toBe(nestedTitle.authoring.authorKey)
    await frames.child.locator('#grandchild').evaluate(element => element.remove())
    await expect.poll(async () => (await reports(frames.root)).filter(value => documentPath(value) === stableNestedPath).length).toBe(0)
    expect(titleReport(await reports(frames.root), stableChildPath).rawText).toBe(sameTitle)

    let sourceModel = cold
    for (const action of ['insert', 'reorder'] as const) {
      const html = changeNestedSource((sourceModel.project.instances.web.data as { html: string }).html, action)
      const reopened = driver.load(driver.serialize(driver.apply(sourceModel, captureComponentOperation(sourceModel.project,
        [{ type: 'data.set', instanceId: 'web', path: ['html'], value: html }]))))
      if (reopened.kind !== 'course-v10') throw new Error('Expected source-edited V10')
      sourceModel = reopened
      await frames.root.locator('body').evaluate(() => (window as any).__nestedFixture.owner.dispose())
      frames = await mount(page, html, reopened.project.instances.web.authoring!.records)
      const inserted = frames.child.frameLocator('#inserted')
      await expect.poll(() => frames.grandchild.locator('#title').textContent()).toBe('Local grandchild title')
      await expect.poll(() => frames.grandchild.locator('#photo').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(40)
      expect(await inserted.locator('#title').textContent()).toBe(pageCopyTitle)
      expect(await inserted.locator('#photo').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(20)
      expect(await frames.child.locator('iframe').evaluateAll(elements => elements.map(element => element.id))).toEqual(action === 'insert'
        ? ['inserted', 'grandchild'] : ['grandchild', 'inserted'])
      await expect.poll(async () => titleReport(await reports(frames.root), stableNestedPath).authoring.authorKey).toBe(nestedTitle.authoring.authorKey)
    }
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30000)
