import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentRuntimeContext, ComponentRuntimeScope, CourseProjectV10, JsonValue, TeacherControllerAction, TeacherControllerPort, TeacherControllerSnapshot } from '../../src/shared/contracts/component-platform'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { ComponentWorldInteractions } from '../../src/player/components/runtime/ComponentWorldInteractions'
import { containerIsActive, instanceContainerId, instanceWorkRootId } from '../../src/player/components/runtime/containerScopes'
import type { InteractionAction } from '../../src/shared/interactionTypes'

afterEach(() => document.body.replaceChildren())

function project(): CourseProjectV10 {
  return {
    schemaVersion: 11, id: 'nested-world', revision: 0, title: 'Nested World',
    rootIds: ['root', 'other', 'program'], entry: { rootInstanceId: 'root' },
    definitions: {
      container: { id: 'container', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } },
    },
    instances: {
      root: { id: 'root', definitionId: 'container', data: {}, childIds: ['A', 'B', 'top'], container: { kind: 'flow' } },
      A: { id: 'A', definitionId: 'container', data: {}, childIds: ['a'], container: { kind: 'spatial', spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } },
      B: { id: 'B', definitionId: 'container', data: {}, childIds: ['b'], container: { kind: 'spatial', spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } },
      a: { id: 'a', definitionId: 'source', data: {} },
      b: { id: 'b', definitionId: 'source', data: {} },
      top: { id: 'top', definitionId: 'source', data: {} },
      other: { id: 'other', definitionId: 'container', data: {}, childIds: ['hidden'], container: { kind: 'slide' } },
      hidden: { id: 'hidden', definitionId: 'source', data: {} },
      program: { id: 'program', definitionId: 'source', data: {}, childIds: ['programChild'] },
      programChild: { id: 'programChild', definitionId: 'source', data: {} },
    },
    global: { underlay: [], overlay: [] }, assets: {},
  }
}

/** The navigation port is the only state owner; the World receives its real binding contract. */
function navigation(input: CourseProjectV10) {
  let activeRoot = 'root'
  const listeners = new Set<() => void>(), states = new Map<string, string>(), zooms = new Map<string, number>()
  const actions: Array<{ target: string | null; type: string; containerId?: string; sceneId?: string }> = [], viewEffects: string[] = []
  let executeHook: ((action: TeacherControllerAction, signal?: AbortSignal) => Promise<boolean>) | undefined
  const snapshot = (id: string | null): TeacherControllerSnapshot => ({ locationId: id, scenes: id ? [{ id, name: id }] : [], progress: null,
    zoom: zooms.get(id ?? '') ?? 1, muted: false, fullscreen: false })
  const changed = () => { for (const listener of listeners) listener() }
  const port = (id: () => string | null): TeacherControllerPort => ({
    readLocation: id, currentStateId: () => states.get(id() ?? '') ?? 'overview', read: () => snapshot(id()),
    readVisibility: () => ({ zoom: zooms.get(id() ?? '') ?? 1, stateId: states.get(id() ?? '') ?? 'overview' }),
    forContainer: containerId => port(() => input.instances[containerId]?.container ? containerId : null),
    forInstance: instanceId => root.forInstance!(instanceId),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    canExecute: () => id() !== null,
    execute: async (action, signal, onCommit) => {
      if (signal?.aborted || !id()) return false
      actions.push({ target: id(), type: action.type, ...('containerId' in action ? { containerId: action.containerId } : {}), ...('sceneId' in action ? { sceneId: action.sceneId } : {}) })
      if (executeHook && !await executeHook(action, signal)) return false
      if (action.type === 'scene.go' && action.targetStateId) states.set(id()!, action.targetStateId)
      onCommit?.(); changed(); return true
    },
    isContainerActive: id => containerIsActive(input, id, activeRoot),
    cancel() { viewEffects.push('cancel') }, setCollapsed() { viewEffects.push('collapsed') }, moveBy() { viewEffects.push('move') },
    setZoom(value) { viewEffects.push('zoom'); zooms.set(id() ?? '', value); changed() }, resetView() { viewEffects.push('reset') },
  })
  const root = port(() => activeRoot)
  root.forContainer = id => port(() => input.instances[id]?.container ? id : null)
  root.forInstance = id => {
    const owner = instanceContainerId(input, id)
    if (owner && !input.rootIds.includes(owner)) return root.forContainer!(owner)
    return instanceWorkRootId(input, id) === 'program' ? port(() => null) : root
  }
  return { root, actions, viewEffects, changed, setRoot(id: string) { activeRoot = id; changed() },
    setExecuteHook(hook?: typeof executeHook) { executeHook = hook } }
}

function elements(input: CourseProjectV10) {
  const all = new Map(Object.keys(input.instances).map(id => [id, document.createElement('div')]))
  for (const [id, instance] of Object.entries(input.instances)) {
    for (const childId of instance.childIds ?? []) all.get(id)!.append(all.get(childId)!)
  }
  for (const id of input.rootIds) document.body.append(all.get(id)!)
  return all
}

it('keeps both nested peers active in one World, retains their scopes across root navigation and resets only the requested subtree', async () => {
  const input = project(), nav = navigation(input), nodes = elements(input)
  const contexts = new Map<string, ComponentRuntimeContext>(), mounts: string[] = [], disposed: string[] = []
  const activities = new Map<string, JsonValue>()
  const world = new ComponentRuntimeWorld('nested-world', { teacherController: nav.root, studentNavigation: nav.root,
    resolveSource: async () => ({ implementation: { mount(context) {
      mounts.push(context.instance.id); contexts.set(context.instance.id, context)
      context.scope.events.subscribe('__runtime.activity', value => activities.set(context.instance.id, value))
      return { update() {}, dispose() { disposed.push(context.instance.id) } }
    } } }) })
  for (const [id, element] of nodes) { world.bind(id, element); world.bindTarget(id, element) }
  try {
    await world.sync(input, { assets: {}, components: {} })
    expect(mounts.sort()).toEqual(['a', 'b', 'top'])
    expect(activities.get('a')).toMatchObject({ active: true, playing: true })
    expect(activities.get('b')).toMatchObject({ active: true, playing: true })
    const firstA = contexts.get('a')!.scope, firstB = contexts.get('b')!.scope
    const retainedController = contexts.get('top')!.teacherController!
    nav.setRoot('other'); await world.sync(input, { assets: {}, components: {} })
    expect(activities.get('a')).toMatchObject({ active: false })
    retainedController.cancel?.()
    expect(nav.viewEffects).toEqual([])
    expect(activities.get('b')).toMatchObject({ active: false })
    expect(firstA.isActive()).toBe(true); expect(firstB.isActive()).toBe(true)
    expect(mounts.filter(id => id === 'hidden')).toHaveLength(1)
    nav.setRoot('root'); await world.sync(input, { assets: {}, components: {} })
    expect(mounts.filter(id => id === 'a')).toHaveLength(1)
    expect(mounts.filter(id => id === 'b')).toHaveLength(1)
    await world.resetSurfacePrograms('A')
    expect(mounts.filter(id => id === 'a')).toHaveLength(2)
    expect(mounts.filter(id => id === 'b')).toHaveLength(1)
    expect(disposed).toEqual(['a'])
    expect(firstA.isActive()).toBe(false); expect(firstB.isActive()).toBe(true)
    nav.setRoot('program'); await world.sync(input, { assets: {}, components: {} })
    await world.resetSurfacePrograms('program')
    expect(mounts.filter(id => id === 'program')).toHaveLength(2)
    expect(mounts.filter(id => id === 'programChild')).toHaveLength(2)
  } finally { await world.dispose() }
})

function scope(instanceId: string): ComponentRuntimeScope {
  return { instanceId, runScopeId: 'interactions', generation: 1, signal: new AbortController().signal,
    isActive: () => true, cleanup() {}, target: () => null,
    events: { emit() {}, subscribe: () => () => {} },
    state: { get: () => undefined, set() {}, subscribe: () => () => {} } }
}

it('binds native and program interaction actions to local state and isolates same-name presentation triggers', async () => {
  const input = project(), nav = navigation(input), nodes = elements(input)
  const interactions = new ComponentWorldInteractions({ project: () => input, navigation: nav.root,
    element: id => nodes.get(id), document: () => document, audio: () => undefined, active: () => true,
    instanceActive: () => true, playback: () => true, report: () => {} })
  const context = (id: string): ComponentRuntimeContext => ({ instance: input.instances[id], scope: scope(id) })
  const a = interactions.ports(context('a')), b = interactions.ports(context('b')), program = interactions.ports(context('program'))
  const entered: string[] = []
  const offA = a.subscribeTrigger({ type: 'presentation.enter', stateId: 'detail' }, () => { entered.push('A') })
  const offB = b.subscribeTrigger({ type: 'presentation.enter', stateId: 'detail' }, () => { entered.push('B') })
  const actionContext = { signal: new AbortController().signal, ruleId: 'r', stepId: 's', restartFromBeginning: false }
  try {
    await Promise.resolve()
    expect(await a.executeAction({ type: 'presentation.set', stateId: 'detail' }, actionContext)).toBe(true)
    expect(entered).toEqual(['A'])
    expect(a.currentStateId()).toBe('detail'); expect(b.currentStateId()).toBe('overview')
    expect(await b.executeAction({ type: 'presentation.set', stateId: 'detail' }, actionContext)).toBe(true)
    expect(entered).toEqual(['A', 'B'])
    expect(await a.executeAction({ type: 'presentation.set', stateId: 'overview', containerId: 'B' } as InteractionAction, actionContext)).toBe(true)
    expect(nav.actions.map(action => action.target)).toEqual(['A', 'B', 'B'])
    expect(nav.actions.at(-1)).toMatchObject({ sceneId: 'B', containerId: 'B' })
    expect(await a.executeAction({ type: 'location.go', locationId: 'B', containerId: 'A' } as InteractionAction, actionContext)).toBe(false)
    expect(nav.actions).toHaveLength(3)
    expect(await a.executeAction({ type: 'location.go', locationId: 'other', containerId: 'A' } as InteractionAction, actionContext)).toBe(true)
    expect(nav.actions.at(-1)).toMatchObject({ target: 'A', sceneId: 'other', containerId: 'A' })
    expect(a.currentStateId()).toBe('detail'); expect(b.currentStateId()).toBe('overview')
    expect(await program.executeAction({ type: 'presentation.set', stateId: 'detail' }, actionContext)).toBe(false)
  } finally { offA(); offB(); interactions.dispose() }
})

it('mounts an explicitly owned native slot from a pure program root in the same Host and cleans only that slot binding', async () => {
  const input = project()
  input.rootIds = ['program']; input.entry = { rootInstanceId: 'program' }
  input.instances = { program: input.instances.program, programChild: input.instances.programChild }
  const root = document.createElement('main'); document.body.append(root)
  root.dataset.componentPlacement = 'program'
  Object.defineProperties(root, { clientWidth: { value: 900 }, clientHeight: { value: 480 } })
  const contexts = new Map<string, ComponentRuntimeContext>(), mounts: string[] = [], disposed: string[] = []
  let release: (() => void) | undefined
  const world = new ComponentRuntimeWorld('program-slot', { resolveSource: async () => ({ implementation: { mount(context) {
    mounts.push(context.instance.id); contexts.set(context.instance.id, context)
    if (context.instance.id === 'program') {
      const slot = document.createElement('section'); context.root!.append(slot)
      release = context.inline!.mount('programChild', slot)
      // The same program cannot mount an instance it does not own.
      context.inline!.mount('missing', slot)
    }
    return { update() {}, dispose() { disposed.push(context.instance.id) } }
  } } }) })
  world.bind('program', root); world.bindTarget('program', root)
  try {
    await world.sync(input, { assets: {}, components: {} })
    await expect.poll(() => mounts.filter(id => id === 'programChild').length).toBe(1)
    const childScope = contexts.get('programChild')!.scope
    expect(contexts.get('program')!.layout!.read()).toEqual({ mode: 'program-viewport', inlineSize: 900, blockSize: 480 })
    expect(root.querySelectorAll('[data-component-runtime-root="programChild"]')).toHaveLength(1)
    await world.sync(input, { assets: {}, components: {} })
    expect(mounts).toEqual(['program', 'programChild'])
    release!(); release!()
    expect(childScope.isActive()).toBe(true)
    expect(root.querySelector('[data-component-runtime-root="programChild"]')).toBeNull()
    expect(disposed).toEqual([])
  } finally { await world.dispose() }
})

it('restores the latest default placement after an inline lease and prevents retired leases reviving a deleted child', async () => {
  const input = project()
  input.rootIds = ['program']; input.entry = { rootInstanceId: 'program' }
  input.instances = { program: input.instances.program, programChild: input.instances.programChild }
  const nodes = elements(input), contexts = new Map<string, ComponentRuntimeContext>(), mounts: string[] = []
  const world = new ComponentRuntimeWorld('inline-default-placement', { resolveSource: async () => ({ implementation: { mount(context) {
    mounts.push(context.instance.id); contexts.set(context.instance.id, context)
    return { update() {}, dispose() {} }
  } } }) })
  for (const [id, element] of nodes) { world.bind(id, element); world.bindTarget(id, element) }
  try {
    await world.sync(input, { assets: {}, components: {} })
    const owner = contexts.get('program')!, firstChildScope = contexts.get('programChild')!.scope
    const childRoot = nodes.get('programChild')!.querySelector<HTMLElement>('[data-component-runtime-root="programChild"]')!
    const firstSlot = document.createElement('section'), secondSlot = document.createElement('section'), newDefault = document.createElement('div')
    owner.root!.append(firstSlot, secondSlot); nodes.get('program')!.append(newDefault)
    const release = owner.inline!.mount('programChild', firstSlot)
    world.bind('programChild', newDefault); world.bindTarget('programChild', newDefault)
    expect(childRoot.parentElement).toBe(firstSlot); expect(world.targetElement('programChild')).toBe(firstSlot)
    release()
    expect(childRoot.parentElement).toBe(newDefault); expect(world.targetElement('programChild')).toBe(newDefault)
    expect(contexts.get('programChild')!.scope).toBe(firstChildScope)
    expect(mounts.filter(id => id === 'programChild')).toHaveLength(1)
    const older = owner.inline!.mount('programChild', firstSlot), newer = owner.inline!.mount('programChild', secondSlot)
    older()
    expect(childRoot.parentElement).toBe(secondSlot); expect(world.targetElement('programChild')).toBe(secondSlot)
    newer()
    expect(childRoot.parentElement).toBe(newDefault)

    const borrowed = owner.inline!.mount('programChild', firstSlot), reparented = structuredClone(input)
    reparented.rootIds.push('other')
    reparented.instances.other = { id: 'other', definitionId: 'source', data: {}, childIds: ['programChild'] }
    reparented.instances.program.childIds = []
    world.bind('programChild', newDefault); world.bindTarget('programChild', newDefault)
    await world.sync(reparented, { assets: {}, components: {} })
    expect(childRoot.parentElement).toBe(newDefault); expect(world.targetElement('programChild')).toBe(newDefault)
    borrowed()
    expect(childRoot.parentElement).toBe(newDefault)
    expect(contexts.get('programChild')!.scope).toBe(firstChildScope)
    await world.sync(input, { assets: {}, components: {} })

    const deletedLease = owner.inline!.mount('programChild', firstSlot), removed = structuredClone(input)
    delete removed.instances.programChild; removed.instances.program.childIds = []
    await world.sync(removed, { assets: {}, components: {} })
    expect(firstChildScope.isActive()).toBe(false); expect(world.targetElement('programChild')).toBeUndefined()
    world.bind('programChild', newDefault); world.bindTarget('programChild', newDefault)
    await world.sync(input, { assets: {}, components: {} })
    const replacementRoot = newDefault.querySelector<HTMLElement>('[data-component-runtime-root="programChild"]')!
    const replacement = owner.inline!.mount('programChild', secondSlot)
    deletedLease()
    expect(replacementRoot).not.toBe(childRoot)
    expect(replacementRoot.parentElement).toBe(secondSlot); expect(world.targetElement('programChild')).toBe(secondSlot)
    replacement()
    expect(replacementRoot.parentElement).toBe(newDefault); expect(world.targetElement('programChild')).toBe(newDefault)
    expect(mounts.filter(id => id === 'programChild')).toHaveLength(2)
  } finally { await world.dispose() }
})

it('routes a presenter command into the focused nested region without advancing its sibling or the work root', async () => {
  const input = project(), nav = navigation(input), nodes = elements(input)
  const interactions = new ComponentWorldInteractions({ project: () => input, navigation: nav.root,
    element: id => nodes.get(id), document: () => document, audio: () => undefined, active: () => true,
    instanceActive: () => true, playback: () => true, report: () => {} })
  const invoked: string[] = [], off: Array<() => void> = []
  for (const id of ['a', 'b', 'top']) off.push(interactions.ports({ instance: input.instances[id], scope: scope(id) })
    .subscribeTrigger({ type: 'presenter.command', command: 'next' }, () => { invoked.push(id); return true }))
  try {
    const inputElement = document.createElement('input'); nodes.get('a')!.append(inputElement); inputElement.focus()
    expect(await interactions.dispatchPresenterCommand('next')).toBe(true)
    expect(invoked).toEqual(['a'])
    inputElement.blur()
    expect(await interactions.dispatchPresenterCommand('next')).toBe(true)
    expect(invoked).toEqual(['a', 'top'])
  } finally { off.forEach(dispose => dispose()); interactions.dispose() }
})

it('updates visibility only when a root or local visibility fact changes and limits local updates to that subtree', async () => {
  const input = project(), nav = navigation(input), nodes = elements(input)
  const world = new ComponentRuntimeWorld('visibility-scopes', { teacherController: nav.root, studentNavigation: nav.root,
    resolveSource: async () => ({ implementation: { mount() { return { update() {}, dispose() {} } } } }) })
  for (const [id, element] of nodes) { world.bind(id, element); world.bindTarget(id, element) }
  try {
    await world.sync(input, { assets: {}, components: {} })
    nav.changed() // Establish navigation visibility facts before testing camera-pan notifications.
    const interactions = (world as unknown as { interactions: ComponentWorldInteractions }).interactions
    const all = vi.spyOn(interactions, 'applyAllVisibility'), one = vi.spyOn(interactions, 'applyVisibility')
    nav.changed(); nav.changed(); nav.changed()
    expect(all).not.toHaveBeenCalled(); expect(one).not.toHaveBeenCalled()
    nav.root.forContainer!('A').setZoom(2)
    expect(all).toHaveBeenCalledTimes(1)
    expect(all.mock.calls[0][1]).toEqual(new Set(['A']))
    expect(all.mock.calls[0][2]).toBe(false)
    expect(one.mock.calls.map(call => call[0])).toEqual(['A', 'a'])
    all.mockClear(); one.mockClear()
    await nav.root.forContainer!('B').execute({ type: 'scene.go', sceneId: 'B', targetStateId: 'detail' })
    expect(all).toHaveBeenCalledTimes(1)
    expect(all.mock.calls[0][1]).toEqual(new Set(['B']))
    expect(one.mock.calls.map(call => call[0])).toEqual(['B', 'b'])
    all.mockRestore(); one.mockRestore()
  } finally { await world.dispose() }
})

it('retires old source navigation including derived ports and aborts its outstanding request before remounting the same instance', async () => {
  const input = project(), nav = navigation(input), nodes = elements(input)
  const contexts = new Map<string, ComponentRuntimeContext>()
  const world = new ComponentRuntimeWorld('retired-navigation', { teacherController: nav.root, studentNavigation: nav.root,
    resolveSource: async () => ({ implementation: { mount(context) {
      contexts.set(context.instance.id, context)
      return { update() {}, dispose() {} }
    } } }) })
  for (const [id, element] of nodes) { world.bind(id, element); world.bindTarget(id, element) }
  try {
    await world.sync(input, { assets: {}, components: {} })
    const old = contexts.get('a')!.teacherController!, oldB = old.forContainer!('B')
    let pendingSignal: AbortSignal | undefined
    const onCommit = vi.fn()
    nav.setExecuteHook((_action, signal) => new Promise(resolve => {
      pendingSignal = signal
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    }))
    const request = old.execute({ type: 'step.next' }, undefined, onCommit)
    expect(pendingSignal?.aborted).toBe(false)
    await world.resetSurfacePrograms('A')
    expect(pendingSignal?.aborted).toBe(true); expect(await request).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
    nav.setExecuteHook()
    const newController = contexts.get('a')!.teacherController!
    expect(newController).not.toBe(old)
    const before = nav.actions.length, callback = vi.fn()
    old.subscribe(callback); oldB.subscribe(callback)
    expect(old.canExecute({ type: 'step.next' })).toBe(false)
    expect(await old.execute({ type: 'step.next' })).toBe(false)
    expect(await oldB.execute({ type: 'step.next' })).toBe(false)
    expect(await old.forContainer!('B').execute({ type: 'step.next' })).toBe(false)
    expect(await old.forInstance!('b').execute({ type: 'step.next' })).toBe(false)
    for (const retired of [old, oldB]) {
      retired.cancel?.(); retired.setCollapsed(true); retired.moveBy(1, 1); retired.setZoom(2); retired.resetView()
    }
    nav.changed()
    expect(callback).not.toHaveBeenCalled(); expect(nav.actions).toHaveLength(before); expect(nav.viewEffects).toEqual([])
    expect(old.readLocation()).toBeNull()
    expect(await newController.execute({ type: 'step.next' })).toBe(true)
    expect(await newController.forContainer!('B').execute({ type: 'step.next' })).toBe(true)
    expect(nav.actions.slice(before).map(action => action.target)).toEqual(['A', 'B'])
  } finally { await world.dispose() }
})

it('connects a retained native click rule when its DOM target arrives after the behavior and follows that target document', async () => {
  const input = project(), nav = navigation(input), reports: string[] = []
  input.definitions.native = { id: 'native', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  input.definitions.rules = { id: 'rules', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  input.instances.a.definitionId = 'native'; input.instances.A.childIds!.push('rules')
  input.instances.rules = { id: 'rules', definitionId: 'rules', data: { rules: [{ id: 'overview', enabled: true,
    trigger: { type: 'node.click', nodeId: 'a' }, conditions: [], actions: [{ id: 'go', start: 'after-previous', delayMs: 0,
      action: { type: 'presentation.set', stateId: 'detail' } }] }] } }
  const world = new ComponentRuntimeWorld('late-native-click', { teacherController: nav.root, studentNavigation: nav.root, report: message => reports.push(message) })
  const firstDocumentAdd = vi.spyOn(document, 'addEventListener'), firstDocumentRemove = vi.spyOn(document, 'removeEventListener')
  try {
    await world.sync(input, { assets: {}, components: {} })
    const generation = world.host.capabilities('late-native-click', 'rules').generation
    expect(generation).toBeGreaterThan(0)
    const button = document.createElement('button'), label = document.createElement('span')
    label.textContent = 'Native detail'; button.append(label); document.body.append(button)
    world.bind('a', button); world.bindTarget('a', button)
    await world.sync(input, { assets: {}, components: {} })
    label.click()
    await expect.poll(() => nav.actions.length).toBe(1)
    expect(nav.actions[0]).toMatchObject({ target: 'A', type: 'scene.go' })
    expect(world.host.capabilities('late-native-click', 'rules').generation).toBe(generation)
    const firstListener = firstDocumentAdd.mock.calls.find(call => call[0] === 'click')?.[1]
    expect(firstListener).toBeTypeOf('function')

    const nextDocument = document.implementation.createHTMLDocument('next target document')
    const nextRemove = vi.spyOn(nextDocument, 'removeEventListener'), nextButton = nextDocument.createElement('button')
    nextDocument.body.append(nextButton)
    world.bind('a', nextButton); world.bindTarget('a', nextButton)
    await world.sync(input, { assets: {}, components: {} })
    expect(firstDocumentRemove).toHaveBeenCalledWith('click', firstListener, true)
    label.click(); nextButton.click()
    await expect.poll(() => nav.actions.length).toBe(2)
    expect(world.host.capabilities('late-native-click', 'rules').generation).toBe(generation)
    await world.dispose()
    expect(nextRemove.mock.calls.filter(call => call[0] === 'click')).toHaveLength(1)
    nextButton.click(); await Promise.resolve()
    expect(nav.actions).toHaveLength(2); expect(reports).toEqual([])
    nextRemove.mockRestore()
  } finally { await world.dispose(); firstDocumentAdd.mockRestore(); firstDocumentRemove.mockRestore() }
})

async function borrowedPlacementFixture(runScopeId: string) {
  const input = project()
  input.rootIds = ['program']; input.entry = { rootInstanceId: 'program' }
  input.instances = { program: input.instances.program, programChild: input.instances.programChild }
  const nodes = elements(input), contexts = new Map<string, ComponentRuntimeContext>(), mounts: string[] = []
  const world = new ComponentRuntimeWorld(runScopeId, { resolveSource: async () => ({ implementation: { mount(context) {
    contexts.set(context.instance.id, context); mounts.push(context.instance.id)
    return { update() {}, dispose() {} }
  } } }) })
  for (const [id, element] of nodes) { world.bind(id, element); world.bindTarget(id, element) }
  await world.sync(input, { assets: {}, components: {} })
  const owner = contexts.get('program')!, childScope = contexts.get('programChild')!.scope, defaultHost = nodes.get('programChild')!
  const liveRoot = defaultHost.querySelector<HTMLElement>('[data-component-runtime-root="programChild"]')!, slot = document.createElement('section')
  owner.root!.append(slot)
  return { world, owner, childScope, defaultHost, liveRoot, slot, mounts }
}

it('retires an inline-borrowed default projection without resurrecting its removed DOM when the lease releases', async () => {
  const f = await borrowedPlacementFixture('retire-borrowed-default')
  try {
    const release = f.owner.inline!.mount('programChild', f.slot)
    f.defaultHost.remove()
    f.world.bind('programChild', null, f.defaultHost); f.world.bindTarget('programChild', null, f.defaultHost)
    expect(f.liveRoot.parentElement).toBe(f.slot)
    expect(f.world.targetElement('programChild')).toBe(f.slot)
    release()
    expect(f.world.contentElement('programChild')).toBeUndefined()
    expect(f.world.targetElement('programChild')).toBeUndefined()
    expect(f.defaultHost.contains(f.liveRoot)).toBe(false)
    expect(f.liveRoot.isConnected).toBe(true); expect(f.childScope.isActive()).toBe(true)
    expect(f.mounts.filter(id => id === 'programChild')).toHaveLength(1)
  } finally { await f.world.dispose() }
})

it('keeps a replacement default projection when an older projection retires during the same inline lease', async () => {
  const f = await borrowedPlacementFixture('replace-borrowed-default')
  try {
    const release = f.owner.inline!.mount('programChild', f.slot)
    const nextTarget = document.createElement('article'), nextRoot = document.createElement('div')
    nextTarget.append(nextRoot); document.body.append(nextTarget)
    f.world.bind('programChild', nextRoot); f.world.bindTarget('programChild', nextTarget)
    f.defaultHost.remove()
    f.world.bind('programChild', null, f.defaultHost); f.world.bindTarget('programChild', null, f.defaultHost)
    expect(f.liveRoot.parentElement).toBe(f.slot)
    release()
    expect(f.liveRoot.parentElement).toBe(nextRoot)
    expect(f.world.contentElement('programChild')).toBe(nextRoot)
    expect(f.world.targetElement('programChild')).toBe(nextTarget)
    f.world.bind('programChild', null, f.defaultHost); f.world.bindTarget('programChild', null, f.defaultHost)
    expect(f.liveRoot.parentElement).toBe(nextRoot); expect(f.world.targetElement('programChild')).toBe(nextTarget)
    expect(f.childScope.isActive()).toBe(true)
    expect(f.mounts.filter(id => id === 'programChild')).toHaveLength(1)
  } finally { await f.world.dispose() }
})
