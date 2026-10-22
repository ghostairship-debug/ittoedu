import { testContainerInstance } from '../helpers/glxWorkFixture'
// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'
import { webContentRealmSource } from '../../src/components/web/contentRealmImplementation'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { authorSpotEdits } from '../../src/core/components/authoring/componentAuthorEdits'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform'

const quote = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
function html(label = 'Count', extra = '') {
  const child = `<!doctype html><style>body{margin:0;font:16px sans-serif}p{margin:8px}</style>
    <p id="title">Original title</p><button id="counter">${label} 0</button>${extra}<script>
    window.__boots=(window.__boots||0)+1;window.__realm=Math.random();let count=0;
    document.getElementById('counter').addEventListener('click',event=>event.currentTarget.textContent='${label} '+ ++count);
    </script>`
  // Keep a fragment so the actual imported Source's document:'web' declaration
  // selects Web execution after preparation, rather than a builtin/native hint.
  return `<iframe id="child" sandbox="allow-scripts" style="width:300px;height:150px;border:0" srcdoc="${quote(child)}"></iframe>`
}

it('keeps the real Host and Source fragment realms across first-edit identity promotion, Undo and re-edit, but replaces them for executable HTML changes', async () => {
  const bundle = await build({ stdin: { contents: `
    export { ComponentRuntimeHost } from './src/player/components/runtime/ComponentRuntimeHost';
    export { preparePublishedNativeComponent } from './src/player/components/runtime/SandboxComponentRuntime';
    export { webContentRealmSource } from './src/components/web/contentRealmImplementation';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser',
    format: 'iife', globalName: 'IdentityHostProbe', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text
      : '<!doctype html><div id="source" style="width:400px;height:220px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const directory = await mkdtemp(join(tmpdir(), 'owned-document-host-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 8000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => Boolean((window as any).IdentityHostProbe))
    const code = webContentRealmSource().replace('export default {mount', 'export default {document:"web",mount')
    const project = createBlankCourseProjectV10('Owned document Host identity')
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'source', language: 'javascript', source: code } }
    project.instances.web = { id: 'web', definitionId: 'web', authoring: { records: {} }, data: { html: html() } }
    testContainerInstance(project, 0).childIds = ['web']
    const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'identity-host', epoch: 'epoch',
      binding: { kind: 'untitled', suggestedName: 'identity-host' },
      model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver,
    { async append() {}, async save() { throw new Error('Unused in runtime identity test') } })
    await page.evaluate(async (input: unknown) => {
      const { instance, definition, code } = input as any
      const probe = (window as any).IdentityHostProbe
      const q: any = { spots: new Map(), serial: 0, resolutions: 0, errors: [] }
      const events = new Map<string, Set<(value: any) => void>>()
      const ports = { target: () => null,
        state: { get: () => undefined, set() {}, subscribe: () => () => {} },
        events: { emit(name: string, value: any) { for (const listener of events.get(name) ?? []) listener(value) },
          subscribe(name: string, listener: (value: any) => void) {
            const listeners = events.get(name) ?? new Set(); events.set(name, listeners); listeners.add(listener)
            return () => listeners.delete(listener)
          } } }
      q.host = new probe.ComponentRuntimeHost({
        resolveImplementation: async (_implementation: any, _definition: any, signal: AbortSignal) => {
          q.resolutions++
          // Each real Host preparation gets its own Sandbox lease. In particular,
          // no builtinKey/nativeDocument hint bypasses imported Source selection.
          return probe.preparePublishedNativeComponent({ format: 'esm', code, css: '', diagnostics: [] }, signal,
            { state: () => ({}), targets: () => [], htmlAuthoring: true })
        },
        ports: () => ports,
        authoring: (_run: string, _instance: string, generation: number) => ({ register(input: any) {
          const id = String(++q.serial)
          q.spots.set(id, { ...input, id, instanceId: 'web', mountGeneration: generation })
          return () => q.spots.delete(id)
        } }),
        reportError: (error: any) => q.errors.push(String(error)),
      })
      q.sync = async (instance: any, definition: any) => {
        q.handle = await q.host.sync({ runScopeId: 'identity-host', root: document.getElementById('source'), instance, definition })
        return q.handle.scope.generation
      }
      ;(window as any).__identityHost = q
      await q.sync(instance, definition)
    }, { instance: project.instances.web, definition: project.definitions.web, code } as unknown)
    const child = page.frameLocator('#source iframe').frameLocator('#child')
    const title = child.locator('#title'), counter = child.locator('#counter')
    await title.waitFor()
    const snapshot = async () => ({
      generation: await page.evaluate(() => (window as any).__identityHost.handle.scope.generation),
      ...await counter.evaluate(element => ({ counter: element.textContent, boots: (window as any).__boots, realm: (window as any).__realm })),
    })
    const titleSpot = async (): Promise<ComponentAuthorSpot> => {
      await page.waitForFunction(() => [...(window as any).__identityHost.spots.values()].some((spot: any) =>
        spot.kind === 'text' && spot.scope?.['document:path'] && spot.binding?.path.at(-1)?.attributes?.id === 'title'))
      return page.evaluate(() => [...(window as any).__identityHost.spots.values()].find((spot: any) =>
        spot.kind === 'text' && spot.scope?.['document:path'] && spot.binding?.path.at(-1)?.attributes?.id === 'title')) as Promise<ComponentAuthorSpot>
    }
    const currentModel = () => {
      const model = session.read().model
      if (model.kind !== 'course-v10') throw new Error('Expected V10 fixture')
      return model
    }
    const sync = () => {
      const model = currentModel()
      return page.evaluate((input: unknown) => {
        const { instance, definition } = input as any
        return (window as any).__identityHost.sync(instance, definition)
      }, { instance: model.project.instances.web, definition: model.project.definitions.web } as unknown)
    }
    const editTitle = async (operationId: string, value: string) => {
      const spot = await titleSpot(), model = currentModel()
      expect((await session.execute({ documentId: 'identity-host', epoch: 'epoch', baseRevision: session.read().revision,
        operationId, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(model.project,
          authorSpotEdits(model.project, spot, value, model.resources)) } })).status).toBe('applied')
      await sync()
      await expect.poll(() => title.textContent()).toBe(value)
      return spot
    }
    await counter.click()
    await expect.poll(() => counter.textContent()).toBe('Count 1')
    const initial = await snapshot(), firstSpot = await editTitle('first-title-edit', 'First local title')
    expect(firstSpot.scope?.['document:path']).toMatch(/^pending:/)
    expect((currentModel().project.instances.web.data as { html: string }).html).toContain('data-cw-author-key=')
    expect(await snapshot()).toEqual(initial)
    expect(session.read().undoDepth).toBe(1)

    // A Source edit and its Undo each create a new realm whose initial
    // document identity is already keyed. Undoing the first author record
    // afterwards must still let that live realm recover its pending identity.
    const firstEdited = currentModel(), firstEditedHtml = (firstEdited.project.instances.web.data as { html: string }).html
    expect((await session.execute({ documentId: 'identity-host', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: 'source-after-first-title', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(firstEdited.project,
        [{ type: 'data.set', instanceId: 'web', path: ['html'], value: firstEditedHtml + '<span id="roundtrip">Source</span>' }]) } })).status).toBe('applied')
    const sourceGeneration = await sync()
    expect(sourceGeneration).toBeGreaterThan(initial.generation)
    await expect.poll(() => title.textContent()).toBe('First local title')
    expect(await counter.textContent()).toBe('Count 0')
    expect((await session.execute({ documentId: 'identity-host', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: 'undo-source-after-first-title', actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
    expect((currentModel().project.instances.web.data as { html: string }).html).toBe(firstEditedHtml)
    expect(await sync()).toBeGreaterThan(sourceGeneration)
    await expect.poll(() => title.textContent()).toBe('First local title')
    await expect.poll(() => counter.textContent()).toBe('Count 0')
    await counter.click()
    await expect.poll(() => counter.textContent()).toBe('Count 1')
    const undoBaseline = await snapshot()

    expect((await session.execute({ documentId: 'identity-host', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: 'undo-first-title', actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
    expect((currentModel().project.instances.web.data as { html: string }).html).toBe(html())
    await sync()
    await expect.poll(() => title.textContent()).toBe('Original title')
    expect(await snapshot()).toEqual(undoBaseline)
    await editTitle('reedit-after-undo', 'Second local title')
    expect(await snapshot()).toEqual(undoBaseline)
    await counter.click()
    await expect.poll(() => counter.textContent()).toBe('Count 2')
    expect(await snapshot()).toMatchObject({ generation: undoBaseline.generation, boots: 1, realm: undoBaseline.realm })
    // Actual srcdoc JavaScript changes still retire the Host generation and run
    // the newly authored program, rather than retaining an old fragment mount.
    for (const [index, source] of [html('Changed'), html('Markup', '<output id="new-content">New markup</output>')].entries()) {
      const model = currentModel(), previousGeneration = (await snapshot()).generation
      expect((await session.execute({ documentId: 'identity-host', epoch: 'epoch', baseRevision: session.read().revision,
        operationId: `source-change-${index}`, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(model.project,
          [{ type: 'data.set', instanceId: 'web', path: ['html'], value: source }]) } })).status).toBe('applied')
      expect(await sync()).toBeGreaterThan(previousGeneration)
      await expect.poll(() => counter.textContent()).toBe(index === 0 ? 'Changed 0' : 'Markup 0')
      expect((await snapshot()).realm).not.toBe(initial.realm)
      expect((await snapshot()).boots).toBe(1)
      await counter.click()
      await expect.poll(() => counter.textContent()).toBe(index === 0 ? 'Changed 1' : 'Markup 1')
    }
    expect(await child.locator('#new-content').textContent()).toBe('New markup')
    expect(errors).toEqual([])
    expect(await page.evaluate(() => (window as any).__identityHost.errors)).toEqual([])
    await page.evaluate(() => (window as any).__identityHost.host.disposeScope('identity-host'))
  } finally {
    await app?.close(); await new Promise<void>(done => server.close(() => done()))
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
}, 25_000)
