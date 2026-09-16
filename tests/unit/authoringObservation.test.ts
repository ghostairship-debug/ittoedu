import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import {
  authoringObservationDraftToken,
  createAuthoringObservationController,
  registerAuthoringObservationHost,
  registerAuthoringObservationDraft,
  type AuthoringObservationPorts,
  type AuthoringObservationState,
} from '@/renderer/authoring/generation/authoringObservation'
import { authoringObservationInputSchema } from '@/shared/authoringObservation'
import { CourseStateStore } from '@/player/CourseStateStore'
import { registerPublishedCaptureResource } from '@/player/surfaces/publishedCapture'
import { MAX_GENERATION_RESOURCE_BYTES } from '@/shared/generationContract'

const disposers: Array<() => void> = []
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iKisAAAAASUVORK5CYII='
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function harness(options: Pick<AuthoringObservationPorts, 'prepareImageResources'> = {}) {
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces[0]!
  if (surface.type !== 'flow') throw new Error('Flow fixture required')
  surface.blocks.push({ id: 'observation-paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: '已提交的正文' }] } })
  let state: AuthoringObservationState = { document: project, sessionGeneration: 3, surfaceId: surface.id,
    locationId: project.startLocationId, stateId: null, selectedIds: ['observation-paragraph'], draft: null, assetFiles: {} }
  const root = document.createElement('main')
  document.body.append(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 30, left: 20, top: 30, right: 720, bottom: 530,
    width: 700, height: 500, toJSON: () => ({}) })
  const sync = () => Object.assign(root.dataset, { observationSource: 'authoring', observationProjectId: state.document.id,
    observationSessionGeneration: String(state.sessionGeneration),
    observationRevision: String(state.document.revision), observationSurfaceId: state.surfaceId, observationLocationId: state.locationId,
    observationStateId: state.stateId ?? '', observationReady: 'true', observationDraftToken: String(authoringObservationDraftToken(state.draft)) })
  sync()
  const prepare = vi.fn(() => ({ ok: true as const }))
  const materialize = vi.fn(() => ({ ok: true as const, snapshot: { project: state.document } }))
  const captureImage = vi.fn(async () => ({ dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }))
  const waitForPaint = vi.fn(async () => undefined)
  const controller = createAuthoringObservationController({ read: () => state, prepareForEdit: prepare,
    materializeDraft: materialize, captureImage, waitForPaint, ...options })
  disposers.push(controller.dispose)
  return { root, controller, prepare, materialize, captureImage, waitForPaint, get state() { return state },
    replace(next: Partial<AuthoringObservationState>, paint = true) { state = { ...state, ...next }; if (paint) sync() }, sync }
}

describe('current authoring observation', () => {
  it('reports measured Flow body width, scroll and paper origin separately from authored layout', async () => {
    const h = harness(), scroll = document.createElement('div'), paper = document.createElement('article')
    scroll.dataset.flowMediaQueryRoot = 'true'; paper.className = 'flow-body-content'; paper.style.padding = '28px 36px 64px'
    scroll.append(paper); h.root.append(scroll)
    Object.defineProperties(paper, { offsetWidth: { value: 650 }, clientWidth: { value: 650 } })
    paper.getBoundingClientRect = () => DOMRect.fromRect({ x: 36, y: -46, width: 650, height: 1000 })
    scroll.scrollTop = 100
    const captured = await h.controller.capture({ intent: 'edit' })
    const file = captured.resourceFiles.find(file => file.path === 'observation/current-structure.json')!
    expect(JSON.parse(file.content)).toMatchObject({ layout: { widthMode: 'fluid' }, flowView: {
      paperWidth: 650, bodyWidth: 578, paperScroll: { x: 0, y: 100 }, paperClientOrigin: { x: 16, y: -76 }, observationScale: 1,
    } })
  })
  it('uses only the formal preview matching the frozen target and never flushes a background draft', async () => {
    const h = harness(), target = { locationId: h.state.locationId, surfaceId: h.state.surfaceId, stateId: h.state.stateId }
    h.root.dataset.observationLocationId = 'currently-browsed-other-page'
    const addPreview = (locationId: string, left: number) => {
      const root = document.createElement('section'); document.body.append(root)
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: left, y: 0, left, top: 0, right: left + 100, bottom: 100,
        width: 100, height: 100, toJSON: () => ({}) })
      disposers.push(registerAuthoringObservationHost({ root, source: 'preview', read: () => ({
        projectId: h.state.document.id, documentRevision: h.state.document.revision, surfaceId: target.surfaceId,
        locationId, stateId: null, ready: true, stateVersion: 1, publicState: { locationId },
      }) }))
    }
    addPreview('currently-browsed-other-page', 0)
    addPreview(target.locationId, 200)
    const captured = await h.controller.capture({ intent: 'edit', target, prepareDrafts: false })
    expect(captured.observation).toMatchObject({ source: 'preview', ...target })
    expect(h.captureImage).toHaveBeenCalledWith({ x: 200, y: 0, width: 100, height: 100 })
    expect(h.prepare).not.toHaveBeenCalled()
    expect(h.materialize).not.toHaveBeenCalled()
    const stateFile = captured.resourceFiles.find(file => file.path === 'observation/runtime-state.json')!
    expect(JSON.parse(stateFile.content).state).toEqual({ locationId: target.locationId })
  })

  it('rejects an unavailable original host before taking an image of the currently browsed page', async () => {
    const h = harness(), target = { locationId: h.state.locationId, surfaceId: h.state.surfaceId, stateId: h.state.stateId }
    h.root.dataset.observationLocationId = 'another-page'
    await expect(h.controller.capture({ intent: 'edit', target, prepareDrafts: false })).rejects.toThrow('原任务目标没有可用的正式')
    expect(h.captureImage).not.toHaveBeenCalled()
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('waits for a rendered frame after actual resource readiness before native capture', async () => {
    const h = harness(), order: string[] = []
    let finishResource!: () => void, finishPaint!: () => void, secondPaintStarted!: () => void
    const resourceReady = new Promise<void>(resolve => { finishResource = resolve })
    const painted = new Promise<void>(resolve => { finishPaint = resolve })
    const painting = new Promise<void>(resolve => { secondPaintStarted = resolve })
    disposers.push(registerPublishedCaptureResource(h.root, {
      waitForCaptureReady: async () => undefined,
      waitForObservationReady: async () => { order.push('resource-start'); await resourceReady; order.push('resource-ready') },
    }))
    h.waitForPaint.mockImplementationOnce(async () => { order.push('initial-paint') })
      .mockImplementationOnce(async () => { order.push('final-paint-start'); secondPaintStarted(); await painted; order.push('final-paint-ready') })
    h.captureImage.mockImplementation(async () => {
      order.push('capture')
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    const pending = h.controller.capture({ intent: 'edit' })
    await Promise.resolve()
    expect(h.captureImage).not.toHaveBeenCalled()
    finishResource()
    await painting
    expect(h.captureImage).not.toHaveBeenCalled()
    finishPaint()
    await pending
    expect(order).toEqual(['initial-paint', 'resource-start', 'resource-ready', 'final-paint-start', 'final-paint-ready', 'capture'])
  })

  it('binds the completed Owner DOM after resource readiness without reusing its earlier mutation epoch', async () => {
    const h = harness()
    disposers.push(registerPublishedCaptureResource(h.root, {
      waitForCaptureReady: async () => undefined,
      waitForObservationReady: async () => { h.root.append(document.createTextNode('当前正文已完成绘制')) },
    }))
    h.captureImage.mockImplementation(async () => {
      expect(h.root.textContent).toBe('当前正文已完成绘制')
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'edit' })).resolves.toMatchObject({ observation: { source: 'authoring' } })
    expect(h.captureImage).toHaveBeenCalledTimes(1)
  })

  it.each(['document', 'draft', 'selection', 'view', 'input', 'geometry'] as const)('keeps the drift guard when %s changes during the final frame wait', async change => {
    const h = harness()
    h.waitForPaint.mockImplementationOnce(async () => undefined).mockImplementationOnce(async () => {
      if (change === 'document') h.replace({ document: { ...h.state.document, revision: h.state.document.revision + 1 } })
      if (change === 'draft') h.replace({ draft: { text: '帧等待期间继续输入' } })
      if (change === 'selection') h.replace({ selectedIds: [] })
      if (change === 'view') h.root.dispatchEvent(new Event('scroll'))
      if (change === 'input') h.root.dispatchEvent(new Event('input'))
      if (change === 'geometry') {
        const rect = h.root.getBoundingClientRect()
        vi.mocked(h.root.getBoundingClientRect).mockReturnValue({ ...rect, width: rect.width + 20, right: rect.right + 20 })
      }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('待同步')
  })

  it('captures live extension animation while rejecting changes to its mount wrapper or user view', async () => {
    const h = harness(), wrapper = document.createElement('section'), runtime = document.createElement('div')
    runtime.dataset.surfaceRuntimeRoot = 'actual-mounted-runtime'
    wrapper.append(runtime); h.root.append(wrapper)
    h.captureImage.mockImplementation(async () => {
      runtime.style.transform = 'translateX(30px)'
      runtime.replaceChildren(document.createTextNode('frame 42'))
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).resolves.toMatchObject({ observation: { source: 'authoring' } })
    h.captureImage.mockImplementation(async () => {
      wrapper.style.transform = 'scale(2)'
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('待同步')
    h.captureImage.mockImplementation(async () => {
      runtime.dispatchEvent(new Event('input', { bubbles: true }))
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('待同步')
    h.captureImage.mockImplementation(async () => {
      runtime.remove()
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('待同步')
  })
  it('accepts the initial unchanged ResizeObserver notification but rejects an actual capture-time resize', async () => {
    let resized!: () => void
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect() {}
    })
    const h = harness()
    h.captureImage.mockImplementation(async () => {
      resized()
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).resolves.toMatchObject({ observation: { source: 'authoring' } })
    h.captureImage.mockImplementation(async () => {
      const previous = h.root.getBoundingClientRect()
      vi.mocked(h.root.getBoundingClientRect).mockReturnValue({ ...previous, width: previous.width + 10, right: previous.right + 10 })
      resized()
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('待同步')
  })
  it('reads the actual Owner draft for discussion while preserving canonical targets and history', async () => {
    const h = harness(), canonical = h.state.document
    const draft = { text: '尚未保存的活动草稿' }
    h.replace({ draft })
    const projected = structuredClone(canonical)
    const surface = projected.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Flow fixture required')
    surface.blocks.push({ id: 'current-draft', type: 'paragraph', content: { inlines: [{ type: 'text', text: draft.text }] } })
    projected.revision += 1 // Some recovery Owners materialize a transient revision.
    h.materialize.mockReturnValue({ ok: true, snapshot: { project: projected } })
    const result = await h.controller.capture({ intent: 'discuss' })
    expect(h.prepare).not.toHaveBeenCalled()
    expect(result.document).toBe(canonical)
    expect(result.observation.documentRevision).toBe(canonical.revision)
    expect(result.resourceFiles.find(file => file.role === 'structure')!.content).toContain(draft.text)
    expect(JSON.stringify(canonical)).not.toContain(draft.text)
    expect(result.observation.files.some(file => file.fileId === 'current-frame')).toBe(true)
    expect(h.captureImage).toHaveBeenCalledWith({ x: 20, y: 30, width: 700, height: 500 })
  })

  it('prepares an edit through the existing Owner before binding document and image versions', async () => {
    const h = harness(), previous = h.state.document
    h.replace({ draft: { text: '提交后再观察' } })
    h.prepare.mockImplementation(() => {
      h.replace({ document: { ...previous, revision: previous.revision + 1 }, draft: null })
      return { ok: true }
    })
    const result = await h.controller.capture({ intent: 'edit' })
    expect(h.prepare).toHaveBeenCalledTimes(1)
    expect(h.materialize).not.toHaveBeenCalled()
    expect(result.observation.documentRevision).toBe(previous.revision + 1)
    expect(result.document).toBe(h.state.document)
  })

  it('rejects an unpainted draft instead of substituting the old saved file', async () => {
    const h = harness()
    h.replace({ draft: { text: '输入法中当前草稿' } }, false)
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('活动草稿尚未绘制')
    expect(h.captureImage).not.toHaveBeenCalled()
  })

  it('rejects an old rendered session even when the project, revision and location match', async () => {
    const h = harness()
    h.replace({ sessionGeneration: h.state.sessionGeneration + 1 }, false)
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('当前会话尚未绘制')
    expect(h.captureImage).not.toHaveBeenCalled()
  })

  it('waits for the actual preview host instead of capturing the authoring view behind its overlay', async () => {
    const h = harness(), overlay = document.createElement('aside')
    overlay.dataset.testid = 'course-preview-overlay'
    document.body.append(overlay)
    vi.spyOn(overlay, 'getBoundingClientRect').mockImplementation(() => h.root.getBoundingClientRect())
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('整课预览正在准备')
    expect(h.captureImage).not.toHaveBeenCalled()
  })

  it('enforces the shared resource limit against encoded content before returning a snapshot', async () => {
    const h = harness()
    h.captureImage.mockResolvedValue({ dataUrl: `data:image/png;base64,${'A'.repeat(MAX_GENERATION_RESOURCE_BYTES)}`,
      capturedAt: Date.now(), width: 700, height: 500 })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('12 MiB 附件容量')
  })

  it('reads local Runtime text from its Owner and refuses to edit through an unfinished composition', async () => {
    const h = harness(), control = document.createElement('input')
    h.root.append(control)
    vi.spyOn(control, 'getBoundingClientRect').mockImplementation(() => h.root.getBoundingClientRect())
    const commit = vi.fn()
    const local = { label: 'Runtime 题干', value: '尚未提交的运行区题干', initialValue: '原题干', composing: true,
      bounds: { x: 0, y: 0, width: 200, height: 50 } }
    const unregister = registerAuthoringObservationDraft(control, { read: () => local, commit })
    disposers.push(unregister)
    const observed = await h.controller.capture({ intent: 'discuss' })
    expect(observed.resourceFiles.find(file => file.role === 'structure')!.content).toContain(local.value)
    expect(commit).not.toHaveBeenCalled()
    await expect(h.controller.capture({ intent: 'edit' })).rejects.toThrow('输入法组合中')
    expect(commit).not.toHaveBeenCalled()
    local.composing = false
    await expect(h.controller.capture({ intent: 'edit' })).rejects.toThrow('尚未由原入口提交')
    expect(commit).toHaveBeenCalledTimes(1)
    commit.mockImplementation(() => { unregister(); control.remove() })
    await expect(h.controller.capture({ intent: 'edit' })).resolves.toMatchObject({ observation: { source: 'authoring' } })
  })

  it('describes a current style preview for discussion but does not silently commit it for editing', async () => {
    const h = harness()
    h.replace({ previewBackgroundColor: { color: '#112233', target: { projectId: h.state.document.id,
      revision: h.state.document.revision, generation: h.state.sessionGeneration, locationId: h.state.locationId,
      stateId: null, owner: 'flow-surface' } } })
    const result = await h.controller.capture({ intent: 'discuss' })
    expect(result.resourceFiles.find(file => file.role === 'structure')!.content).toContain('#112233')
    await expect(h.controller.capture({ intent: 'edit' })).rejects.toThrow('样式预览尚未正式提交')
  })

  it.each(['document', 'session', 'draft', 'selection', 'view', 'asset'] as const)('discards an observation when %s changes during the native capture', async change => {
    const h = harness()
    h.captureImage.mockImplementation(async () => {
      if (change === 'document') h.replace({ document: { ...h.state.document, revision: h.state.document.revision + 1 } })
      if (change === 'session') h.replace({ sessionGeneration: h.state.sessionGeneration + 1 })
      if (change === 'draft') h.replace({ draft: { text: '捕获中继续输入' } })
      if (change === 'selection') h.replace({ selectedIds: [] })
      if (change === 'view') h.root.dispatchEvent(new Event('scroll'))
      if (change === 'asset') h.replace({ assetFiles: { changed: new Uint8Array([1]) } })
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('待同步')
  })

  it('keeps the current frame and gives an asset-id diagnostic when an original image cannot be attached', async () => {
    const h = harness(), project = h.state.document
    const surface = project.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Flow fixture required')
    const bytes = new Uint8Array([11, 22, 33])
    project.assets['image-current'] = { id: 'image-current', filename: 'current.png', mimeType: 'image/png',
      kind: 'image', path: 'assets/current.png', byteLength: bytes.byteLength }
    surface.blocks.push({ id: 'image-block', type: 'media', mediaKind: 'image', assetId: 'image-current', layout: 'content-width' })
    h.replace({ assetFiles: { 'image-current': bytes } })
    const result = await h.controller.capture({ intent: 'discuss' })
    expect(result.resourceFiles.some(file => file.path === 'observation/images/0.png')).toBe(false)
    expect(result.observation.files.some(file => file.fileId === 'current-frame')).toBe(true)
    expect(JSON.parse(result.resourceFiles.find(file => file.role === 'structure')!.content).unavailableOriginalImages)
      .toMatchObject([{ assetId: 'image-current', code: 'image-decode-failed' }])
    expect(JSON.parse(result.resourceFiles.find(file => file.path === 'observation/images/original-image-diagnostics.json')!.content))
      .toMatchObject({ unavailableOriginalImages: [{ assetId: 'image-current', code: 'image-decode-failed' }] })
    h.replace({ assetFiles: {} })
    const missing = await h.controller.capture({ intent: 'discuss' })
    expect(missing.observation.files.some(file => file.fileId === 'current-frame')).toBe(true)
    expect(JSON.parse(missing.resourceFiles.find(file => file.role === 'structure')!.content).unavailableOriginalImages)
      .toMatchObject([{ assetId: 'image-current', code: 'image-bytes-missing' }])
  })

  it('omits an optional SVG-derived image before it can displace mandatory motion evidence from the same capture', async () => {
    const original = Uint8Array.from([60, 115, 118, 103, 47, 62])
    const derived = new Uint8Array(800_000).fill(7)
    const h = harness({ prepareImageResources: vi.fn(async () => ({
      originalImages: [{ assetId: 'vector', fileId: 'original-image-0', relativePath: 'observation/original-images/0.svg',
        mediaType: 'image/svg+xml', attachmentRole: 'structure' as const, bytes: original }],
      derivedImages: [{ assetId: 'vector', fileId: 'derived-image-0', relativePath: 'observation/images/0.png',
        mediaType: 'image/png' as const, derivedFrom: 'original-image-0', bytes: derived }],
      unavailableOriginalImages: [], unavailableDerivedImages: [],
    })) })
    const surface = h.state.document.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('Flow fixture required')
    surface.blocks.push({ id: 'budget-component', type: 'component', component: { packageId: 'component.budget', version: '4.0.0' },
      props: {}, staticFallbackAssetId: 'budget-component-fallback' })
    const largePng = 'A'.repeat(4_000_000)
    h.captureImage.mockImplementation(async () => ({
      dataUrl: `data:image/png;base64,${largePng}`, capturedAt: Date.now(), width: 700, height: 500,
    }))

    const result = await h.controller.capture({ intent: 'discuss', dynamicTargetIds: ['budget-component'] })
    const structure = JSON.parse(result.resourceFiles.find(file => file.path === 'observation/current-structure.json')!.content)
    const diagnostics = JSON.parse(result.resourceFiles.find(file => file.path === 'observation/images/original-image-diagnostics.json')!.content)

    expect(result.observation.files.map(file => file.fileId)).toEqual(expect.arrayContaining(['current-frame', 'current-motion-1', 'current-motion-2', 'current-host-motion']))
    expect(result.observation.files.some(file => file.fileId === 'derived-image-0')).toBe(false)
    expect(structure).toMatchObject({ derivedImages: [], unavailableDerivedImages: [{ assetId: 'vector', code: 'image-derived-byte-budget-exceeded' }] })
    expect(diagnostics).toMatchObject({ unavailableDerivedImages: [{ assetId: 'vector', code: 'image-derived-byte-budget-exceeded' }] })
    expect(new TextEncoder().encode(result.resourceFiles.map(file => file.content).join('')).byteLength).toBeLessThanOrEqual(MAX_GENERATION_RESOURCE_BYTES)
    expect(h.captureImage).toHaveBeenCalledTimes(3)
  })

  it('binds a real mounted session and advances runtime version only through its actual state Owner', async () => {
    const h = harness(), courseState = new CourseStateStore()
    const unregister = registerAuthoringObservationHost({ root: h.root, source: 'trial', read: () => ({
      projectId: h.state.document.id, documentRevision: h.state.document.revision, surfaceId: h.state.surfaceId,
      locationId: h.state.locationId, stateId: null, ready: true, stateVersion: courseState.version,
      publicState: courseState.snapshot(),
    }) })
    disposers.push(unregister)
    courseState.set('answer', 42)
    const first = await h.controller.capture({ intent: 'discuss' })
    h.root.dispatchEvent(new Event('input', { bubbles: true }))
    const viewOnly = await h.controller.capture({ intent: 'discuss' })
    expect(viewOnly.observation.runtime).toEqual(first.observation.runtime)
    expect(viewOnly.observation.viewEpoch).toBeGreaterThan(first.observation.viewEpoch)
    courseState.set('answer', 43)
    const latest = await h.controller.capture({ intent: 'discuss' })
    expect(latest.observation.runtime!.stateVersion).toBeGreaterThan(first.observation.runtime!.stateVersion)
    expect(latest.resourceFiles.find(file => file.role === 'runtime-evidence')!.content).toContain('43')
    expect(latest.resourceFiles.find(file => file.role === 'runtime-evidence')!.content).toContain('not-exposed')
    expect(JSON.parse(latest.resourceFiles.find(file => file.path === 'observation/runtime-state.json')!.content).domControls)
      .toMatchObject({ clickPerformed: false, functionalResult: 'not-tested', instances: [] })
    h.captureImage.mockImplementation(async () => {
      courseState.set('answer', 44)
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 500 }
    })
    await expect(h.controller.capture({ intent: 'discuss' })).rejects.toThrow('运行状态已变化')
  })

  it('rejects invented task identity and malformed image references in Renderer input', async () => {
    const h = harness(), { observation } = await h.controller.capture({ intent: 'discuss' })
    expect(authoringObservationInputSchema.safeParse({ ...observation, taskId: crypto.randomUUID() }).success).toBe(false)
    expect(authoringObservationInputSchema.safeParse({ ...observation, files: [] }).success).toBe(false)
    expect(authoringObservationInputSchema.safeParse({ ...observation, files: [{ ...observation.files[0], relativePath: '../old.png' }] }).success).toBe(false)
  })
})
