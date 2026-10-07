// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'

// Geometry is fixed; target resolution, resources, source carrier, Gateway and Session are real.
vi.mock('../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement', async () => {
  const { sourceProgramAssembly } = await import('../../src/core/contentApply/assembly/htmlAssembly')
  return { measureHtmlAtDesignViewport: vi.fn(async (request: HtmlDesignMeasurementRequest) =>
    sourceProgramAssembly(request.viewport, { html: request.html }, 'script')) }
})

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const html = `<!doctype html><html><head><title>Observation</title></head><body>
<h1>Observe</h1><img alt="Experiment" src="data:image/png;base64,${png}">
<button id="switch">Switch</button><output id="count">0</output>
<script>document.getElementById('switch').onclick = () => { const count = document.getElementById('count'); count.textContent = String(Number(count.textContent) + 1) }</script>
</body></html>`

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10 fixture')
  return snapshot.model
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-audit-content-'))
  const host = new DocumentHostService(path.join(root, 'recovery'))
  const project = createBlankCourseProjectV10('Content truth')
  const initial = await host.internalAPI.create({ kind: 'course-v10', project,
    resources: { assets: {}, components: {} } }, 'content-truth.h5lesson')
  await host.tools.beginRun({ runId: 'content-truth', actor: 'agent',
    documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  await host.tools.loadToolFamilies('content-truth', ['content'])
  let serial = 0
  const call = (name: string, input: unknown) => host.tools.execute('content-truth', `call-${++serial}`, { name, input })
  const apply = async (input: unknown) => {
    const result = await call('project.apply', input)
    expect(result.kind).toBe('read')
    if (result.kind !== 'read') throw new Error(JSON.stringify(result))
    return result.data as ContentApplyResult
  }
  const page = componentProjectFiles(project, course(initial).resources).find(file => file.kind === 'page')!
  const human = async (edits: ComponentEdit[]) => {
    const snapshot = await host.internalAPI.read(initial.documentId)
    return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
      baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(course(snapshot).project, edits) } })
  }
  const dispose = async () => {
    await host.tools.stop('content-truth')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  }
  return { root, host, initial, page, call, apply, human, dispose }
}

it.each(['content', 'from'] as const)('fills an observed empty page through %s, retaining script, image and one undo', async source => {
  const context = await fixture(), { root, host, initial, page, call, apply } = context
  try {
    expect(page.projection?.entries).toEqual([])
    await call('project.read', { path: page.path })
    await fs.writeFile(path.join(root, 'author.html'), html)
    const inserted = await apply({ path: page.path, intent: 'content', ...(source === 'content' ? { content: html } : { from: 'author.html' }) })
    expect(inserted).toMatchObject({ commit: 'committed', usability: 'unverified', receipt: { status: 'applied' },
      input: { intent: 'content', source: { kind: 'html', html } } })
    expect(inserted.diagnostics).toEqual([expect.objectContaining({ level: 'info', code: 'html-source-program' })])
    const current = await host.internalAPI.read(initial.documentId), model = course(current)
    expect(current.undoDepth).toBe(1)
    expect(model.project.surfaces[0]!.childIds).toEqual(inserted.insertedIds)
    expect(model.project.global).toEqual(course(initial).project.global)
    const instance = model.project.instances[inserted.insertedIds[0]!]!
    expect(model.project.definitions[instance.definitionId]!.implementation).toEqual({ kind: 'builtin', key: 'guoling.html-program' })
    const data = instance.data as { html: string; resourceBindings: Record<string, string> }
    const dom = new JSDOM(data.html, { runScripts: 'dangerously' })
    try {
      const image = dom.window.document.querySelector('img')!, reference = image.getAttribute('src')!
      const assetId = data.resourceBindings[reference]!
      expect(reference).toMatch(/^cw-resource:/)
      expect(model.project.assets[assetId]).toMatchObject({ mimeType: 'image/png' })
      expect(model.resources.assets[assetId]!.byteLength).toBeGreaterThan(0)
      dom.window.document.getElementById('switch')!.click()
      expect(dom.window.document.getElementById('count')!.textContent).toBe('1')
    } finally { dom.window.close() }
    if (source === 'from') {
      const original = Object.values(model.project.assets).find(asset => asset.filename === 'author.html')!
      expect(new TextDecoder().decode(model.resources.assets[original.id])).toBe(html)
      expect(await fs.readFile(path.join(root, 'author.html'), 'utf8')).toBe(html)
    }
    const object = componentProjectFiles(model.project, model.resources).find(file => file.kind === 'html' && file.target?.kind === 'instance')!
    expect(await call('project.read', { path: object.path })).toMatchObject({ kind: 'read', data: { content: object.content } })
    expect(await apply({ path: object.path, content: object.content, intent: 'content' }))
      .toMatchObject({ commit: 'unchanged', insertedIds: [] })
    const equivalent = await host.internalAPI.read(initial.documentId)
    expect(equivalent.revision).toBe(current.revision)
    expect(equivalent.undoDepth).toBe(1)
    expect(course(equivalent)).toEqual(model)
    expect((await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch,
      baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
    const undone = await host.internalAPI.read(initial.documentId)
    expect(undone.undoDepth).toBe(0)
    expect(course(undone).project.surfaces[0]!.childIds).toEqual([])
    expect(course(undone).project.instances).toEqual(course(initial).project.instances)
    expect(course(undone).project.assets).toEqual(course(initial).project.assets)
    expect(course(undone).resources).toEqual(course(initial).resources)
  } finally { await context.dispose() }
})

it('keeps a populated page content edit on its existing object and human frame', async () => {
  const context = await fixture(), { host, initial, page, call, apply, human } = context
  try {
    await call('project.read', { path: page.path })
    const inserted = await apply({ path: page.path, intent: 'insert', content: html })
    const instanceId = inserted.insertedIds[0]!, frame = { width: 440, height: 310, transform: [1, 0, 0, 1, 123, 87] as [number, number, number, number, number, number] }
    expect((await human([{ type: 'frame.set', instanceId, frame }])).status).toBe('applied')
    const before = await host.internalAPI.read(initial.documentId)
    const observed = await call('project.read', { path: page.path })
    if (observed.kind !== 'read') throw new Error(JSON.stringify(observed))
    const source = (observed.data as { content: string }).content.replace('<h1>Observe</h1>', '<h1>Observe carefully</h1>')
    const edited = await apply({ path: page.path, content: source })
    expect(edited).toMatchObject({ commit: 'committed', insertedIds: [] })
    const after = await host.internalAPI.read(initial.documentId), model = course(after)
    expect(model.project.surfaces).toEqual(course(before).project.surfaces)
    expect(Object.keys(model.project.instances)).toEqual(Object.keys(course(before).project.instances))
    expect(model.project.instances[instanceId]!.frame).toEqual(frame)
    expect(model.project.instances[instanceId]!.data).toMatchObject({ html: expect.stringContaining('Observe carefully') })
    expect(model.project.global).toEqual(course(before).project.global)
    expect(model.resources).toEqual(course(before).resources)
  } finally { await context.dispose() }
})

it('rejects an empty-page fill if a human populated that observed surface meanwhile', async () => {
  const context = await fixture(), { host, initial, page, call, apply, human } = context
  try {
    await call('project.read', { path: page.path })
    const surfaceId = course(initial).project.surfaces[0]!.id
    expect((await human([
      { type: 'definition.set', definition: { id: 'human-web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } },
      { type: 'instance.insert', container: { kind: 'surface', surfaceId }, index: 0, rootIds: ['human-object'],
        instances: [{ id: 'human-object', definitionId: 'human-web', data: { html: '<p>Human content</p>' },
          frame: { width: 210, height: 90, transform: [1, 0, 0, 1, 35, 70] } }] },
    ])).status).toBe('applied')
    const before = await host.internalAPI.read(initial.documentId)
    const rejected = await apply({ path: page.path, intent: 'content', content: html })
    expect(rejected).toMatchObject({ commit: 'not_committed', insertedIds: [], receipt: { status: 'conflict' } })
    const after = await host.internalAPI.read(initial.documentId)
    expect(after.revision).toBe(before.revision)
    expect(after.undoDepth).toBe(before.undoDepth)
    expect(course(after)).toEqual(course(before))
  } finally { await context.dispose() }
})
