import { restoreDefaultTeacherController } from '../../src/renderer/course/globalLayerCommands'
import { missingTeacherControllerTransaction } from '../../src/renderer/components/teacherControllerComponent'
import { collectCourseProjectComponentHealth } from '../../src/shared/courseProjectHealth/component'
import { describe, it, expect } from 'vitest'
import { layerItemIsHittable, layerItemBounds } from '../../src/renderer/phaser/layerItemHitTest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createPublishedCourseSession } from '../../src/player/surfaces/publishedDynamicHosts'
import { hasCourseDeliveryVisibleTeacherController } from '../../src/shared/teacherControllerConsistency'
import { useEditorStore, selectActiveCourseProjectDocument } from '../../src/renderer/store/editorStore'
import { planTeacherControllerComponentEdit } from '../../src/renderer/components/teacherControllerComponent'
import { TeacherControllerComponentHost } from '../../src/player/teacherControllerComponentHost'
import { teacherControllerHostNode } from '../../src/player/teacherControllerHostContract'
import { controllerGeometryItem } from '../../src/player/teacherControllerComponentGeometry'
import type { ComponentTeacherControllerPort } from '../../src/shared/contracts/component-v4/teacherController'

describe('embedded teacher controller', () => {
  it('renders the same button states in edit and preview while edit clicks stay inert', async () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const item = bundle.project.globalLayerItems[0]!.item
    if (item.kind !== 'component') throw new Error('component')
    let actions = 0
    const states: unknown[] = []
    for (const mode of ['edit', 'preview'] as const) {
      const container = document.createElement('div')
      document.body.append(container)
      const host = new TeacherControllerComponentHost({
        node: teacherControllerHostNode(item.frame, item.rotation), container,
        canvas: { width: 1280, height: 720 }, getRenderedStageBounds: () => ({ width: 1280, height: 720 }),
        scenes: [], getCurrentSceneId: () => null, getStateLabel: () => null,
        getStatus: () => ({ muted: false, fullscreen: false }),
        getSession: () => ({ collapsed: false, offset: { dx: 0, dy: 0 } }), onSessionChange() {},
        getInteractive: () => mode === 'preview', onAction() { actions++ },
      }, { container, instanceId: item.layerItemId, componentId: item.component.packageId, version: item.component.version,
        components: bundle.componentPackages, props: item.props, scope: 'global', mode, interactive: mode === 'preview', width: item.frame.width, height: item.frame.height })
      const root = host.rootElement.shadowRoot!
      states.push([...root.querySelectorAll('button')].map(button => [button.getAttribute('aria-label'), button.disabled]))
      const next = root.querySelector<HTMLButtonElement>('[aria-label="下一步"]')!
      expect(next.disabled).toBe(false)
      next.click()
      await Promise.resolve()
      expect(actions).toBe(mode === 'edit' ? 0 : 1)
      host.destroy(); container.remove()
    }
    expect(states[0]).toEqual(states[1])
  })

  it('ships a real thumbnail and does not require external import provenance for the editable built-in package', () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const packageData = Object.values(bundle.componentPackages)[0]!
    expect(packageData.files[packageData.manifest.thumbnail!]?.length).toBeGreaterThan(0)
    expect(collectCourseProjectComponentHealth(bundle.project, { assetFiles: {}, componentFiles: {} })).toEqual([])
    const external = structuredClone(bundle.project)
    Object.values(external.componentPackages)[0]!.editableCopy = false
    expect(collectCourseProjectComponentHealth(external, { assetFiles: {}, componentFiles: {} }).map(f => f.code)).toEqual(expect.arrayContaining(['component-package-hash-missing', 'component-package-source-missing']))
  })
  it('uses the mounted custom footprint for authoring and releases it without changing saved dimensions', () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const item = bundle.project.globalLayerItems[0]!.item
    if (item.kind !== 'component') throw new Error('component')
    const pkg = bundle.componentPackages[item.component.packageId]!
    pkg.runtimeSource = `window.CoursewareComponent.define({id:'${pkg.manifest.id}',runtimeApiVersion:4,create(ctx){ctx.dom.root.style.width='76px';ctx.dom.root.style.height='44px';return {destroy(){}}}})`
    const saved = structuredClone(item.frame), container = document.createElement('div')
    document.body.append(container)
    const host = new TeacherControllerComponentHost({
      node: teacherControllerHostNode(item.frame, item.rotation),
      container, canvas: { width: 1280, height: 720 }, getRenderedStageBounds: () => ({ width: 1280, height: 720 }),
      scenes: [], getCurrentSceneId: () => null, getStateLabel: () => null, getStatus: () => ({ muted: false, fullscreen: false }),
      getSession: () => ({ collapsed: true, offset: { dx: 0, dy: 0 } }), onSessionChange() {}, getInteractive: () => false, onAction() {},
    }, { container, instanceId: item.layerItemId, componentId: pkg.manifest.id, version: pkg.manifest.version, components: bundle.componentPackages, scope: 'global', mode: 'edit', interactive: false, width: item.frame.width, height: item.frame.height })
    expect(layerItemBounds(item)).toMatchObject({ x: saved.x + saved.width - 76, y: saved.y + saved.height - 44, width: 76, height: 44 })
    expect(item.frame).toEqual(saved)
    host.destroy(); container.remove()
    expect(layerItemBounds(item)).toMatchObject({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
  })
  it('allows the global component controller to be selected in scene editing', () => {
    const { project } = withDefaultComponentController(createBlankCourseProject())
    const item = project.globalLayerItems[0]!.item
    expect(layerItemIsHittable(item, true, 'scene')).toBe(true)
    expect(layerItemIsHittable(item, true, 'surface')).toBe(false)
    expect(layerItemIsHittable(item, true, 'global')).toBe(true)
  })
  it('keeps maintenance actions out of valid controller playback', async () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const payload = buildPublishedCourseV2Payload({ project: bundle.project, assetFiles: {}, components: bundle.componentPackages })
    const container = document.createElement('div'); document.body.append(container)
    const session = createPublishedCourseSession(payload)
    try {
      await session.mount(container)
      const controls = [...document.querySelectorAll('.published-component-mount')].flatMap(el => [...el.shadowRoot?.querySelectorAll('button') ?? []])
      expect(controls.length).toBeGreaterThan(0)
      expect([...document.querySelectorAll('button')].some(button => button.textContent === '恢复教师控制台')).toBe(false)
    } finally { await session.destroy(); container.remove() }
  })
  it('does not inject replacement controls or a recovery shortcut for an empty custom controller', async () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const pkg = Object.values(bundle.componentPackages)[0]!
    pkg.runtimeSource = `window.CoursewareComponent.define({id:'${pkg.manifest.id}',runtimeApiVersion:4,create(){return {destroy(){}}}})`
    const payload = buildPublishedCourseV2Payload({ project: bundle.project, assetFiles: {}, components: bundle.componentPackages })
    const container = document.createElement('div'); document.body.append(container)
    const session = createPublishedCourseSession(payload)
    try {
      await session.mount(container)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, altKey: true, bubbles: true }))
      expect([...document.querySelectorAll('button')].some(button => button.textContent === '恢复教师控制台')).toBe(false)
      const controls = [...document.querySelectorAll('.published-component-mount')].flatMap(el => [...el.shadowRoot?.querySelectorAll('button') ?? []])
      expect(controls).toHaveLength(0)
      expect(document.querySelector('.slide-teacher-controller-background')).toBeNull()
    } finally { await session.destroy(); container.remove() }
    expect(document.querySelector('.published-component-mount')).toBeNull()
  })
  it.each(['createNewProject', 'createNewFlowProject', 'createNewSpatialProject'] as const)('recovers a deleted controller with its source in one undoable transaction: %s', factory => {
    const state = () => useEditorStore.getState()
    state()[factory]()
    const initial = selectActiveCourseProjectDocument(state())!
    expect(initial.globalLayerItems[0]!.item).toMatchObject({ kind: 'component', role: 'teacher-controller' })
    const missing = structuredClone(initial)
    missing.globalLayerItems = []; missing.playback.controls = 'none'
    state().loadCourseProject(missing, null, {}, state().componentPackages)
    state().ensureTeacherController()
    const recovered = selectActiveCourseProjectDocument(state())!
    const item = recovered.globalLayerItems[0]!.item
    expect(item).toMatchObject({ kind: 'component', role: 'teacher-controller' })
    if (item.kind !== 'component') throw new Error('component')
    expect(state().componentPackages[item.component.packageId]?.runtimeSource).toContain('ctx.teacherController')
    state().undo()
    expect(selectActiveCourseProjectDocument(state())!.globalLayerItems).toHaveLength(0)
    expect(state().componentPackages[item.component.packageId]).toBeUndefined()
    state().redo()
    expect(selectActiveCourseProjectDocument(state())!.globalLayerItems[0]!.item).toEqual(item)
    expect(state().componentPackages[item.component.packageId]).toBeDefined()
  })

  it('restores source without discarding course configuration and refuses locked edits', () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const item = bundle.project.globalLayerItems[0]!.item
    if (item.kind !== 'component') throw new Error('component')
    item.props.title = '本课专用标题'
    const plan = planTeacherControllerComponentEdit(bundle.project, bundle.componentPackages, item.layerItemId, 'restore')
    expect(plan.nextDocument.globalLayerItems[0]!.item).toMatchObject({ props: { title: '本课专用标题' } })
    item.locked = true
    expect(() => planTeacherControllerComponentEdit(bundle.project, bundle.componentPackages, item.layerItemId, 'restore')).toThrow('锁定')
  })

  it('reports rejected host actions and revokes retained controller ports after destruction', async () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const item = bundle.project.globalLayerItems[0]!.item
    if (item.kind !== 'component' || item.role !== 'teacher-controller') throw new Error('component')
    const pkg = bundle.componentPackages[item.component.packageId]!
    pkg.runtimeSource = pkg.runtimeSource.replace('const root = ctx.dom.root', 'window.__testControllerPort = ctx.teacherController; const root = ctx.dom.root')
    const container = document.createElement('div'); document.body.append(container)
    let calls = 0
    const host = new TeacherControllerComponentHost({
      node: teacherControllerHostNode(item.frame, item.rotation),
      container, canvas: { width: 1280, height: 720 }, getRenderedStageBounds: () => ({ width: 1280, height: 720 }),
      scenes: [], getCurrentSceneId: () => null, getStateLabel: () => null, getStatus: () => ({ muted: false, fullscreen: false }),
      getSession: () => ({ collapsed: false, offset: { dx: 0, dy: 0 } }), onSessionChange() {}, getInteractive: () => true,
      onAction: async () => { calls++; return false },
    }, { container, componentId: pkg.manifest.id, version: pkg.manifest.version, components: bundle.componentPackages, scope: 'global', interactive: true, width: item.frame.width, height: item.frame.height })
    const port = (window as unknown as { __testControllerPort: ComponentTeacherControllerPort }).__testControllerPort
    expect(await port.execute({ type: 'step.next' })).toBe(false)
    expect(calls).toBe(1)
    host.destroy()
    await port.execute({ type: 'step.next' })
    expect(calls).toBe(1)
    container.remove()
  })
  it('recovers into a free package identity without overwriting retained custom source metadata', () => {
    const before = createBlankCourseProject()
    const oldMetadata = structuredClone(before.componentPackages)
    before.globalLayerItems = []; before.playback.controls = 'none'
    const recovered = restoreDefaultTeacherController(before)
    expect(recovered.ok).toBe(true)
    const item = recovered.nextDocument!.globalLayerItems[0]!.item
    if (item.kind !== 'component') throw new Error('component')
    expect(item.component.packageId).not.toBe(Object.keys(oldMetadata)[0])
    expect(recovered.nextDocument!.componentPackages[Object.keys(oldMetadata)[0]!]).toEqual(Object.values(oldMetadata)[0])
    const step = missingTeacherControllerTransaction(before, recovered.nextDocument!, item.layerItemId)!
    expect(step.resourceChanges?.componentPackageChanges?.map(change => change.packageId)).toEqual([item.component.packageId])
  })

  it('creates the component directly and preserves source through an archive', () => {
    const { project, componentPackages } = withDefaultComponentController(createBlankCourseProject())
    const item = project.globalLayerItems[0]!.item
    expect(item.kind).toBe('component')
    expect(hasCourseDeliveryVisibleTeacherController(project)).toBe(true)
    const packageData = Object.values(componentPackages)[0]!
    const key = packageData.manifest.id
    const bytes = createCourseProjectArchive({ project, assetFiles: {}, componentFiles: { [key]: packageData.files } })
    const restored = openCourseProjectArchive(bytes)
    expect(restored.project.globalLayerItems[0]!.item).toEqual(item)
    expect(new TextDecoder().decode(restored.componentFiles[key + '@1.0.0']!['runtime.js'])).toBe(packageData.runtimeSource)
    expect(() => courseProjectDocumentSchema.parse({ ...project, globalLayerItems: [...project.globalLayerItems, ...project.globalLayerItems] })).toThrow()
    expect(() => courseProjectDocumentSchema.parse({ ...project, globalLayerItems: project.globalLayerItems.map(e => ({ ...e, plane: 'underlay' })) })).toThrow()
  })

  it('mounts the embedded source and advances presentation steps through the real Published session', async () => {
    const bundle = withDefaultComponentController(createBlankCourseProject())
    const slide = bundle.project.surfaces.find(s => s.type === 'slide')!
    slide.scenes[0]!.presentation = { initialStateId: 'one', states: ['one', 'two'].map(id => ({ id, name: id, layerItemOverrides: {} })) }
    const payload = buildPublishedCourseV2Payload({ project: bundle.project, assetFiles: {}, components: bundle.componentPackages })
    expect(payload.globalLayerItems[0]!.item).toMatchObject({ kind: 'component', role: 'teacher-controller' })
    const container = document.createElement('div')
    document.body.append(container)
    const session = createPublishedCourseSession(payload)
    try {
      await session.mount(container)
      const mount = container.querySelector<HTMLElement>('.published-component-mount')!
      const controllerRoot = mount.shadowRoot!
      expect(controllerRoot.querySelector('[aria-label="展开教师控制器"]')?.textContent).toBe('展')
      expect(mount.style.width).toBe('52px')
      expect(mount.parentElement!.style.width).toBe('52px')
      ;controllerRoot.querySelector<HTMLButtonElement>('[aria-label="展开教师控制器"]')?.click()
      expect(mount.style.width).toBe('880px')
      expect(controllerRoot.querySelector('[aria-label="收起教师控制器"]')?.textContent).toBe('收')
      expect(controllerRoot.querySelector('[aria-label="缩放"]')?.textContent).toBe('100%')
      expect(controllerRoot.querySelector('[aria-label="上一步"]')?.className).toBe(controllerRoot.querySelector('[aria-label="下一步"]')?.className)
      const next = [...controllerRoot.querySelectorAll('button')].find(b => b.textContent === '下一步')
      expect(next).toBeTruthy()
      expect(next!.disabled).toBe(false)
      next!.click()
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(session.getPlaybackProgress()?.stepIndex).toBe(1)
      const current = container.querySelector<HTMLElement>('.published-component-mount')!
      current.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="收起教师控制器"]')!.click()
      expect(current.style.width).toBe('52px')
      expect(current.style.height).toBe('52px')
      expect(current.shadowRoot!.querySelectorAll('button')).toHaveLength(1)
    } finally { await session.destroy(); container.remove() }
  })
})

