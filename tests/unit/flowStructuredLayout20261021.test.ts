import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { resolveComponentOuterPresentation } from '../../src/shared/componentPresentation'
import { componentLayoutInput } from '../../src/components/web/measuredFragmentBox'
import { createTextComponentData } from '../../src/components/text/data'
import { InstanceView } from '../../src/renderer/documents/CourseV10DocumentView'
import { createComponentModelProjection } from '../../src/player/componentPlatform/modelProjection'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'structured-flow', revision: 0, title: 'Structured Flow', rootIds: ['flow'], entry: { rootInstanceId: 'flow' },
    global: { underlay: [], overlay: [] }, assets: {},
    definitions: Object.fromEntries(['group', 'text', 'image', 'container.flow'].map(key => [key, { id: key, role: 'content', implementation: { kind: 'builtin', key: 'guoling.' + key } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['spread'], container: { kind: 'flow',
        flow: { layout: { widthMode: 'fluid', readingWidth: 900, wideContentWidth: 1280, toc: 'hidden' } } } },
      spread: { id: 'spread', definitionId: 'group', data: {}, childIds: ['text', 'image'],
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: '32px', maxWidth: '1280px', margin: '0 auto', padding: '24px', backgroundColor: '#eeece2' } },
      text: { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('A native paragraph grows when edited.'))),
        style: { alignSelf: 'center', margin: '0', minWidth: '0' } },
      image: { id: 'image', definitionId: 'image', data: {}, frame: { width: 500, height: 700, transform: [1, 0, 0, 1, 0, 0] } },
    },
  }
}
describe('native Flow composition using existing component identity and CSS', () => {
  it('lets explicit unframed groups reflow while a framed image retains its own crop space', () => {
    const project = fixture(), group = project.instances.spread
    const presentation = resolveComponentOuterPresentation(project, group, { placement: 'flow', purpose: 'author', inlineSize: 900 })
    expect(componentLayoutInput(group, { project, definition: project.definitions.group, kind: 'flow', inlineSize: 900 }).mode).toBe('flow-content')
    expect(presentation.childrenPlacement).toBe('flow')
    expect(presentation.stageStyle.height).toBe('auto')
    expect(presentation.childrenStyle).toMatchObject({ display: 'grid', gridTemplateColumns: group.style!.gridTemplateColumns, gap: '32px', position: 'relative', height: 'auto' })
    expect(presentation.outerStyle).toMatchObject({ display: 'flex', flexDirection: 'column', maxWidth: '1280px', margin: '0 auto' })
    const image = resolveComponentOuterPresentation(project, project.instances.image, { placement: 'flow', purpose: 'playback', inlineSize: 250 })
    expect(image.outerStyle.width).toBe('100%')
    expect(image.outerStyle.margin).toBe('0px')
    expect(image.stageStyle.height).toBe('350px')
    const text = resolveComponentOuterPresentation(project, project.instances.text, { placement: 'flow', purpose: 'author', inlineSize: 250 })
    expect(text.outerStyle.alignSelf).toBe('center')
    expect(text.layoutInput.mode).toBe('flow-content')
    expect(project.instances.image.frame!.width).toBe(500)
  })
  it('keeps framed groups in free composition, even when their source paint included grid', () => {
    const project = fixture()
    project.instances.spread.frame = { width: 1120, height: 850, transform: [1, 0, 0, 1, 0, 0] }
    const view = resolveComponentOuterPresentation(project, project.instances.spread, { placement: 'flow', purpose: 'playback', inlineSize: 560 })
    expect(view.childrenPlacement).toBe('free')
    expect(view.localAssembly).toBe(true)
    expect(view.stageStyle.height).toBe('425px')
  })
  it('uses the same real child layout in React, ModelPlayer and compiled markup', async () => {
    const project = fixture(), react = render(createElement(InstanceView, { instance: project.instances.spread, project, surfaceId: 'flow', selectedInstanceId: null, onSelect() {}, placement: 'flow' }))
    const root = document.createElement('div'); document.body.append(root)
    Object.defineProperties(root, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } })
    const runtime = { bind: vi.fn(), bindTarget: vi.fn(), assetUrl: vi.fn() } as unknown as ComponentPlatformRuntime
    const projection = createComponentModelProjection({ root, runtime, signal: new AbortController().signal })
    try {
      projection.sync({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
      const reactItem = react.container.querySelector<HTMLElement>('[data-component-instance="text"]')!
      const modelItem = root.querySelector<HTMLElement>('[data-component-object="text"]')!
      expect(reactItem.parentElement!.style.display).toBe('grid')
      expect(modelItem.parentElement!.style.display).toBe('grid')
      expect(reactItem.style.position).toBe('relative')
      const { revision: _revision, ...published } = project
      const artifact = await compileCoursePlayback({ ...published, schemaVersion: 4 }, { document,
        renderBuiltin: async () => '<p>Native text</p>' })
      const markup = document.createElement('div'); markup.innerHTML = artifact.html
      const compiled = markup.querySelector<HTMLElement>('[data-compiled-node="text"]')!
      expect(compiled.parentElement!.style.display).toBe('grid')
      expect(compiled.style.position).toBe('relative')
      expect(project.instances.text.frame).toBeUndefined()
    } finally { projection.dispose(); react.unmount(); root.remove() }
  })
})

import { componentFileContentSource } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { readFlowReading, scrollFlowTarget } from '../../src/shared/flowReading'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances } from '../../src/shared/teacherControllerViewportGeometry'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { flowPaperPadding, flowScrollPadding, resolveFlowBodyWidth } from '../../src/shared/flowBodyPresentation'

it('retires removed grid/item declarations on retained ModelPlayer nodes and restores fixed composition', () => {
  const project = fixture(), root = document.createElement('div'); document.body.append(root)
  const runtime = { bind: vi.fn(), bindTarget: vi.fn(), assetUrl: vi.fn() } as unknown as ComponentPlatformRuntime
  const projection = createComponentModelProjection({ root, runtime, signal: new AbortController().signal })
  const sync = (project: CourseProjectV10) => projection.sync({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  try {
    sync(project)
    const text = root.querySelector<HTMLElement>('[data-component-object="text"]')!, children = text.parentElement!
    expect(children.style.gap).toBe('32px')
    const changed = structuredClone(project)
    changed.instances.spread.style = { display: 'flex', flexDirection: 'column' }
    changed.instances.text.style = {}
    sync(changed)
    expect(root.querySelector('[data-component-object="text"]')).toBe(text)
    expect(children.style.gridTemplateColumns).toBe('')
    expect(children.style.gap).toBe('')
    expect(text.style.alignSelf).toBe('')
    sync(project)
    expect(children.style.gap).toBe('32px')
    expect(children.style.flexDirection).toBe('')
    const fixed = structuredClone(project)
    fixed.instances.spread.frame = { width: 1120, height: 850, transform: [1, 0, 0, 1, 0, 0] }
    sync(fixed)
    expect(children.style.position).toBe('absolute')
    expect(children.style.flex).toBe('')
    expect(children.parentElement!.style.flex).toBe('')
    expect(children.parentElement!.style.flexDirection).toBe('')
    expect(children.style.gridTemplateColumns).toBe('')
    expect(children.style.gap).toBe('')
    expect(text.style.alignSelf).toBe('')
  } finally { projection.dispose(); root.remove() }
})

it('admits existing object drafts through project files and preserves identities on incremental layout edits', () => {
  const project = fixture(), resources = { assets: {}, components: {} }
  const file = componentProjectFiles(project, resources).find(file => file.kind === 'structure'
    && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'flow')!
  expect(file).toBeTruthy()
  const content = JSON.stringify({ kind: 'objects', objects: [{ definitionId: 'group', name: 'Editorial spread', data: {},
    style: { display: 'grid', gridTemplateColumns: '1fr 1fr', maxWidth: '1100px', margin: '0 auto', gap: '24px' },
    children: [{ definitionId: 'text', name: 'Editable text', data: project.instances.text.data, style: { alignSelf: 'center' } },
      { definitionId: 'image', data: {}, frame: project.instances.image.frame }] }] })
  let sequence = 0
  const plan = planContentApply({ project, createId: () => 'created-' + ++sequence,
    request: { intent: 'insert', target: { kind: 'container', container: { kind: 'instance', instanceId: 'flow' } },
      source: componentFileContentSource(file, content) } })
  const inserted = applyComponentOperation(project, plan.command, resources)
  const group = Object.values(inserted.instances).find(instance => instance.name === 'Editorial spread')!
  expect(group.frame).toBeUndefined()
  expect(group.style).toMatchObject({ 'grid-template-columns': '1fr 1fr', 'max-width': '1100px', margin: '0 auto' })
  expect(group.childIds).toHaveLength(2)
  const text = inserted.instances[group.childIds![0]!]!
  expect(text.style).toMatchObject({ 'align-self': 'center' })
  expect(inserted.instances[group.childIds![1]!]!.frame).toEqual(project.instances.image.frame)
  expect(inserted.instances.spread).toEqual(project.instances.spread)
  const edit = planContentApply({ project: inserted, createId: () => { throw Error('Incremental style must not allocate identities') },
    request: { intent: 'style', target: { kind: 'instance', instanceId: group.id }, source: { kind: 'style', style: { gridTemplateColumns: '1fr', gap: null } } } })
  const updated = applyComponentOperation(inserted, edit.command, resources)
  expect(updated.instances[group.id]!.style!['grid-template-columns']).toBe('1fr')
  expect(updated.instances[group.id]!.style!.gap).toBeUndefined()
  expect(updated.instances[group.id]!.childIds).toEqual(group.childIds)
  expect(updated.instances[text.id]!.data).toEqual(text.data)
  expect(() => componentFileContentSource(file, JSON.stringify({ kind: 'objects', objects: [{ id: 'model-assigned', definitionId: 'text', data: {} }] }))).toThrow()
})

it('keeps edge-to-edge an explicit saved layout with the same paper rules in compiled output', async () => {
  const project = fixture(), layout = project.instances.flow.container!.flow!.layout
  expect(flowPaperPadding(layout)).toBe('28px 36px 64px')
  expect(resolveFlowBodyWidth(layout, 1000)).toBe(928)
  layout.edgeToEdge = true
  expect(courseProjectV10Schema.parse(project).instances.flow.container!.flow!.layout.edgeToEdge).toBe(true)
  expect(flowPaperPadding(layout)).toBe('0px')
  expect(flowScrollPadding(layout)).toBe('0px')
  expect(resolveFlowBodyWidth(layout, 1000)).toBe(1000)
  const { revision: _revision, ...published } = project
  const artifact = await compileCoursePlayback({ ...published, schemaVersion: 4 }, { document, renderBuiltin: async () => '<p>Text</p>' })
  const markup = document.createElement('div'); markup.innerHTML = artifact.html
  expect(markup.querySelector<HTMLElement>('[data-compiled-flow-paper]')!.style.padding).toBe('0px')
  expect(markup.querySelector<HTMLElement>('[data-flow-paper-scroll]')!.style.padding).toBe('0px')
})

it('reports actual article progress in zoomed coordinates, including a short last chapter and unmeasurable mounts', () => {
  const scroll = document.createElement('div'), body = document.createElement('div'), first = document.createElement('h2'), last = document.createElement('h2')
  body.append(first, last); scroll.append(body); document.body.append(scroll)
  const box = (top: number, width: number, height: number) => ({ x: 0, y: top, top, left: 0, right: width, bottom: top + height, width, height, toJSON() {} })
  Object.defineProperties(scroll, { clientHeight: { value: 400 }, clientTop: { value: 0 } })
  Object.defineProperty(body, 'offsetWidth', { value: 600, configurable: true })
  scroll.getBoundingClientRect = () => box(20, 1200, 800)
  body.getBoundingClientRect = () => box(20 - scroll.scrollTop * 2, 1200, 3000)
  first.getBoundingClientRect = () => box(20 - scroll.scrollTop * 2, 1200, 80)
  last.getBoundingClientRect = () => box(20 + (1200 - scroll.scrollTop) * 2, 1200, 80)
  last.style.scrollMarginTop = '40px'
  const targets = [{ id: 'first', element: first }, { id: 'last', element: last }]
  try {
    expect(readFlowReading(scroll, body, targets)).toEqual({ activeInstanceId: 'first', progress: 0 })
    scroll.scrollTop = 550
    expect(readFlowReading(scroll, body, targets)).toEqual({ activeInstanceId: 'first', progress: .5 })
    scroll.scrollTop = 1100
    expect(readFlowReading(scroll, body, targets)).toEqual({ activeInstanceId: 'last', progress: 1 })
    scroll.scrollTop = 0
    expect(scrollFlowTarget(scroll, body, last)).toBe(true)
    expect(scroll.scrollTop).toBe(1160)
    Object.defineProperty(body, 'offsetWidth', { value: 0 })
    expect(readFlowReading(scroll, body, targets)).toBeNull()
    expect(scrollFlowTarget(scroll, body, last)).toBe(false)
  } finally { scroll.remove() }
})

it('reads current container observations without storing author state and stretches only an explicitly full-width HUD', () => {
  const project = fixture()
  project.instances.nav = { id: 'nav', definitionId: 'group', data: {}, viewportPinned: true,
    frame: { width: 1280, height: 48, transform: [1, 0, 0, 1, 0, 0] }, style: { width: '100%' } }
  project.global.overlay.push('nav')
  const before = structuredClone(project), navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', select: () => true })
  let position = { activeInstanceId: 'first', progress: .1 }
  const off = navigation.registerObservation('flow', { readZoom: () => 1, setZoom() {}, reset() {}, readReading: () => position })
  expect(navigation.forInstance('nav').read().reading).toEqual({ containerId: 'flow', ...position })
  position = { activeInstanceId: 'last', progress: 1 }
  expect(navigation.read().reading).toEqual({ containerId: 'flow', ...position })
  const hud = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 },
    viewportRect: { x: 0, y: 0, width: 390, height: 844 }, controllerInsets: { right: 30, bottom: 0 } })
  const display = projectTeacherControllerInstances(project, hud, navigation)
  expect(display.instances.nav.frame).toEqual({ width: 360, height: 48, transform: [1, 0, 0, 1, 0, 0] })
  expect(project).toEqual(before)
  off()
  expect(navigation.read().reading).toBeUndefined()
  navigation.dispose()
})
