import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createTextComponentData, formatTextComponentRange, textComponentDataSchema } from '../../src/components/text/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { resolveComponentBackground, resolveComponentPresentation } from '../../src/shared/contracts/component-platform'
import { projectWithBackgroundPreview, type BackgroundPreview } from '../../src/renderer/authoring/backgroundPreview'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { coursePresentationEdits } from '../../src/core/tools/coursePresentationEdits'

const store = () => useEditorStore.getState()
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })
function fixture(): CourseProjectV10 {
  const data = createTextComponentData({ inlines: [{ type: 'text', text: '重点', style: { emphasis: false, highlightColor: null } }, { type: 'text', text: '内容' }] })
  data.appearance.highlightColor = '#ffee00'; data.sizing.mode = 'fixed'
  return { schemaVersion: 10, id: 'native-presentation', revision: 0, title: '文字与背景', assets: {},
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [SHAPE_DEFINITION.id]: SHAPE_DEFINITION },
    instances: {
      text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)), frame: { width: 300, height: 90, transform: [1, 0, 0, 1, 100, 80] } },
      neighbor: { id: 'neighbor', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(), frame: { width: 160, height: 120, transform: [1, 0, 0, 1, 480, 80] } },
    }, global: { underlay: [], overlay: [] }, background: { color: '#123456' },
    surfaces: [{ id: 'slide', kind: 'slide', title: '演示', childIds: ['text', 'neighbor'], designSize: { width: 960, height: 640 },
      background: { mode: 'own', color: '#abcdef' }, presentation: { states: [{ id: 'named', title: '强调', overrides: {} }] } },
      { id: 'flow', kind: 'flow', title: '讲义', childIds: [], background: { mode: 'inherit', color: '#112233' } },
      { id: 'world', kind: 'spatial', title: '空间', childIds: [], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }],
  }
}
async function host(project = fixture()) {
  const h = await createCourseDocumentHost()
  await store().connectCourseDocuments(h.api)
  await store().createCourseDocumentFrom(project)
  store().setEditingScope('scene')
  const documentId = store().courseView.activeDocumentId!, session = h.registry.get(documentId)
  return { ...h, documentId, session }
}

it('previews the exact background/native owner without author writes and refuses another document, epoch, page or state', async () => {
  const h = await host(), project = store().courseView.project!, original = h.session.read(), target = store().courseKernel.captureTarget()
  const preview: BackgroundPreview = { target: { documentId: target.documentId, epoch: target.epoch, surfaceId: 'slide', stateId: null, owner: 'surface' },
    edits: [{ type: 'surface.background.set', surfaceId: 'slide', background: { mode: 'own', color: '#ff0000' } }] }
  const painted = projectWithBackgroundPreview(project, preview, target.documentId, 'slide', null, target.epoch)
  expect(resolveComponentBackground(painted, painted.surfaces[0]).color).toBe('#ff0000')
  expect(resolveComponentBackground(project, project.surfaces[0]).color).toBe('#abcdef')
  for (const args of [['other', 'slide', null, target.epoch], [target.documentId, 'slide', null, 'other'],
    [target.documentId, 'world', null, target.epoch], [target.documentId, 'slide', 'named', target.epoch]] as const)
    expect(projectWithBackgroundPreview(project, preview, args[0], args[1], args[2], args[3])).toBe(project)
  const native: BackgroundPreview = { target: { ...preview.target, owner: 'instance', instanceId: 'text' },
    edits: [{ type: 'data.set', instanceId: 'text', path: ['appearance', 'color'], value: '#ff0000' }] }
  const nativePainted = projectWithBackgroundPreview(project, native, target.documentId, 'slide', null, target.epoch)
  expect(textComponentDataSchema.parse(nativePainted.instances.text.data).appearance.color).toBe('#ff0000')
  expect(textComponentDataSchema.parse(project.instances.text.data).appearance.color).toBe('#000000')
  expect(h.session.read()).toEqual(original)
})

it('writes named-state emphasis and nullable highlighting from the actual property controls and preserves base/inline semantics through save, Published and Undo', async () => {
  const h = await host(), original = store().courseView.project!, base = textComponentDataSchema.parse(original.instances.text.data)
  act(() => { store().courseBridge.selectPresentationState(h.documentId, 'named'); store().selectNode('text') })
  render(<PropertiesTab onReplaceImage={() => {}} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消高亮' })); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(1)
  await act(async () => { fireEvent.click(screen.getByLabelText('文字着重号')); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(2)
  const changed = h.session.read()
  if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
  const authored = changed.model.project
  expect(textComponentDataSchema.parse(authored.instances.text.data)).toEqual(base)
  const effective = resolveComponentPresentation(authored, 'slide', 'named')
  const data = textComponentDataSchema.parse(effective.instances.text.data)
  expect(data.appearance).toMatchObject({ emphasis: true, highlightColor: null })
  expect(data.content.inlines[0]).toMatchObject({ style: { emphasis: false, highlightColor: null } })
  expect(authored.instances.text.frame).toEqual(original.instances.text.frame)
  expect(authored.instances.neighbor).toEqual(original.instances.neighbor)
  const reopened = h.driver.load(h.driver.serialize(changed.model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project).toEqual(authored)
  const { payload, diagnostics } = await buildPublishedCourseV3({ project: reopened.project, assetBytes: {} })
  expect(diagnostics).toEqual([])
  expect(payload.instances.text.data).toEqual(authored.instances.text.data)
  expect(payload.surfaces[0].presentation).toEqual(authored.surfaces[0].presentation)
  await act(async () => { await store().courseBridge.undo(h.documentId); await store().courseBridge.undo(h.documentId) })
  expect(store().courseView.project!.instances).toEqual(original.instances)
  expect(store().courseView.project!.surfaces[0].presentation).toEqual(original.surfaces[0].presentation)
  // Local formatting preserves explicit false values and rich atoms rather than flattening them.
  const formatted = formatTextComponentRange(base, 2, 4, { emphasis: true })
  expect(formatted.content.inlines[0]).toEqual(base.content.inlines[0])
  expect(formatted.content.inlines[1]).toMatchObject({ text: '内容', style: { emphasis: true } })
})

it('retains dormant Flow/Spatial colors, clears a named-state override, and restores each captured background transaction once', async () => {
  const h = await host(), project = store().courseView.project!
  expect(resolveComponentBackground(project, project.surfaces[1]).color).toBe('#123456')
  expect(resolveComponentBackground(project, project.surfaces[2]).color).toBe('#123456')
  await act(async () => { await store().editComponents([
    { type: 'surface.background.set', surfaceId: 'flow', background: { ...project.surfaces[1].background, mode: 'own' } },
    { type: 'surface.background.set', surfaceId: 'world', background: { mode: 'own', color: '#654321' } },
    ...coursePresentationEdits(project, { kind: 'course-surface', surfaceId: 'slide' }, { action: 'background', state: 'named', background: { color: '#ccbb00', assetId: null } }),
  ]) })
  expect(h.session.read().undoDepth).toBe(1)
  let changed = store().courseView.project!
  expect(resolveComponentBackground(changed, changed.surfaces[1]).color).toBe('#112233')
  expect(resolveComponentBackground(changed, changed.surfaces[2]).color).toBe('#654321')
  expect(resolveComponentBackground(changed, changed.surfaces[0], changed.surfaces[0].presentation!.states[0])).toMatchObject({ color: '#ccbb00', assetId: null })
  await act(async () => { await store().editComponents(coursePresentationEdits(changed, { kind: 'course-surface', surfaceId: 'slide' },
    { action: 'background', state: 'named', background: {}, inherit: ['color', 'assetId'] })) })
  changed = store().courseView.project!
  expect(resolveComponentBackground(changed, changed.surfaces[0], changed.surfaces[0].presentation!.states[0]).color).toBe('#abcdef')
  expect(h.session.read().undoDepth).toBe(2)
  await act(async () => { await store().courseBridge.undo(h.documentId); await store().courseBridge.undo(h.documentId) })
  expect(store().courseView.project!.surfaces).toEqual(project.surfaces)
})

it('commits the original shape opacity gesture once while keeping neighboring text and its authored frame intact', async () => {
  const h = await host(), original = store().courseView.project!
  act(() => { store().selectNode('neighbor') })
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const slider = screen.getByRole('slider', { name: '填充透明度' })
  fireEvent.change(slider, { target: { value: '65' } }); fireEvent.change(slider, { target: { value: '35' } })
  expect(h.session.read().undoDepth).toBe(0)
  await act(async () => { fireEvent.pointerUp(slider); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(1)
  expect(store().courseView.project!.instances.neighbor.data).toMatchObject({ style: { fillOpacity: .65 } })
  expect(store().courseView.project!.instances.neighbor.frame).toEqual(original.instances.neighbor.frame)
  expect(store().courseView.project!.instances.text).toEqual(original.instances.text)
  await act(async () => { await store().courseBridge.undo(h.documentId) })
  expect(store().courseView.project!.instances).toEqual(original.instances)
})

it('keeps custom fonts editable, filters without erasing the saved choice, and exposes both vertical directions on the original text properties', async () => {
  const project = fixture(), data = textComponentDataSchema.parse(project.instances.text.data)
  data.appearance.fontFamily = 'Custom Course Font, sans-serif'
  project.instances.text.data = JSON.parse(JSON.stringify(data))
  const h = await host(project)
  act(() => { store().selectNode('text') })
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const font = screen.getByRole('combobox', { name: '字体' })
  expect(font).toHaveValue('Custom Course Font, sans-serif')
  fireEvent.focus(font)
  expect(screen.getByRole('listbox', { name: '常用字体' })).toBeInTheDocument()
  expect(font).toHaveValue('Custom Course Font, sans-serif')
  fireEvent.change(font, { target: { value: 'Kai' } })
  expect(screen.getByRole('option', { name: /楷体，KaiTi，/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Arial，Arial，/ })).toBeNull()
  fireEvent.change(font, { target: { value: 'My New Course Font' } })
  await act(async () => { fireEvent.blur(font); await store().courseBridge.drain() })
  expect(h.session.read().undoDepth).toBe(1)
  expect(textComponentDataSchema.parse(store().courseView.project!.instances.text.data).appearance.fontFamily).toBe('My New Course Font')
  const direction = screen.getByRole('combobox', { name: '文字方向' })
  expect(screen.getByRole('option', { name: '竖排（列从右向左）' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: '竖排（列从左向右）' })).toBeInTheDocument()
  await act(async () => { fireEvent.change(direction, { target: { value: 'vertical-lr' } }); await store().courseBridge.drain() })
  expect(textComponentDataSchema.parse(store().courseView.project!.instances.text.data).appearance.writingMode).toBe('vertical-lr')
  expect(screen.getByRole('spinbutton', { name: '高' })).not.toBeDisabled()
  expect(store().courseView.project!.instances.text.frame).toEqual(project.instances.text.frame)
  expect(store().courseView.project!.instances.neighbor).toEqual(project.instances.neighbor)
})
