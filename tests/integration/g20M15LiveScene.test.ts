import { afterEach, expect, it, vi } from 'vitest'
import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { addCourseScene } from '@/core/tools/courseLocations'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createPublishedCourseSession, type PublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'
import type { SlideLiveEditTargets } from '@/player/surfaces/slide/SlidePublishedAdapter'
import { ComponentRegistry } from '@/player/ComponentRegistry'
import { mountPublishedComponent, type ComponentHostNode } from '@/player/surfaces/publishedComponentMount'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { ComponentAuthoringTargetUpdate } from '@/shared/componentTypes'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { PublishedCourseComponent } from '@/shared/publishedCourseTypes'
import type { RuntimeAuthoringTarget } from '@/shared/runtimeTypes'
import { liveSceneChanges } from '@/renderer/ui/workspaces/liveSceneChanges'

// M15-T01 运行现场: a try-run page is paused where it is, its Runtime's own text is edited there in place, and the run
// carries on from the same instance. Nothing is registered by the Runtime.
const NOW = '2026-09-26T09:00:00.000Z'
const sessions: PublishedCourseSession[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.destroy()))
  vi.restoreAllMocks()
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  document.body.replaceChildren()
})

// A quiz whose progress lives in the Runtime (a local counter); it also counts answers in the course state.
const QUIZ = `
  CoursewareRuntime.define({
    runtimeApiVersion: 3,
    create(ctx) {
      var probe = window.__liveQuiz = window.__liveQuiz || { creates: 0, suspends: 0, resumes: 0 };
      probe.creates += 1;
      var question = 1;
      var answered = ctx.courseState.get('answered') || 0;
      var render = function () {
        ctx.dom.root.innerHTML = '<section><h2>第 ' + question + ' 题</h2><p>已作答 ' + answered + ' 题</p>'
          + '<button type="button" data-next>下一题</button></section>';
        ctx.dom.root.querySelector('[data-next]').addEventListener('click', function () {
          question += 1;
          answered += 1;
          ctx.courseState.set('answered', answered);
          render();
        });
      };
      render();
      return {
        suspend: function () { probe.suspends += 1; },
        resume: function () { probe.resumes += 1; },
        destroy: function () { ctx.dom.root.innerHTML = ''; }
      };
    }
  });
`

function quizItem(): RuntimeLayerItem {
  return {
    layerItemId: 'quiz', label: '小测验', order: 10_001, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 40, y: 40, width: 640, height: 360 },
    kind: 'runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: QUIZ, content: { values: {} }, assets: {} },
  }
}

function quizProject(): { project: CourseProjectDocument; locationId: string; sceneId: string } {
  let project = createBlankCourseProject({ now: NOW })
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  const added = addCourseScene(project, { surfaceId: slide.id, now: NOW, expectedRevision: project.revision })
  if (!added.ok) throw new Error(added.reason)
  project = structuredClone(added.project)
  const location = project.locations.find(candidate => candidate.kind === 'slide-scene')!
  if (location.kind !== 'slide-scene') throw new Error('expected a Slide location')
  const surface = project.surfaces.find(candidate => candidate.id === location.surfaceId)!
  if (surface.type !== 'slide') throw new Error('expected a Slide surface')
  surface.scenes.find(scene => scene.id === location.sceneId)!.layerItems = [quizItem()]
  return { project: courseProjectDocumentSchema.parse(project), locationId: location.id, sceneId: location.sceneId }
}

const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
function realm(): { container: HTMLElement; view: Window & typeof globalThis } {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const view = frame.contentWindow as (Window & typeof globalThis) | null
  if (!view || !frame.contentDocument) throw new Error('JSDOM iframe realm unavailable')
  // jsdom has no layout: every element measures the whole Runtime, every text one fixed box.
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0, 640, 360) })
  Object.defineProperty(view.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  if (typeof view.HTMLElement.prototype.scrollIntoView !== 'function') view.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
  const container = frame.contentDocument.createElement('div')
  frame.contentDocument.body.append(container)
  return { container, view }
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const probe = (view: Window) => Reflect.get(view, '__liveQuiz') as { creates: number; suspends: number; resumes: number }

it('M15 pauses a try-run page where it is, edits its Runtime’s own text in place and carries on with the same instance', async () => {
  const fixture = quizProject()
  const payload = buildPublishedCourseV2Payload({ project: fixture.project, assetFiles: {}, components: {} })
  const { container, view } = realm()
  const session = createPublishedCourseSession(payload)
  sessions.push(session)
  await session.mount(container)
  container.querySelector<HTMLButtonElement>('[data-next]')!.click()
  expect(container.querySelector('h2')!.textContent).toBe('第 2 题')

  // Back to edit: paused where it is, and the host publishes what the Runtime shows now.
  const published: SlideLiveEditTargets[] = []
  const started = session.beginLiveEdit(targets => published.push(targets))
  expect(started).toEqual({ locationId: fixture.locationId, stateId: expect.anything(), sceneId: fixture.sceneId })
  expect(probe(view)).toMatchObject({ creates: 1, suspends: 1 })
  await settle()
  const runtimeTargets = published.filter(entry => entry.kind === 'runtime').at(-1)!.update.targets as readonly RuntimeAuthoringTarget[]
  const heading = runtimeTargets.find(target => target.lightEdit?.original === '第 2 题')
  expect(heading).toMatchObject({ kind: 'text', source: 'auto', nodeId: 'quiz', scope: 'scene', sceneId: fixture.sceneId })
  expect(runtimeTargets.some(target => target.lightEdit?.original === '已作答 1 题')).toBe(true)

  // The teacher's edit becomes a rule and goes in place: same element, same instance, same progress.
  const element = container.querySelector('h2')!
  const rule = { original: '第 2 题', ...(heading!.lightEdit!.region ? { region: heading!.lightEdit!.region } : {}), text: '第二题：听录音选图' }
  expect(session.applyLiveEdit({ kind: 'runtime-text-overrides', target: { kind: 'runtime-text-overrides', scope: 'scene', nodeId: 'quiz' }, overrides: [rule] })).toBe('applied')
  expect(container.querySelector('h2')).toBe(element)
  expect(element.textContent).toBe('第二题：听录音选图')
  expect(probe(view).creates).toBe(1)
  expect(session.readCourseStateSnapshot()).toMatchObject({ answered: 1 })
  expect(session.applyLiveEdit({ kind: 'runtime-text-overrides', target: { kind: 'runtime-text-overrides', scope: 'scene', nodeId: 'missing' }, overrides: [] })).toBe('missing')

  // 继续运行: the same instance carries on and its interaction still works.
  session.endLiveEdit(true)
  expect(probe(view)).toMatchObject({ creates: 1, resumes: 1 })
  container.querySelector<HTMLButtonElement>('[data-next]')!.click()
  expect(container.querySelector('h2')!.textContent).toBe('第 3 题')
  expect(container.querySelector('p')!.textContent).toBe('已作答 2 题')

  // A replay of the page is built from the payload, which kept the rule.
  expect(await session.replayScene()).toBe(true)
  expect(probe(view).creates).toBe(2)
  container.querySelector<HTMLButtonElement>('[data-next]')!.click()
  await settle()
  expect(container.querySelector('h2')!.textContent).toBe('第二题：听录音选图')
})

it('M15 a page loaded again for an edit keeps its course state; a live page is playback only', async () => {
  const fixture = quizProject()
  const payload = buildPublishedCourseV2Payload({ project: fixture.project, assetFiles: {}, components: {} })
  const { container } = realm()
  const session = createPublishedCourseSession(payload, { initialLocationId: fixture.locationId, initialCourseState: { answered: 4 } })
  sessions.push(session)
  await session.mount(container)
  expect(container.querySelector('p')!.textContent).toBe('已作答 4 题')
  expect(session.readCourseStateSnapshot()).toMatchObject({ answered: 4 })
  // Only one live edit at a time; ending it without resuming leaves the page paused for the caller to drop.
  expect(session.beginLiveEdit(() => undefined)).not.toBeNull()
  expect(session.beginLiveEdit(() => undefined)).toBeNull()
  session.endLiveEdit(false)
  expect(session.beginLiveEdit(() => undefined)).not.toBeNull()
})

// A component's own text is published and edited in place the same way.
function encodeUtf16LeBase64(source: string): { encoding: 'base64-utf16le'; data: string } {
  const bytes = new Uint8Array(source.length * 2)
  for (let i = 0; i < source.length; i++) { const code = source.charCodeAt(i); bytes[i * 2] = code & 0xff; bytes[i * 2 + 1] = code >>> 8 }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}
const CARD = `
window.CoursewareComponent.define({
  id: 'card-component',
  runtimeApiVersion: 4,
  create(context) {
    var root = context.dom.root
    var opened = false
    root.innerHTML = '<section><h2>标题</h2><button type="button">展开</button><p hidden>答案：蓝色</p></section>'
    root.querySelector('button').addEventListener('click', function () { opened = true; root.querySelector('p').hidden = false })
    return { destroy: function () { root.innerHTML = '' } }
  },
})
`
it('M15 a playback component publishes its own text while paused for editing and takes a new rule in place', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 200, 100))
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  const container = document.createElement('div')
  document.body.append(container)
  const component = {
    id: 'card-component', name: '卡片', version: '1.0.0', contentSha256: 'sha', apiVersion: 4, scopes: ['scene'], renderMode: 'dom',
    code: encodeUtf16LeBase64(CARD), assets: {},
  } as unknown as PublishedCourseComponent
  const handle = mountPublishedComponent(container, {
    container, componentId: 'card-component', version: '1.0.0', instanceId: 'card', width: 200, height: 100,
    components: { 'card-component@1.0.0': component }, registry: new ComponentRegistry(), mode: 'preview', scope: 'scene', sceneId: 'scene-1',
  })
  const root = container.querySelector('.published-component-mount')!.shadowRoot!
  root.querySelector('button')!.click()
  expect(root.querySelector('p')!.hidden).toBe(false)
  const updates: ComponentAuthoringTargetUpdate[] = []
  const node = { id: 'card', x: 100, y: 80, width: 200, height: 100, rotation: 0, visible: true, props: {} } as unknown as ComponentHostNode
  const stop = handle.startLiveEdit!({ node, onTargetsChanged: update => updates.push(update) })
  expect(stop).toBeTypeOf('function')
  await settle()
  expect(updates.at(-1)!.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'component-text', source: 'auto', lightEdit: expect.objectContaining({ original: '答案：蓝色' }) }),
  ]))
  handle.setTextOverrides!([{ original: '答案：蓝色', text: '答案：深蓝色' }])
  expect(root.querySelector('p')!.textContent).toBe('答案：深蓝色')
  expect(root.querySelector('p')!.hidden).toBe(false)
  stop!()
  // Stopped, the instance can be paused for editing again; while it is, a second start is refused.
  const again = handle.startLiveEdit!({ node, onTargetsChanged: () => undefined })
  expect(again).toBeTypeOf('function')
  expect(handle.startLiveEdit!({ node, onTargetsChanged: () => undefined })).toBeNull()
  again!()
  handle.destroy()
})

it('M15 classifies document changes for a paused page: rules in place, pictures reload, anything else ends it', () => {
  const fixture = quizProject()
  const before = fixture.project
  const withRule = structuredClone(before)
  const quiz = (project: CourseProjectDocument) => {
    const surface = project.surfaces.find(candidate => candidate.type === 'slide')!
    if (surface.type !== 'slide') throw new Error('expected a Slide surface')
    const item = surface.scenes.find(scene => scene.id === fixture.sceneId)!.layerItems[0]!
    if (item.kind !== 'runtime') throw new Error('expected the quiz')
    return item
  }
  quiz(withRule).runtime.content.overrides = [{ original: '第 2 题', text: '第二题' }]
  withRule.revision += 1
  expect(liveSceneChanges(before, withRule, fixture.sceneId)).toEqual({
    patches: [{ kind: 'runtime-text-overrides', target: { kind: 'runtime-text-overrides', scope: 'scene', nodeId: 'quiz' }, overrides: [{ original: '第 2 题', text: '第二题' }] }],
    reloads: [],
  })
  // Undoing the rule is a change the page takes in place too.
  expect(liveSceneChanges(withRule, before, fixture.sceneId)?.patches[0]).toMatchObject({ overrides: [] })
  // A new static fallback (and its asset) changes nothing on the page.
  const withFallback = structuredClone(withRule)
  withFallback.assets['fallback-quiz'] = { id: 'fallback-quiz', filename: 'fallback-quiz.png', mimeType: 'image/png', kind: 'image', path: 'assets/fallback-quiz.png', byteLength: 4, width: 1, height: 1 }
  quiz(withFallback).runtime.staticFallback = { assetId: 'fallback-quiz', coverage: 'scene' }
  expect(liveSceneChanges(withRule, withFallback, fixture.sceneId)).toEqual({ patches: [], reloads: [] })
  // A replaced picture (asset binding) or keyed text needs the page loaded again.
  const withPicture = structuredClone(withRule)
  quiz(withPicture).runtime.assets = { hero: { assetId: 'fallback-quiz' } }
  expect(liveSceneChanges(withRule, withPicture, fixture.sceneId)).toEqual({ patches: [], reloads: [{ itemId: 'quiz', label: '小测验' }] })
  // Anything else ends the live page.
  const moved = structuredClone(withRule)
  quiz(moved).frame.x += 10
  expect(liveSceneChanges(withRule, moved, fixture.sceneId)).toBeNull()
  const locked = structuredClone(withRule)
  quiz(locked).locked = true
  expect(liveSceneChanges(withRule, locked, fixture.sceneId)).toBeNull()
})
