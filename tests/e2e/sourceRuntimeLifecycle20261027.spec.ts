import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { componentPaintStack } from '../../src/components/web/paintHit'
import { componentClientMatrixRealmSource } from '../../src/player/components/runtime/componentClientMatrix'

const root = resolve(__dirname, '../..')
const fileName = 'source-runtime-lifecycle.glx'
const sourceId = 'source-lifecycle-container'
const childId = 'source-native-text'
const originalText = '这段原生文字可以继续人工编辑'
const changedText = '人工修改已保存，Source 局部状态保持'
const eventPrefix = '__GUOLING_SOURCE_LIFECYCLE_20261027__'

type LifecycleEvent = {
  phase: 'module-prepare' | 'mount' | 'dispose' | 'click'
  version: string
  mountId?: string
  count?: number
  trusted?: boolean
  session: string
}
type Facts = Record<string, unknown>

function sourceFor(version: 'v1' | 'v2') {
  // Source has no public prepare hook. Top-level execution observes the real
  // compiled module import, not an invented prepare method or a fake resolver.
  return `const version = ${JSON.stringify(version)};
const report = event => console.info(${JSON.stringify(eventPrefix)} + JSON.stringify({ version, ...event }));
report({ phase: 'module-prepare' });

export default {
  mount(context) {
    const root = context.root;
    if (!root || !context.inline) throw new Error('This fixture requires a real Source container with native inline children');
    const mountId = context.scope.runScopeId + ':' + context.scope.generation + ':' + Math.random().toString(36).slice(2);
    const section = root.ownerDocument.createElement('section');
    section.dataset.sourceLifecycle = '';
    section.dataset.version = version;
    section.dataset.mountId = mountId;
    section.dataset.count = '0';
    section.dataset.playing = 'false';
    section.style.cssText = 'box-sizing:border-box;width:100%;height:100%;padding:28px;background:#eff7f3;border:2px solid #338568;border-radius:18px;color:#123d30;font:24px sans-serif;pointer-events:none';
    section.innerHTML = '<div data-source-select-margin style="height:32px"></div>' +
      '<h2 style="font-size:30px;margin:0 0 18px">Source 生命周期 <span data-source-version></span></h2>' +
      '<div style="display:flex;gap:24px;align-items:center;margin-bottom:32px">' +
      '<button type="button" style="pointer-events:auto;padding:14px 20px;border:0;border-radius:10px;background:#23764d;color:white;font:22px sans-serif">Source 局部计数 +1</button>' +
      '<output data-source-count>Source 局部计数 0</output></div>' +
      '<p style="font-size:18px;margin:0 0 12px">下方为正式原生文字子组件</p>' +
      '<div data-source-child-slot="${childId}" style="position:relative;width:860px;height:100px;background:white;border:1px solid #b7d7c7"></div>';
    section.querySelector('[data-source-version]').textContent = version;
    root.replaceChildren(section);
    const button = section.querySelector('button');
    const output = section.querySelector('[data-source-count]');
    let count = 0;
    const click = event => {
      if (section.dataset.playing !== 'true') return;
      count += 1;
      section.dataset.count = String(count);
      output.textContent = 'Source 局部计数 ' + count;
      report({ phase: 'click', mountId, count, trusted: event.isTrusted });
    };
    button.addEventListener('click', click);
    const releaseActivity = context.scope.events.subscribe('__runtime.activity', activity => {
      section.dataset.playing = String(Boolean(activity && activity.playing));
    });
    const releaseChild = context.inline.mount(${JSON.stringify(childId)}, section.querySelector('[data-source-child-slot]'));
    report({ phase: 'mount', mountId });
    return {
      update() {},
      dispose() {
        report({ phase: 'dispose', mountId });
        releaseActivity();
        releaseChild();
        button.removeEventListener('click', click);
        section.remove();
      },
    };
  },
};
`
}

function fixture() {
  const project = createBlankCourseProjectV10('Source 编译身份与原生子文字')
  const outer = testContainerInstance(project, 0)
  project.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  project.instances[sourceId] = {
    id: sourceId, name: 'Source 生命周期容器', definitionId: outer.definitionId,
    data: {}, childIds: [childId], container: { kind: 'slide', designSize: { width: 1000, height: 480 } },
    frame: { width: 1000, height: 480, transform: [1, 0, 0, 1, 100, 100] },
    implementationOverride: { kind: 'source', language: 'javascript', source: sourceFor('v1') },
  }
  project.instances[childId] = {
    id: childId, name: '原生文字子组件', definitionId: 'text',
    data: JSON.parse(JSON.stringify(createTextComponentData(originalText))),
    frame: { width: 820, height: 80, transform: [1, 0, 0, 1, 12, 10] },
  }
  outer.childIds = [sourceId]
  return { project, resources: { assets: {}, components: {} } }
}

async function read(page: Page, documentId: string) {
  const snapshot = await page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the production V10 document Session')
  return { ...snapshot, model: snapshot.model }
}

async function launch(profile: string, workspace: string, session: string, events: LifecycleEvent[], errors: string[], nativeInlineTrace: unknown[]) {
  mkdirSync(profile, { recursive: true })
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '0' } })
  try {
    const page = await app.firstWindow()
    page.on('console', message => {
      const text = message.text()
      const tracePrefix = '__GUOLING_INLINE_TRACE_20261027__'
      if (text.startsWith(tracePrefix)) {
        try { nativeInlineTrace.push({ session, ...JSON.parse(text.slice(tracePrefix.length)) }) }
        catch { errors.push(`Malformed inline diagnostic: ${text}`) }
        return
      }
      if (!text.startsWith(eventPrefix)) return
      try { events.push({ ...JSON.parse(text.slice(eventPrefix.length)), session }) }
      catch { errors.push(`Malformed lifecycle observation: ${text}`) }
    })
    page.on('pageerror', error => errors.push(`[${session}] ${error.stack || String(error)}`))
    // Only native folder/quit dialogs are handled here. The compiler, resolver,
    // prepare/mount pipeline, author operations, and save all remain production.
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setContentSize(1600, 1000)
      window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as { buttons: string[] }
        const response = options.buttons.indexOf('退出')
        if (response < 0) throw new Error(`Unexpected dialog: ${options.buttons.join(',')}`)
        return { response, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: fileName, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toBeVisible()
    if (await frame.getAttribute('data-editor-mode') !== 'deep') {
      await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    }
    await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Opened editor has no document identity')
    return { app, page, documentId }
  } catch (error) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app.close().catch(() => undefined)
    throw error
  }
}

function host(page: Page) {
  return page.locator(`.course-editor-frame:visible [data-component-container-runtime="${sourceId}"]`)
}

function sourceFrame(page: Page) {
  return host(page).frameLocator('iframe[title="组件内容"]')
}

async function runtimeState(page: Page) {
  return sourceFrame(page).locator('[data-source-lifecycle]').evaluate(element => ({
    version: element.getAttribute('data-version'), mountId: element.getAttribute('data-mount-id'),
    count: Number(element.getAttribute('data-count')),
  }))
}

function lifecycle(events: LifecycleEvent[], session = 'author') {
  return events.filter(event => event.session === session && event.phase !== 'click')
}

async function setMode(page: Page, name: '编辑' | '试运行') {
  const button = page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(sourceFrame(page).locator('[data-source-lifecycle]')).toHaveAttribute('data-playing', String(name === '试运行'))
}

async function clickCounter(page: Page, count: number) {
  const button = sourceFrame(page).getByRole('button', { name: 'Source 局部计数 +1', exact: true })
  await expect(button).toBeVisible()
  // Playwright's iframe action coordinates omit the transformed stage scale.
  // Map the actual child viewport point through its live frame border box;
  // continue sending trusted main-page mouse input, never dispatchEvent.
  const point = await button.evaluate(element => {
    const box = element.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
  const target = await host(page).locator('iframe[title="组件内容"]').evaluate((element, point) => {
    const frame = element as HTMLIFrameElement, box = frame.getBoundingClientRect()
    return { x: box.x + (frame.clientLeft + point.x) * box.width / frame.offsetWidth,
      y: box.y + (frame.clientTop + point.y) * box.height / frame.offsetHeight }
  }, point)
  await page.mouse.click(target.x, target.y)
  await expect(sourceFrame(page).locator('[data-source-count]')).toHaveText(`Source 局部计数 ${count}`)
}

async function openInstanceSource(page: Page) {
  const margin = sourceFrame(page).locator('[data-source-select-margin]')
  await expect(margin).toBeVisible()
  const box = await margin.boundingBox()
  if (!box) throw new Error('Source container has no visible selection margin')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const panel = page.getByRole('complementary', { name: '编辑面板', exact: true })
  if (!await panel.isVisible()) {
    await page.getByLabel('面板切换', { exact: true }).getByRole('button', { name: '属性与素材', exact: true }).click()
  }
  await panel.getByRole('tab', { name: '开发', exact: true }).click()
  const developer = page.getByTestId('developer-tab')
  await developer.getByRole('tab', { name: /^组件代码/ }).click()
  await developer.getByRole('tab', { name: '当前实例源码', exact: true }).click()
  const source = developer.locator('details:visible').filter({ has: page.locator('summary', { hasText: /^组件实现源码$/ }) })
  await expect(source.getByRole('textbox', { name: '组件实现源码', exact: true })).toBeVisible()
  return source
}

async function normalQuit(app: ElectronApplication) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
}

function nativeChild(page: Page, text: string) {
  // Source owns the slot in its iframe; the host mounts the native child in the
  // matching overlay. A fallback canvas child must not satisfy this assertion.
  return host(page).locator(`[data-component-inline-overlay="${sourceId}"] [data-component-inline-slot="${childId}"]`)
    .getByText(text, { exact: true })
}

function expectAuthors(project: CourseProjectV10, baseline: CourseProjectV10, text: string, version: 'v1' | 'v2') {
  const value = textComponentDataSchema.parse(project.instances[childId]!.data)
  expect(value.content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')).toBe(text)
  const initialData = textComponentDataSchema.parse(baseline.instances[childId]!.data)
  expect(value.appearance).toEqual(initialData.appearance)
  expect(value.sizing).toEqual(initialData.sizing)
  const { implementationOverride, ...sourceOwner } = project.instances[sourceId]!
  const { implementationOverride: _initialImplementation, ...initialOwner } = baseline.instances[sourceId]!
  expect(sourceOwner).toEqual(initialOwner)
  expect(implementationOverride).toMatchObject({ kind: 'source', language: 'javascript', source: sourceFor(version) })
  expect(project.definitions).toEqual(baseline.definitions)
  expect(project.rootIds).toEqual(baseline.rootIds)
  expect(project.assets).toEqual(baseline.assets)
}

async function editNativeText(page: Page, facts: Facts) {
  const rendered = nativeChild(page, originalText)
  await expect(rendered).toBeVisible()
  const beforeStability = await rendered.boundingBox()
  // Activity acknowledgement precedes the viewport ResizeObserver/fit update
  // when edit-mode chrome appears. Raw mouse input needs the same stable
  // geometry that a locator action normally waits for.
  const stableGeometry = await rendered.evaluate(element => new Promise<{
    box: { x: number; y: number; width: number; height: number }; stageRect: number[]; frames: number
  }>((resolve, reject) => {
    const stage = element.closest<HTMLElement>('.canvas-stage-stack')
    if (!stage) { reject(new Error('Native text is outside the active canvas stage')); return }
    const started = performance.now()
    let previous: number[] | undefined, stableFrames = 0, frames = 0
    const sample = () => {
      if (!element.isConnected || !stage.isConnected) { reject(new Error('Native text detached before pointer input')); return }
      const box = element.getBoundingClientRect(), stageBox = stage.getBoundingClientRect()
      const values = [box.x, box.y, box.width, box.height, stageBox.x, stageBox.y, stageBox.width, stageBox.height]
      stableFrames = previous && values.every((value, index) => Math.abs(value - previous![index]!) < 0.1)
        && box.width > 0 && box.height > 0 && stageBox.width > 0 && stageBox.height > 0 ? stableFrames + 1 : 0
      previous = values; frames += 1
      if (stableFrames >= 2) {
        resolve({ box: { x: box.x, y: box.y, width: box.width, height: box.height }, stageRect: values.slice(4), frames }); return
      }
      if (performance.now() - started > 5_000) { reject(new Error('Native text and stage geometry did not settle before pointer input')); return }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  const box = stableGeometry.box
  // A visible text point opens the professional native editor. The test neither
  // requires a hotspot to have glyph width nor dispatches synthetic DOM events.
  const point = { x: box.x + Math.min(box.width / 2, 120), y: box.y + Math.min(box.height / 2, 16) }
  facts.nativeTextPointer = { beforeStability, box, point, stableGeometry, ...await page.evaluate(({ point, paintSource, matrixSource }) => {
    const describe = (element: Element) => ({
      tag: element.tagName, className: element.getAttribute('class'),
      instanceId: element.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance,
      inlineSlot: element.closest<HTMLElement>('[data-component-inline-slot]')?.dataset.componentInlineSlot,
      inlineOwner: element.closest<HTMLElement>('[data-component-inline-overlay]')?.dataset.componentInlineOverlay,
      pointerEvents: getComputedStyle(element).pointerEvents,
    })
    const elements = document.elementsFromPoint(point.x, point.y), workspace = elements.map(element => element.closest('main.workspace')).find(Boolean)
    const chrome = '[data-slide-authoring-hit-plane],.canvas-authoring-targets,.author-field-affordances,.canvas-line-overlay,[data-handle],[data-line-handle],.teacher-controller-overlay,.selection-quick-bar,.text-edit-toolbar,[data-component-professional-editor],.text-edit-overlay,.image-safe-area-guides'
    const paint = new Function(`return (${paintSource})`)() as (root: Element, x: number, y: number, ignore: string) => Element[]
    const matrix = new Function(`return (${matrixSource})`)() as (root: HTMLElement) => readonly number[] | null
    let painted: Element[] = [], paintError: string | undefined
    try { if (workspace) painted = paint(workspace, point.x, point.y, chrome) } catch (error) { paintError = String(error) }
    return {
      hitStack: elements.slice(0, 10).map(describe), paintedStack: painted.slice(0, 10).map(describe), paintError,
      nativeAllocations: [...(workspace?.querySelectorAll<HTMLElement>('[data-component-inline-slot]') ?? [])].map(slot => {
        const id = slot.dataset.componentInlineSlot
        const world = [...slot.children].find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.componentRuntimeRoot === id)
        const root = world && [...world.children].find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.componentInstanceId === id)
        let clientMatrix: readonly number[] | null | undefined, matrixError: string | undefined
        try { if (root) clientMatrix = matrix(root) } catch (error) { matrixError = String(error) }
        return { id, ownerId: slot.closest<HTMLElement>('[data-component-inline-overlay]')?.dataset.componentInlineOverlay,
          directWorld: Boolean(world), directMount: Boolean(root), containsPaintedLeaf: Boolean(root && painted[0] && root.contains(painted[0])),
          rootRect: root?.getBoundingClientRect().toJSON(), clientMatrix, matrixError }
      }),
    }
  }, { point, paintSource: componentPaintStack.toString(), matrixSource: componentClientMatrixRealmSource() }) }
  await page.mouse.dblclick(point.x, point.y)
  const editor = page.locator('[data-component-professional-editor] [contenteditable="true"]').first()
  await expect(editor).toBeVisible()
  await expect(editor).toContainText(originalText)
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(changedText)
  await page.keyboard.press('Control+Enter')
  await expect(editor).not.toBeVisible()
  await expect(nativeChild(page, changedText)).toBeVisible()
}

async function expectStableRuntime(page: Page, events: LifecycleEvent[], before: LifecycleEvent[], state: Awaited<ReturnType<typeof runtimeState>>) {
  // Compilation and teardown are asynchronous. Observe across a bounded quiet
  // period after the positive child-render acknowledgement, not one lucky tick.
  const deadline = Date.now() + 1_000
  do {
    expect(lifecycle(events)).toEqual(before)
    expect(await runtimeState(page)).toEqual(state)
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  expect(lifecycle(events)).toEqual(before)
  expect(await runtimeState(page)).toEqual(state)
}

function documentSummary(snapshot: Awaited<ReturnType<typeof read>>) {
  return { revision: snapshot.revision, dirty: snapshot.dirty, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth,
    source: snapshot.model.project.instances[sourceId], child: snapshot.model.project.instances[childId],
    childDefinition: snapshot.model.project.definitions[snapshot.model.project.instances[childId]!.definitionId],
    rootIds: snapshot.model.project.rootIds,
    sourceOwners: Object.values(snapshot.model.project.instances).filter(instance => instance.childIds?.includes(sourceId)).map(instance => instance.id),
    childOwners: Object.values(snapshot.model.project.instances).filter(instance => instance.childIds?.includes(childId)).map(instance => instance.id) }
}

test('B3 production Source keeps local state through native child edits, recompiles real source changes, and cold-reopens author changes', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const base = join(root, 'output/next-execution-20261027/source-ui')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const file = join(workspace, fileName), initial = fixture()
  writeFileSync(file, createCourseProjectV10Archive(initial))
  const events: LifecycleEvent[] = [], errors: string[] = [], nativeInlineTrace: unknown[] = []
  const facts: Facts = {
    nativeInlineTrace,
    file, events, errors, paidCalls: 0, existingUserWorkModified: false,
    runtime: 'Production Source compiler, module import, prepare/mount/dispose, native child projection and document Session.',
    preparationObservation: 'module-prepare observes execution of the real compiled Source module; it does not count cached resolver.prepare invocations.',
    input: 'Dedicated visible Electron windows, real mouse/keyboard; DOM and document APIs are read-only observations.',
    visualReview: 'Screenshots need separate inspection; an automated pass alone is not visual acceptance.',
  }
  let app: ElectronApplication | undefined, page: Page | undefined
  try {
    let view = await launch(join(directory, 'profile-author'), workspace, 'author', events, errors, nativeInlineTrace)
    app = view.app; page = view.page
    await expect(nativeChild(page, originalText)).toBeVisible()
    await expect(sourceFrame(page).locator('[data-source-version]')).toHaveText('v1')
    await expect.poll(() => lifecycle(events).some(event => event.phase === 'module-prepare' && event.version === 'v1')).toBe(true)
    const original = await read(page, view.documentId)
    expectAuthors(original.model.project, initial.project, originalText, 'v1')

    await setMode(page, '试运行')
    for (let count = 1; count <= 3; count++) await clickCounter(page, count)
    const running = await runtimeState(page)
    expect(running).toMatchObject({ version: 'v1', count: 3 })
    const trustedClicks = events.filter(event => event.session === 'author' && event.phase === 'click' && event.mountId === running.mountId)
    expect(trustedClicks.map(event => ({ count: event.count, trusted: event.trusted }))).toEqual([
      { count: 1, trusted: true }, { count: 2, trusted: true }, { count: 3, trusted: true },
    ])
    expect(lifecycle(events).filter(event => event.phase === 'mount' && event.mountId === running.mountId)).toHaveLength(1)
    await page.screenshot({ path: join(directory, '01-source-running.png'), fullPage: true })

    await setMode(page, '编辑')
    expect(await runtimeState(page)).toEqual(running)
    const beforeEdit = lifecycle(events).map(event => ({ ...event }))
    facts.beforeNativeEdit = { state: running, lifecycle: beforeEdit, document: documentSummary(original) }
    await editNativeText(page, facts)
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(original.undoDepth + 1)
    const edited = await read(page, view.documentId)
    expectAuthors(edited.model.project, initial.project, changedText, 'v1')
    // The immutable author snapshot really changed, while its Source owner did not.
    expect(edited.revision).toBeGreaterThan(original.revision)
    expect(edited.model.project.instances[sourceId]).toEqual(original.model.project.instances[sourceId])
    expect(edited.model.project.instances[childId]!.data).not.toEqual(original.model.project.instances[childId]!.data)
    await expectStableRuntime(page, events, beforeEdit, running)
    facts.afterNativeEdit = { state: await runtimeState(page), lifecycle: [...lifecycle(events)], document: documentSummary(edited) }
    await page.screenshot({ path: join(directory, '02-native-child-edited-state-retained.png'), fullPage: true })

    const source = await openInstanceSource(page)
    const input = source.getByRole('textbox', { name: '组件实现源码', exact: true })
    await expect(input).toHaveValue(sourceFor('v1'))
    // Opening an author panel is another unrelated UI update, not a Source edit.
    expect(lifecycle(events)).toEqual(beforeEdit)
    expect(await runtimeState(page)).toEqual(running)
    await input.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(sourceFor('v2'))
    await expect(input).toHaveValue(sourceFor('v2'))
    await source.getByRole('button', { name: '保存实现', exact: true }).click()
    await expect(sourceFrame(page).locator('[data-source-version]')).toHaveText('v2')
    await expect.poll(() => lifecycle(events).some(event => event.phase === 'module-prepare' && event.version === 'v2')).toBe(true)
    await expect.poll(() => lifecycle(events).filter(event => event.phase === 'dispose' && event.mountId === running.mountId).length).toBe(1)
    const replacement = await runtimeState(page)
    expect(replacement).toMatchObject({ version: 'v2', count: 0 })
    expect(replacement.mountId).not.toBe(running.mountId)
    expect(lifecycle(events).filter(event => event.phase === 'mount' && event.mountId === replacement.mountId)).toHaveLength(1)
    await expect(nativeChild(page, changedText)).toBeVisible()
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(edited.undoDepth + 1)
    const sourceEdited = await read(page, view.documentId)
    expectAuthors(sourceEdited.model.project, initial.project, changedText, 'v2')
    expect(sourceEdited.model.project.instances[childId]).toEqual(edited.model.project.instances[childId])
    facts.afterSourceEdit = { state: replacement, lifecycle: [...lifecycle(events)], document: documentSummary(sourceEdited) }
    await page.getByRole('tab', { name: '属性', exact: true }).click()
    await setMode(page, '试运行')
    await clickCounter(page, 1)
    await setMode(page, '编辑')
    await page.screenshot({ path: join(directory, '03-real-source-updated.png'), fullPage: true })

    const beforeSaveState = await runtimeState(page), beforeSaveLifecycle = [...lifecycle(events)]
    await page.keyboard.press('Control+s')
    await expect.poll(async () => {
      const snapshot = await read(view.page, view.documentId)
      return { dirty: snapshot.dirty, saving: snapshot.saving }
    }).toEqual({ dirty: false, saving: false })
    const saved = await read(page, view.documentId)
    const archive = openCourseProjectV10Archive(new Uint8Array(readFileSync(file)))
    expectAuthors(archive.project, initial.project, changedText, 'v2')
    expect(archive.project.instances).toEqual(saved.model.project.instances)
    expect(await runtimeState(page)).toEqual(beforeSaveState)
    expect(lifecycle(events)).toEqual(beforeSaveLifecycle)
    facts.saved = documentSummary(saved)
    await normalQuit(app); app = undefined; facts.firstNormalQuit = true

    view = await launch(join(directory, 'profile-cold'), workspace, 'cold', events, errors, nativeInlineTrace)
    app = view.app; page = view.page
    await expect(nativeChild(page, changedText)).toBeVisible()
    await expect(sourceFrame(page).locator('[data-source-version]')).toHaveText('v2')
    await expect.poll(() => lifecycle(events, 'cold').some(event => event.phase === 'module-prepare' && event.version === 'v2')).toBe(true)
    const reopened = await read(page, view.documentId)
    expect(reopened).toMatchObject({ dirty: false, undoDepth: 0, redoDepth: 0, revision: saved.revision })
    expectAuthors(reopened.model.project, initial.project, changedText, 'v2')
    expect(reopened.model.project.instances).toEqual(saved.model.project.instances)
    // Local runtime state is deliberately ephemeral; author changes are durable.
    expect(await runtimeState(page)).toMatchObject({ version: 'v2', count: 0 })
    expect(lifecycle(events, 'cold').some(event => event.version === 'v1')).toBe(false)
    await setMode(page, '试运行')
    await clickCounter(page, 1)
    await expect(nativeChild(page, changedText)).toBeVisible()
    await page.screenshot({ path: join(directory, '04-cold-reopened-running.png'), fullPage: true })
    facts.reopened = { document: documentSummary(reopened), state: await runtimeState(page), lifecycle: [...lifecycle(events, 'cold')] }
    await normalQuit(app); app = undefined; facts.secondNormalQuit = true
    facts.result = 'automated-pass-awaiting-image-review'
  } catch (error) {
    facts.result = 'fail'; facts.error = String(error)
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
      writeFileSync(join(directory, 'failure-dom.html'), await page.content().catch(() => 'DOM unavailable'))
      writeFileSync(join(directory, 'failure-body.html'), await page.locator('body').innerHTML().catch(() => 'Body unavailable'))
    }
    throw error
  } finally {
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await testInfo.attach('B3 production Source lifecycle facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app?.close().catch(() => undefined)
  }
})
