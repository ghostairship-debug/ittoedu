import { afterEach, expect, it, vi } from 'vitest'
import { createComponentModelProjection } from '../../src/player/componentPlatform/modelProjection'
import { createV10ModelPlayer, mountV10Model } from '../../src/player/componentPlatform/ModelPlayer'
import { resolveModelPlayerPresentation } from '../../src/player/componentPlatform/publishedProjection'
import type { ComponentPlayerModel } from '../../src/player/componentPlatform/ModelPlayer'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import type { ComponentInstance, ComponentRuntimeContext, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'

const releases: (() => void)[] = []
afterEach(() => { releases.splice(0).forEach(release => release()); vi.restoreAllMocks(); document.body.replaceChildren() })

const frame = (width = 320, height = 180) => ({ width, height, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] })
function model(project: CourseProjectV10): ComponentPlayerModel {
  return { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
}
function project(instances: Record<string, ComponentInstance>, rootIds: string[]): CourseProjectV10 {
  return { schemaVersion: 11, id: 'work', revision: 0, title: 'container projection', rootIds,
    entry: { rootInstanceId: rootIds[0]! }, global: { underlay: [], overlay: [] }, assets: {}, instances,
    definitions: {
      container: { id: 'container', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      program: { id: 'program', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' } },
    } }
}
function mount(value: ComponentPlayerModel, containerId?: string) {
  const root = document.createElement('div'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 960 }, clientHeight: { value: 540 } })
  const bound = new Map<string, HTMLElement>(), targets = new Map<string, HTMLElement>()
  const runtime = {
    bind: vi.fn((id: string, element: HTMLElement | null, expected?: HTMLElement) => { if (!element && expected && bound.get(id) !== expected) return; if (element) bound.set(id, element); else bound.delete(id) }),
    bindTarget: vi.fn((id: string, element: HTMLElement | null, expected?: HTMLElement) => { if (!element && expected && targets.get(id) !== expected) return; if (element) targets.set(id, element); else targets.delete(id) }),
    contentElement: (id: string) => bound.get(id), targetElement: (id: string) => targets.get(id),
    assetUrl: () => undefined,
  }
  const cameras = new Map<string, ReturnType<NonNullable<ReturnType<typeof createComponentModelProjection>['camera']>>>()
  const projection = createComponentModelProjection({ root, runtime: runtime as unknown as ComponentPlatformRuntime,
    signal: new AbortController().signal, containerId,
    onCamera: (id, camera) => { cameras.set(id, camera); return () => { cameras.delete(id) } },
  })
  projection.sync(value)
  releases.push(() => { void projection.dispose() })
  return { root, runtime, bound, targets, cameras, projection }
}

function mixed() {
  return project({
    flow: { id: 'flow', definitionId: 'container', data: {}, childIds: ['a', 'b'], container: { kind: 'flow', flow: { layout: { toc: 'hidden', readingWidth: 860, wideContentWidth: 1100 } } } },
    a: { id: 'a', definitionId: 'container', data: {}, frame: frame(), childIds: ['a-text'], container: { kind: 'spatial', designSize: { width: 320, height: 180 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } },
    b: { id: 'b', definitionId: 'container', data: {}, frame: frame(), childIds: ['b-text'], container: { kind: 'spatial', designSize: { width: 320, height: 180 }, spatial: { home: { x: 50, y: 20, zoom: 1 }, frames: [] } } },
    'a-text': { id: 'a-text', definitionId: 'text', data: { text: 'A' }, frame: frame(100, 30) },
    'b-text': { id: 'b-text', definitionId: 'text', data: { text: 'B' }, frame: frame(100, 30) },
  }, ['flow'])
}

it('uses the responsive Flow paper width in the live model projection', () => {
  const value = mixed()
  value.instances.flow!.container!.designSize = { width: 1280, height: 900 }
  const { root, projection } = mount(model(value))
  const paper = root.querySelector<HTMLElement>('[data-flow-paper-scroll] > article')!
  expect(paper.style.width).toBe('100%')
  expect(paper.style.maxWidth).toBe('860px')
  expect(projection.observation?.('flow')?.readZoom()).toBe(1)
})

it('mounts a source root in its real viewport without a Slide, fixed-paper fit or duplicate runtime placement', () => {
  const value = model(project({ app: { id: 'app', definitionId: 'program', data: {}, frame: frame(1280, 720) } }, ['app']))
  const { root, projection, runtime, bound } = mount(value)
  expect(root.querySelector('[data-component-program-root="app"]')).not.toBeNull()
  expect(root.querySelector('[data-component-surface]')).toBeNull()
  expect(root.querySelector('[data-playback-view]')).toBeNull()
  expect(bound.get('app')?.parentElement?.style.height).toBe('100%')
  expect(projection.viewport?.('app')).toEqual({ width: 960, height: 540 })
  const content = bound.get('app')
  projection.sync(value)
  expect(bound.get('app')).toBe(content)
  expect(runtime.bind.mock.calls.filter(([id, element]) => id === 'app' && element)).toHaveLength(1)
})

it('gives two Spatial children one placement each and independent cameras while retaining their live descendants', () => {
  const value = model(mixed()), { root, projection, bound, cameras, runtime } = mount(value)
  expect(root.querySelectorAll('[data-component-container]')).toHaveLength(3)
  expect(root.querySelectorAll('[data-component-instance-id="a-text"]')).toHaveLength(1)
  expect(root.querySelectorAll('[data-component-instance-id="b-text"]')).toHaveLength(1)
  expect([...bound.keys()].sort()).toEqual(['a-text', 'b-text'])
  const beforeB = cameras.get('b')!.read(), aContent = bound.get('a-text'), bContent = bound.get('b-text')
  cameras.get('a')!.set({ x: 400, y: 200, zoom: 2 })
  expect(cameras.get('b')!.read()).toEqual(beforeB)
  projection.sync(value)
  expect(bound.get('a-text')).toBe(aContent)
  expect(bound.get('b-text')).toBe(bContent)
  expect(runtime.bind.mock.calls.filter(([id, element]) => id === 'a-text' && element)).toHaveLength(1)
  expect(cameras.get('a')!.read()).toMatchObject({ x: 400, y: 200, zoom: 2 })
})

it('does not let an old Spatial placement unbind an instance already moved into its sibling', () => {
  const original = mixed()
  original.instances.flow!.childIds = ['b', 'a']
  const { projection, bound, root } = mount(model(original))
  const moved = structuredClone(original)
  moved.instances.a!.childIds = []
  moved.instances.b!.childIds = ['b-text', 'a-text']
  projection.sync(model(moved))
  expect(bound.has('a-text')).toBe(true)
  expect(root.querySelectorAll('[data-component-instance-id="a-text"]')).toHaveLength(1)
  expect(bound.get('a-text')?.closest('[data-component-container]')?.getAttribute('data-component-container')).toBe('b')
})

it('a local editor projection shares the supplied World and excludes work-level planes and project targets', () => {
  const value = mixed()
  value.instances.overlay = { id: 'overlay', definitionId: 'text', data: { text: 'work overlay' }, frame: frame() }
  value.global.overlay = ['overlay']
  const { root, bound, targets } = mount(model(value), 'a')
  expect(root.querySelectorAll('[data-component-container]')).toHaveLength(1)
  expect(root.querySelector('[data-component-container="a"]')).not.toBeNull()
  expect([...bound.keys()]).toEqual(['a-text'])
  expect(targets.has('work')).toBe(false)
  expect(targets.has('overlay')).toBe(false)
})

it('retiring a local preview preserves a newer workspace placement in the same World', () => {
  const { projection, runtime, bound, targets } = mount(model(mixed()), 'a')
  const nextContent = document.createElement('div'), nextTarget = document.createElement('div'), nextContainer = document.createElement('div')
  nextTarget.append(nextContent); document.body.append(nextTarget, nextContainer)
  runtime.bind('a-text', nextContent); runtime.bindTarget('a-text', nextTarget); runtime.bindTarget('a', nextContainer)
  projection.dispose()
  expect(bound.get('a-text')).toBe(nextContent)
  expect(targets.get('a-text')).toBe(nextTarget)
  expect(targets.get('a')).toBe(nextContainer)
})

it('keeps a declared nested viewport height through Flow relayout even without a free author frame', () => {
  const value = mixed()
  delete value.instances.a!.frame
  value.instances.a!.container!.designSize = { width: 320, height: 240 }
  const { root } = mount(model(value))
  const outer = root.querySelector<HTMLElement>('[data-component-object="a"]')!
  expect(outer.style.height).toBe('240px')
  root.dispatchEvent(new Event('toggle', { bubbles: true }))
  expect(outer.style.height).toBe('240px')
  expect(outer.querySelector<HTMLElement>('[data-component-runtime-root="a"]')!.style.height).toBe('100%')
})

it('retains the same nested world and restores its target when the container becomes a work root', () => {
  const value = mixed(), { projection, bound, targets, cameras, root } = mount(model(value))
  const camera = cameras.get('a'), content = bound.get('a-text')
  const moved = structuredClone(value)
  moved.instances.flow!.childIds = ['b']
  moved.rootIds = ['flow', 'a']
  projection.sync(model(moved))
  expect(targets.get('a')).toBe(root.querySelector('[data-component-container="a"]'))
  expect(cameras.get('a')).toBe(camera)
  expect(bound.get('a-text')).toBe(content)
  expect(root.querySelectorAll('[data-component-instance-id="a-text"]')).toHaveLength(1)
  expect(projection.revealSurface('a')).toBe(true)
  expect(targets.get('a')?.hidden).toBe(false)
})

it('clears navigation hiding when a retained work root becomes a nested container', () => {
  const current = project({
    first: { id: 'first', definitionId: 'container', data: {}, childIds: [], container: { kind: 'slide', designSize: { width: 960, height: 540 } } },
    second: { id: 'second', definitionId: 'container', data: {}, childIds: ['counter'], frame: frame(320, 180), container: { kind: 'slide', designSize: { width: 320, height: 180 } } },
    counter: { id: 'counter', definitionId: 'program', data: {}, frame: frame(160, 80) },
  }, ['first', 'second'])
  const { root, projection, bound, runtime } = mount(model(current))
  expect(projection.revealSurface('second')).toBe(true)
  const secondSurface = root.querySelector<HTMLElement>('[data-component-container="second"]')!
  const childContent = bound.get('counter')!
  // Runtime owns this live content. Placement changes must leave it intact.
  const button = document.createElement('button')
  let count = 0
  button.textContent = 'Count 0'
  button.addEventListener('click', () => { button.textContent = 'Count ' + ++count })
  childContent.append(button)
  button.click()
  expect(button.textContent).toBe('Count 1')
  expect(projection.revealSurface('first')).toBe(true)
  expect(getComputedStyle(secondSurface).display).toBe('none')

  const nested = structuredClone(current)
  nested.rootIds = ['first']
  nested.instances.first!.childIds = ['second']
  projection.sync(model(nested))
  projection.sync(model(nested))

  const firstSurface = root.querySelector<HTMLElement>('[data-component-container="first"]')!
  expect(root.querySelectorAll('[data-component-container="second"]')).toHaveLength(1)
  expect(root.querySelector('[data-component-container="second"]')).toBe(secondSurface)
  expect(firstSurface.contains(secondSurface)).toBe(true)
  for (let element: HTMLElement | null = secondSurface; element && element !== root; element = element.parentElement) {
    expect(element.hidden).toBe(false)
    expect(getComputedStyle(element).display).not.toBe('none')
  }
  expect(bound.get('counter')).toBe(childContent)
  expect(childContent.querySelector('button')).toBe(button)
  expect(button.isConnected).toBe(true)
  expect(button.textContent).toBe('Count 1')
  button.click()
  expect(button.textContent).toBe('Count 2')
  expect(runtime.bind.mock.calls.filter(([id, element]) => id === 'counter' && element)).toHaveLength(1)
})

it('commits one effective native data and frame projection to DOM and World for each container state', async () => {
  const value = mixed(), source = model(value)
  value.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  const initialA = JSON.parse(JSON.stringify(createTextComponentData('A initial')))
  const detailA = JSON.parse(JSON.stringify(createTextComponentData('A detail')))
  const initialB = JSON.parse(JSON.stringify(createTextComponentData('B initial')))
  const detailB = JSON.parse(JSON.stringify(createTextComponentData('B detail')))
  value.instances['a-text']!.data = initialA
  value.instances['b-text']!.data = initialB
  for (const [id, data, width] of [['a', detailA, 230], ['b', detailB, 270]] as const) {
    value.instances[id]!.container!.kind = 'slide'
    delete value.instances[id]!.container!.spatial
    value.instances[id]!.container!.presentation = { initialStateId: 'overview', states: [
      { id: 'overview', title: 'overview', overrides: {} },
      { id: 'detail', title: 'detail', overrides: { [`${id}-text`]: { data, frame: frame(width, 60) } } },
    ] }
  }
  const states: Record<string, string | null> = { a: 'detail', b: 'overview' }
  const navigation = new ComponentNavigationOwner({ project: () => value, surfaceId: () => 'flow',
    containerStateId: id => states[id], select: () => false })
  const root = document.createElement('div'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 960 }, clientHeight: { value: 540 } })
  const projections: ComponentPlayerModel[] = []
  const player = mountV10Model({ root, model: source, runScopeId: 'native-container-states',
    teacherController: navigation.teacherPort(), studentNavigation: navigation,
    createProjection: context => {
      const projection = createComponentModelProjection(context)
      return { ...projection, sync: effective => { projections.push(effective); return projection.sync(effective) } }
    },
  })
  const runtimeSync = vi.spyOn(player.runtime, 'sync')
  try {
    await player.ready
    expect(root.textContent).toContain('A detail')
    expect(root.textContent).toContain('B initial')
    expect(root.querySelector<HTMLElement>('[data-component-object="a-text"]')!.style.width).toBe('230px')
    expect(runtimeSync.mock.calls.at(-1)![0]).toBe(projections.at(-1)!.project)
    expect(runtimeSync.mock.calls.at(-1)![0].instances['a-text']!.data).toEqual(detailA)
    expect(runtimeSync.mock.calls.at(-1)![0].instances['a-text']!.frame).toEqual(frame(230, 60))
    states.a = 'overview'; states.b = 'detail'
    await player.update(source)
    expect(root.textContent).toContain('A initial')
    expect(root.textContent).toContain('B detail')
    expect(root.querySelector<HTMLElement>('[data-component-object="a-text"]')!.style.width).toBe('100px')
    expect(root.querySelector<HTMLElement>('[data-component-object="b-text"]')!.style.width).toBe('270px')
    expect(runtimeSync.mock.calls.at(-1)![0]).toBe(projections.at(-1)!.project)
    expect(value.instances['a-text']!.data).toEqual(initialA)
    expect(value.instances['b-text']!.data).toEqual(initialB)
    expect(value.instances['a-text']!.frame).toEqual(frame(100, 30))
  } finally { await player.dispose(); navigation.dispose() }
})

it('keeps an editable native child in the program default plane and lends the same live root to an explicit Source slot', async () => {
  const value = project({
    app: { id: 'app', definitionId: 'program', data: {}, childIds: ['child'] },
    child: { id: 'child', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('editable native child'))), frame: frame(180, 50) },
  }, ['app'])
  value.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  const source = model(value), root = document.createElement('div'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 960 }, clientHeight: { value: 540 } })
  let sourceContext!: ComponentRuntimeContext
  const mountSource = vi.fn((context: ComponentRuntimeContext) => {
    sourceContext = context
    context.root!.textContent = 'program content'
    return { update() {}, dispose() {} }
  })
  const player = mountV10Model({ root, model: source, runScopeId: 'program-default-slot',
    resolveSource: async () => ({ implementation: { mount: mountSource } }),
  })
  try {
    await player.ready
    const defaultTarget = player.runtime.targetElement('child')!
    const liveRoot = [...defaultTarget.querySelectorAll<HTMLElement>('[data-component-runtime-root="child"]')].at(-1)!
    const nativeSpot = player.runtime.authorSpots().find(spot => spot.instanceId === 'child')!
    expect(root.textContent).toContain('program content')
    expect(root.textContent).toContain('editable native child')
    expect(defaultTarget.closest('[data-component-program-root="app"]')).not.toBeNull()
    expect(nativeSpot.dataPath).toEqual(['content'])
    const slot = document.createElement('div'); sourceContext.root!.append(slot)
    const release = sourceContext.inline!.mount('child', slot)
    await player.ready
    expect(player.runtime.targetElement('child')).toBe(slot)
    expect(slot.contains(liveRoot)).toBe(true)
    await player.update(source)
    expect(slot.contains(liveRoot)).toBe(true)
    expect(mountSource).toHaveBeenCalledTimes(1)
    release(); await player.ready
    expect(player.runtime.targetElement('child')).toBe(defaultTarget)
    expect(defaultTarget.contains(liveRoot)).toBe(true)
    expect(root.textContent).toContain('editable native child')
    expect(player.runtime.authorSpots().find(spot => spot.instanceId === 'child')?.mountGeneration).toBe(nativeSpot.mountGeneration)
    expect(mountSource).toHaveBeenCalledTimes(1)
  } finally { await player.dispose() }
})

it('runs a container Source layout and interactive child slot once while retaining its native children and camera', async () => {
  const value = mixed()
  value.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  value.instances['a-text']!.data = JSON.parse(JSON.stringify(createTextComponentData('Source placed native child')))
  value.instances['b-text']!.data = JSON.parse(JSON.stringify(createTextComponentData('sibling native child')))
  value.instances.a!.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default customContainerLayout' }
  const root = document.createElement('div'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 960 }, clientHeight: { value: 540 } })
  let sourceRoot!: HTMLElement, childSlot!: HTMLElement
  const disposeSource = vi.fn()
  const mountSource = vi.fn((context: ComponentRuntimeContext) => {
    sourceRoot = context.root!
    sourceRoot.dataset.customContainerLayout = ''
    Object.assign(sourceRoot.style, { display: 'grid', gridTemplateColumns: '1fr 2fr' })
    const button = document.createElement('button'); button.textContent = 'Source interaction'
    button.style.pointerEvents = 'auto'
    let clicks = 0
    button.onclick = () => {
      button.dataset.clicks = String(++clicks)
      context.scope.state.set('container-source-clicked', true)
    }
    childSlot = document.createElement('div'); childSlot.dataset.sourceChildSlot = 'a-text'
    childSlot.style.gridColumn = '2'
    sourceRoot.append(button, childSlot)
    context.inline!.mount('a-text', childSlot)
    return { update() {}, dispose() { disposeSource(); button.onclick = null } }
  })
  const player = mountV10Model({ root, model: model(value), runScopeId: 'container-source-layout',
    resolveSource: async () => ({ implementation: { mount: mountSource } }),
  })
  try {
    await player.ready
    expect(mountSource).toHaveBeenCalledTimes(1)
    expect(sourceRoot.closest('[data-component-container-runtime="a"]')).not.toBeNull()
    expect(sourceRoot.closest<HTMLElement>('[data-component-container-runtime="a"]')!.style.pointerEvents).toBe('none')
    expect(sourceRoot.style.gridTemplateColumns).toBe('1fr 2fr')
    expect(childSlot.textContent).toContain('Source placed native child')
    expect(player.runtime.targetElement('a-text')).toBe(childSlot)
    expect(root.textContent).toContain('sibling native child')
    expect(childSlot.querySelectorAll('[data-component-instance-id="a-text"]')).toHaveLength(1)
    expect(root.textContent?.match(/Source placed native child/g)).toHaveLength(1)
    sourceRoot.querySelector('button')!.click()
    expect(player.runtime.getState('container-source-clicked')).toBe(true)
    const originalSourceRoot = sourceRoot, originalSlot = childSlot
    expect(sourceRoot.querySelector('button')!.dataset.clicks).toBe('1')
    const camera = player.camera('a'), generation = player.runtime.authorSpots().find(spot => spot.instanceId === 'a-text')!.mountGeneration
    const changed = structuredClone(value)
    changed.instances['a-text']!.data = JSON.parse(JSON.stringify(createTextComponentData('updated native child')))
    await player.update(model(changed))
    expect(childSlot.textContent).toContain('updated native child')
    expect(player.camera('a')).toBe(camera)
    expect(player.runtime.authorSpots().find(spot => spot.instanceId === 'a-text')?.mountGeneration).toBe(generation)
    expect(mountSource).toHaveBeenCalledTimes(1)
    expect(disposeSource).not.toHaveBeenCalled()
    expect(sourceRoot).toBe(originalSourceRoot)
    expect(childSlot).toBe(originalSlot)
    expect(sourceRoot.querySelector('button')!.dataset.clicks).toBe('1')
    sourceRoot.querySelector('button')!.click()
    expect(sourceRoot.querySelector('button')!.dataset.clicks).toBe('2')

    // Actual implementation changes still retire the old Source generation.
    // Preserving child-only updates must not freeze the program's author source.
    const rewritten = structuredClone(changed)
    rewritten.instances.a!.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default replacementContainerLayout' }
    await player.update(model(rewritten))
    expect(mountSource).toHaveBeenCalledTimes(2)
    expect(disposeSource).toHaveBeenCalledTimes(1)
    expect(childSlot.textContent).toContain('updated native child')
    expect(player.camera('a')).toBe(camera)
    expect(player.runtime.authorSpots().find(spot => spot.instanceId === 'a-text')?.mountGeneration).toBe(generation)
  } finally { await player.dispose() }
})

it('keeps the renderer final state-plus-draft projection unchanged for both DOM and World', async () => {
  const value = mixed()
  value.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  const stateData = JSON.parse(JSON.stringify(createTextComponentData('state text')))
  const draftData = JSON.parse(JSON.stringify(createTextComponentData('current editing draft')))
  value.instances['a-text']!.data = JSON.parse(JSON.stringify(createTextComponentData('author text')))
  value.instances['b-text']!.data = JSON.parse(JSON.stringify(createTextComponentData('sibling text')))
  value.instances.a!.container!.kind = 'slide'
  delete value.instances.a!.container!.spatial
  value.instances.a!.container!.presentation = { initialStateId: 'detail', states: [
    { id: 'detail', title: 'detail', background: { mode: 'own', color: '#112233' }, overrides: { 'a-text': { data: stateData, frame: frame(230, 60) } } },
  ] }
  const navigation = new ComponentNavigationOwner({ project: () => value, surfaceId: () => 'flow', select: () => false })
  const projected = structuredClone(resolveModelPlayerPresentation(value, navigation))
  projected.instances['a-text']!.data = draftData
  projected.instances['a-text']!.frame = frame(260, 70)
  projected.instances.a!.container!.background = { mode: 'own', color: '#ffeedd' }
  const draft = model(projected), root = document.createElement('div'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 960 }, clientHeight: { value: 540 } })
  const player = createV10ModelPlayer({ runScopeId: 'renderer-prepared-draft', presentationPrepared: true,
    teacherController: navigation.teacherPort(), studentNavigation: navigation,
    createProjection: (runtime, signal) => createComponentModelProjection({ root, runtime, signal }),
  })
  const runtimeSync = vi.spyOn(player.runtime, 'sync')
  try {
    await player.update(draft)
    expect(root.textContent).toContain('current editing draft')
    expect(root.textContent).not.toContain('state text')
    expect(root.querySelector<HTMLElement>('[data-component-object="a-text"]')!.style.width).toBe('260px')
    expect(root.querySelector<HTMLElement>('[data-component-container="a"] > [data-component-background-paint] > div')!.style.backgroundColor).toBe('rgb(255, 238, 221)')
    expect(runtimeSync.mock.calls.at(-1)![0]).toBe(draft.project)
    expect(value.instances['a-text']!.data).not.toEqual(draftData)
  } finally { await player.dispose(); navigation.dispose() }
})
