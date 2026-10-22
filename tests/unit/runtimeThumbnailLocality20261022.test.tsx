import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { defaultShapeData } from '../../src/components/shape/data'
import { createImageData } from '../../src/components/image/data'
import { createTextComponentData } from '../../src/components/text/data'
import * as textRender from '../../src/components/text/render'
import { renderShape } from '../../src/components/shape/render'
import { renderImageNodeCanvas } from '../../src/shared/imageEffects'
import { SceneThumbnail } from '../../src/renderer/ui/SceneThumbnail'
import { setRootContainers } from '../helpers/glxWorkFixture'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const store = vi.hoisted(() => ({ current: {} as unknown }))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: (select: (state: unknown) => unknown) => select(store.current),
}))
vi.mock('../../src/components/shape/render', () => ({ renderShape: vi.fn() }))
vi.mock('../../src/shared/imageEffects', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/shared/imageEffects')>()
  return { ...actual, renderImageNodeCanvas: vi.fn(actual.renderImageNodeCanvas) }
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function fixture() {
  const project = createBlankCourseProjectV10('thumbnail locality')
  project.definitions.shape = { id: 'shape', role: 'content', implementation: { kind: 'builtin', key: 'guoling.shape' } }
  project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
  project.instances.shape = { id: 'shape', definitionId: 'shape', data: JSON.parse(JSON.stringify(defaultShapeData())),
    frame: { width: 640, height: 360, transform: [2, 0, 0, 2, 0, 0] } }
  project.instances.image = { id: 'image', definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData('a'))),
    frame: { width: 640, height: 360, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances.hiddenImage = { ...project.instances.image, id: 'hiddenImage', visible: false,
    data: JSON.parse(JSON.stringify(createImageData('other'))) }
  project.instances.other = { ...project.instances.shape, id: 'other' }
  setRootContainers(project, [{ id: 'first', title: 'First', kind: 'slide', designSize: { width: 1280, height: 720 }, childIds: ['shape', 'image', 'hiddenImage'] },
    { id: 'second', title: 'Second', kind: 'slide', childIds: ['other'] }])
  project.assets = Object.fromEntries(['a', 'b', 'other'].map(id => [id, { id, path: `assets/${id}.png`, mimeType: 'image/png' }]))
  const assets = { a: new Uint8Array([1]), b: new Uint8Array([2]), other: new Uint8Array([3]) }
  return { project, assets }
}
function publish(project: CourseProjectV10, assets: Record<string, Uint8Array>) {
  store.current = { courseView: { project, surfaceId: 'first', activeDocumentId: 'doc',
    views: [{ documentId: 'doc', model: { resources: { assets, components: {} } } }] } }
}
function browser() {
  let notify: (visible: boolean) => void = () => {}
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { notify = visible => this.callback([{ target, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
    disconnect() {} unobserve() {}
  })
  vi.stubGlobal('ResizeObserver', undefined)
  const context = { scale: vi.fn(), save() {}, restore() {}, translate() {}, drawImage() {} } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
  vi.stubGlobal('Image', class {
    naturalWidth = 2000; naturalHeight = 1000; onload: (() => void) | null = null
    set src(_value: string) { this.onload?.() }
  })
  let sequence = 0
  const createObjectURL = vi.fn(() => `blob:thumbnail-${++sequence}`), revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  return { visible: (value: boolean) => act(() => notify(value)), createObjectURL, revokeObjectURL }
}

it('reuses an unchanged page through unrelated edits and resumes the current page after leaving and reentering view', () => {
  let { project, assets } = fixture()
  publish(project, assets)
  const h = browser(), mounted = render(<SceneThumbnail locationId="first" />)
  expect(renderShape).not.toHaveBeenCalled(); expect(h.createObjectURL).not.toHaveBeenCalled()
  h.visible(true)
  const page = mounted.container.querySelector('.scene-thumbnail > div')
  expect(page).not.toBeNull(); expect(h.createObjectURL).toHaveBeenCalledTimes(1)
  const paints = vi.mocked(renderShape).mock.calls.length

  project = { ...project, revision: project.revision + 1, instances: { ...project.instances,
    other: { ...project.instances.other, name: 'unrelated edit' } } }
  assets = { ...assets, other: new Uint8Array([9]) }
  publish(project, assets); mounted.rerender(<SceneThumbnail locationId="first" />)
  expect(mounted.container.querySelector('.scene-thumbnail > div')).toBe(page)
  expect(renderShape).toHaveBeenCalledTimes(paints); expect(h.createObjectURL).toHaveBeenCalledTimes(1)

  project = { ...project, instances: { ...project.instances, first: { ...project.instances.first,
    container: { ...project.instances.first.container!, presentation: { thumbnailStateId: 'preview', initialStateId: null,
      states: [{ id: 'preview', title: 'Preview', overrides: { image: { data: JSON.parse(JSON.stringify(createImageData('b'))) } } }] } } } } }
  publish(project, assets); mounted.rerender(<SceneThumbnail locationId="first" />)
  expect(mounted.container.querySelector('.scene-thumbnail > div')).not.toBe(page)
  expect(h.createObjectURL).toHaveBeenCalledTimes(2)
  expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-1')

  h.visible(false)
  expect(mounted.container.querySelector('.scene-thumbnail > div')).toBeNull()
  const hiddenPaints = vi.mocked(renderShape).mock.calls.length
  project = { ...project, instances: { ...project.instances, shape: { ...project.instances.shape,
    data: JSON.parse(JSON.stringify(defaultShapeData('ellipse'))) } } }
  publish(project, assets); mounted.rerender(<SceneThumbnail locationId="first" />)
  expect(renderShape).toHaveBeenCalledTimes(hiddenPaints)
  h.visible(true)
  expect(vi.mocked(renderShape).mock.calls.at(-1)?.[1].shapeType).toBe('ellipse')
  expect(mounted.container.querySelector('iframe')).toBeNull()
})

it('keeps design layout and passes thumbnail pixels and DPR to shape and image painting', () => {
  const { project, assets } = fixture()
  publish(project, assets)
  const h = browser()
  vi.stubGlobal('devicePixelRatio', 2)
  const mounted = render(<SceneThumbnail locationId="first" />)
  h.visible(true)
  const page = mounted.container.querySelector('.scene-thumbnail > div') as HTMLElement
  expect(page.style.width).toBe('1280px'); expect(page.style.height).toBe('720px')
  const shape = page.querySelector('canvas')!
  expect(shape.width).toBe(320); expect(shape.height).toBe(180)
  expect(vi.mocked(renderShape).mock.calls.at(-1)?.[2]).toEqual({ width: 640, height: 360 })
  expect(vi.mocked(renderImageNodeCanvas).mock.calls.at(-1)?.slice(4)).toEqual([640, 360, .25])
  // Canvas/context and Image are controlled; this proves sizing inputs, not visual equivalence.
})

it('shows text immediately and measures only when its actual document fonts are ready', async () => {
  const { project, assets } = fixture()
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.text = { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('字体准备后的量度'))),
    frame: { width: 120, height: 40, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances.first.childIds = ['text']
  publish(project, assets)
  const h = browser(), measure = vi.spyOn(textRender, 'measureTextComponent').mockReturnValue({ width: 120, height: 60, scale: 1, overflows: false })
  let ready = false, resolve!: () => void
  const pending = new Promise<void>(done => { resolve = done })
  const previous = Object.getOwnPropertyDescriptor(document, 'fonts'), load = vi.fn(() => pending)
  Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => ready, load } })
  try {
    const mounted = render(<SceneThumbnail locationId="first" />)
    h.visible(true)
    expect(mounted.container.textContent).toContain('字体准备后的量度')
    expect(load).toHaveBeenCalled(); expect(measure).not.toHaveBeenCalled()
    await act(async () => { ready = true; resolve(); await pending })
    expect(measure).toHaveBeenCalledTimes(1)
    expect((mounted.container.querySelector('[data-text-component]') as HTMLElement).style.height).toBe('60px')
  } finally {
    measure.mockRestore()
    if (previous) Object.defineProperty(document, 'fonts', previous)
    else Reflect.deleteProperty(document, 'fonts')
  }
})
