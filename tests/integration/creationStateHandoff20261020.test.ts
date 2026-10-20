// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Locator, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { JSDOM } from 'jsdom'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { duplicateSurfaceEdits } from '../../src/core/course/courseSurfaceStructure'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { createCreationBoundaryStateFixture, interviewInstanceId, introductionInstanceId, interviewStateKey } from '../fixtures/creation-boundary-state20261020'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'

const output = path.resolve('output/creation-boundary-implementation-20261020/E-F/state-handoff')
type CourseModel = Extract<DocumentModel, { kind: 'course-v10' }>
type Inputs = { model: CourseModel; payload: PublishedCourseV3; artifact: CompiledCoursePlayback }
let server: ViteDevServer, browser: Browser, url: string, base: Inputs, edited: Inputs
let copiedInstanceId: string, copiedSurfaceId: string

async function prepare(model: CourseModel): Promise<Inputs> {
  const published = await buildPublishedCourseV3({ project: model.project, assetBytes: {} }, {
    compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()),
  })
  const dom = new JSDOM('<!doctype html>')
  try {
    const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document,
      renderBuiltin: async () => { throw new Error('Fixture uses formal Sources only') } })
    expect(artifact.diagnostics).toEqual([])
    return { model, payload: published.payload, artifact }
  } finally { dom.window.close() }
}

beforeAll(async () => {
  await fs.mkdir(output, { recursive: true })
  const driver = new CourseV10Driver()
  const session = await DocumentSession.create({ documentId: 'state-handoff', epoch: 'state-handoff-epoch',
    model: createCreationBoundaryStateFixture(), binding: { kind: 'untitled', suggestedName: 'state-handoff.glx' } }, driver, {
    async append() {},
    async save(input) {
      if (input.binding.kind !== 'file') throw new Error('Expected file binding')
      await fs.writeFile(input.binding.path, input.bytes)
      return { ...input.binding, version: `revision-${input.revision}` }
    },
  })
  const receipts: unknown[] = []
  async function apply(operationId: string, edits: ComponentEdit[]) {
    const current = session.read()
    if (current.model.kind !== 'course-v10') throw new Error('Expected formal V10')
    const receipt = await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } })
    expect(receipt.status).toBe('applied'); receipts.push({ operationId, receipt })
    const next = session.read().model
    if (next.kind !== 'course-v10') throw new Error('Expected formal V10 after transaction')
    return next
  }
  const original = session.read().model
  if (original.kind !== 'course-v10') throw new Error('Expected V10')
  let copyIdentity = 0
  const copy = duplicateSurfaceEdits(original.project, 'page-09', () => `independent-attempt-${++copyIdentity}`)
  copiedInstanceId = copy.ids.get(interviewInstanceId)!; copiedSurfaceId = copy.surfaceId
  const copied = await apply('copy-independent-attempt', [...copy.edits, { type: 'surface.move', surfaceId: copy.surfaceId, index: 2 }])
  expect(copied.project.instances[copiedInstanceId].stateBindings).toEqual({ classPrompt: 'class-prompt' })
  base = await prepare(copied)
  await session.save({ kind: 'file', path: path.join(output, 'state-handoff.glx'), version: null, bindingVersion: 1 })
  const updated = await apply('edit-current-business-person', [{ type: 'data.set', instanceId: interviewInstanceId,
    path: ['person'], value: { id: 'person-rowan', name: 'Rowan', age: 'thirteen', country: 'Peru' } }])
  expect(updated.project.definitions).toEqual(copied.project.definitions)
  const filename = path.join(output, 'state-handoff-edited.glx')
  const saved = await session.save({ kind: 'file', path: filename, version: null, bindingVersion: 1 })
  expect(saved.dirty).toBe(false)
  const cold = driver.load(await fs.readFile(filename))
  if (cold.kind !== 'course-v10') throw new Error('Expected cold reopened V10')
  edited = await prepare(cold)
  await fs.writeFile(path.join(output, 'authoring-receipts.json'), JSON.stringify(receipts, null, 2))
  await fs.writeFile(path.join(output, 'published.json'), JSON.stringify(base.payload))
  await fs.writeFile(path.join(output, 'compiled.json'), JSON.stringify(base.artifact))
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(),
    cacheDir: path.resolve('output/.vite-creation-state-handoff'), resolve: { alias: { '@': path.resolve('src') } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'react-dom', 'zustand', 'mermaid', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/__creation-state-handoff', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><html><body><main id="fixture" style="position:relative;width:1000px;height:700px"></main><script type="module">
      import {mountPublishedCourseV3} from '/src/player/componentPlatform/publishedPlayer.ts';
      import {mountCompiledCourse} from '/src/player/componentPlatform/compiledPlayer.ts';
      window.mountProof = async (kind, input) => {
        const errors = [], options = {report: value => errors.push(value), keyboardNavigation: false};
        const player = kind === 'compiled' ? await mountCompiledCourse(input.artifact, document.querySelector('#fixture'), options)
          : await mountPublishedCourseV3(input.payload, document.querySelector('#fixture'), options);
        return {errors, read: () => player.navigation.read(), go: player.go, get: key => player.runtime.getState(key),
          snapshot: () => player.runtime.stateSnapshot(), reset: () => player.runtime.resetPlayback(true), dispose: player.dispose};
      }; window.ready = true;
    </script></body></html>`)
  })
  await server.listen(); const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server port')
  url = `http://127.0.0.1:${address.port}/__creation-state-handoff`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 90_000)

afterAll(async () => { await browser?.close(); await server?.close() })

async function panel(page: Page, id: string): Promise<Locator> {
  let found: Locator | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      const candidate = frame.locator(`[data-fixture-id="${id}"]`)
      if (await candidate.count()) { found = candidate; return true }
    }
    return false
  }, { timeout: 15000 }).toBe(true)
  return found!
}
async function mount(page: Page, kind: 'published' | 'compiled', input: Inputs) {
  await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'ready'))
  await page.evaluate(async serialized => {
    const value = JSON.parse(serialized)
    Reflect.set(window, 'proof', await Reflect.get(window, 'mountProof')(value.kind, value.input))
  }, JSON.stringify({ kind, input }))
}
async function fill(root: Locator, values: Record<string, string>) {
  for (const [field, value] of Object.entries(values)) await root.locator(`[data-field="${field}"]`).fill(value)
}
const runtimeRecord = (page: Page, id = interviewInstanceId) => page.evaluate(key => Reflect.get(window, 'proof').get(key), interviewStateKey(id))
const location = (page: Page) => page.evaluate(() => Reflect.get(window, 'proof').read().locationId)

it.each(['published', 'compiled'] as const)('%s consumes actual JSON notes on formal Next, preserves checked mistakes and isolates runtime reset/copy', async kind => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000)
  const evidence: Record<string, unknown> = { consumer: kind }
  try {
    await mount(page, kind, base)
    const interview = await panel(page, interviewInstanceId)
    const raw = { name: 'My name is Rowan.', age: 'He is twelve.', country: 'I am from Peru.' }
    await fill(interview, raw)
    await interview.locator('[data-next]').click()
    await expect.poll(() => location(page)).toBe('page-10')
    const introduction = await panel(page, introductionInstanceId)
    await expect.poll(() => introduction.locator('[data-verification]').textContent()).toBe('unchecked')
    const first = await runtimeRecord(page)
    expect(first).toMatchObject({ raw, normalized: { name: 'Rowan', age: 'twelve', country: 'Peru' }, verification: 'unchecked', matches: null,
      source: { instanceId: interviewInstanceId, activityId: 'interview-activity', personId: 'person-mia' } })
    expect(first.conversion.original).toEqual(raw)
    expect(await introduction.locator('[data-record]').textContent()).toBe('Name: Rowan; age: twelve; country: Peru')
    expect(await introduction.locator('[data-raw]').textContent()).toBe(JSON.stringify(raw))
    evidence.firstValue = first
    for (let index = 0; index < 3; index++) await introduction.locator('[data-resubscribe]').click()
    const before = Number(await introduction.getAttribute('data-render-count'))
    await introduction.locator('[data-previous]').click()
    await expect.poll(() => location(page)).toBe('page-09')
    expect(await interview.locator('[data-field="name"]').inputValue()).toBe(raw.name)
    await interview.locator('[data-check]').click()
    await expect.poll(async () => Number(await introduction.getAttribute('data-render-count'))).toBe(before + 1)
    expect(await runtimeRecord(page)).toMatchObject({ raw, verification: 'checked', matches: { name: false, age: true, country: false } })
    await interview.locator('[data-next]').click()
    await expect.poll(() => location(page)).toBe('page-10')
    await expect.poll(async () => Number(await introduction.getAttribute('data-render-count'))).toBe(before + 2)
    expect(await introduction.locator('[data-record]').textContent()).toBe('Name: Rowan; age: twelve; country: Peru')
    expect(await introduction.locator('[data-verification]').textContent()).toBe('checked')
    evidence.checkedMistake = await runtimeRecord(page)
    await page.screenshot({ path: path.join(output, `${kind}-checked-notes.png`) })
    expect(await page.evaluate(() => Reflect.get(window, 'proof').go('page-09'))).toBe(true)
    await interview.locator('[data-share]').click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'proof').get('class-prompt'))).toBe('ready')
    expect(await page.evaluate(id => Reflect.get(window, 'proof').go(id), copiedSurfaceId)).toBe(true)
    const copy = await panel(page, copiedInstanceId)
    expect(await copy.locator('[data-field="name"]').inputValue()).toBe('')
    expect(await runtimeRecord(page, copiedInstanceId)).toBeUndefined()
    await expect.poll(() => copy.locator('[data-shared]').textContent()).toBe('ready')
    await fill(copy, { name: 'New attempt', age: 'eleven', country: 'Japan' })
    await copy.locator('[data-check]').click()
    await expect.poll(() => runtimeRecord(page, copiedInstanceId)).toMatchObject({ raw: { name: 'New attempt', age: 'eleven', country: 'Japan' } })
    expect(await runtimeRecord(page)).toEqual(evidence.checkedMistake)
    evidence.copy = { instanceId: copiedInstanceId, surfaceId: copiedSurfaceId, record: await runtimeRecord(page, copiedInstanceId), sharedPrompt: 'ready' }
    await page.evaluate(() => Reflect.get(window, 'proof').reset())
    expect(await runtimeRecord(page)).toBeUndefined(); expect(await runtimeRecord(page, copiedInstanceId)).toBeUndefined()
    expect(await page.evaluate(() => Reflect.get(window, 'proof').get('class-prompt'))).toBe('listen')
    expect(await page.evaluate(() => Reflect.get(window, 'proof').go('page-09'))).toBe(true)
    const reset = await panel(page, interviewInstanceId)
    expect(await reset.locator('[data-field="name"]').inputValue()).toBe('')
    expect(await reset.locator('[data-person]').textContent()).toBe('Interview role: Mia')
    evidence.reset = { runtimeAnswer: 'cleared', authorPerson: base.model.project.instances[interviewInstanceId].data, sharedDefault: 'listen' }
    expect(await page.evaluate(() => Reflect.get(window, 'proof').errors)).toEqual([]); expect(errors).toEqual([])
    await page.evaluate(() => Reflect.get(window, 'proof').dispose())
  } finally {
    evidence.finalRuntime = await page.evaluate(() => {
      const proof = Reflect.get(window, 'proof'); return proof ? { location: proof.read().locationId, state: proof.snapshot(), errors: proof.errors } : null
    }).catch(() => null)
    evidence.frames = await Promise.all(page.frames().map(frame => frame.locator('[data-fixture-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-fixture-id'))).catch(() => [])))
    await fs.writeFile(path.join(output, `${kind}-handoff-evidence.json`), JSON.stringify({ ...evidence, errors }, null, 2))
    await page.close()
  }
}, 60_000)

it('a canonical business data edit survives save/reopen and the compiled Source displays and checks that same current person', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await mount(page, 'compiled', edited)
    const interview = await panel(page, interviewInstanceId)
    expect(await interview.locator('[data-person]').textContent()).toBe('Interview role: Rowan')
    await fill(interview, { name: 'Mia', age: 'twelve', country: 'China' }); await interview.locator('[data-check]').click()
    await expect.poll(() => runtimeRecord(page)).toMatchObject({ source: { personId: 'person-rowan' }, matches: { name: false, age: false, country: false } })
    await fill(interview, { name: 'Rowan', age: 'thirteen', country: 'Peru' }); await interview.locator('[data-check]').click()
    expect(await interview.locator('[data-feedback]').textContent()).toBe('核对：一致')
    await expect.poll(() => runtimeRecord(page)).toMatchObject({ matches: { name: true, age: true, country: true } })
    const current = await runtimeRecord(page)
    await page.screenshot({ path: path.join(output, 'compiled-business-edit.png') })
    // A runtime DOM-only cosmetic change has no semantic-data editing promise.
    await interview.locator('[data-person]').evaluate(element => { element.textContent = 'Cosmetic display only' })
    await interview.locator('[data-check]').click()
    expect(await runtimeRecord(page)).toEqual(current)
    await fs.writeFile(path.join(output, 'business-edit-evidence.json'), JSON.stringify({ result: 'no display/judgment divergence reproduced through canonical data.set',
      person: edited.model.project.instances[interviewInstanceId].data, record: current, cosmeticOverride: 'DOM-only display change does not edit business data' }, null, 2))
    expect(await page.evaluate(() => Reflect.get(window, 'proof').errors)).toEqual([]); expect(errors).toEqual([])
    await page.evaluate(() => Reflect.get(window, 'proof').dispose())
  } finally { await page.close() }
}, 60_000)
