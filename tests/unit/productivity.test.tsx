import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createChartNode, createImageNode, createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { createProductivityPreview, applyProductivityPreview, type ProductivityContext } from '../../src/renderer/authoring/productivity'
import { cloneReferencePage } from '../../src/renderer/authoring/productivity/referenceClone'
import { previewStyleRemix, applyStyleRemix } from '../../src/renderer/authoring/productivity/styleRemix'
import { applyEditorTransactionStep } from '../../src/renderer/authoring/editorTransaction'
import { ProductivityDialog } from '../../src/renderer/ui/productivity/ProductivityDialog'
import { collectCourseProjectHealth } from '../../src/shared/courseProjectHealth'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

function fixture() {
  const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('expected slide')
  const scene = surface.scenes[0]!
  const text = createTextNode()
  text.text = '旧甲旧乙'; text.runs = [{ start: 1, end: 2, style: { bold: true } }, { start: 3, end: 4, style: { italic: true } }]
  scene.layerItems.push(sceneNodeToCourseLayerItem(text, 1))
  const context: ProductivityContext = { document, sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 } }
  return { context, scene, surface }
}
describe('design productivity canonical previews', () => {
  it('replaces across formatted Flow text boundaries in every math-separated segment without changing math identities', () => {
    const document = createBlankFlowCourseProject()
    const surface = document.surfaces[0]!
    if (surface.type !== 'flow') throw new Error('expected flow')
    const mathA = { type: 'math' as const, formulaId: 'math-a', latex: 'x^{2}', accessibleText: 'x平方' }
    const mathB = { type: 'math' as const, formulaId: 'math-b', latex: '\\frac{1}{2}', accessibleText: '二分之一' }
    surface.blocks.push({ id: 'mixed-body', type: 'paragraph', content: { inlines: [
      { type: 'text', text: '旧', style: { bold: true } }, { type: 'text', text: '文', style: { italic: true } }, mathA,
      { type: 'text', text: '旧', style: { color: '#123456' } }, { type: 'text', text: '文', style: { underline: true } }, mathB,
      { type: 'text', text: '旧文', style: { fontSize: 24 } },
    ] } })
    const context: ProductivityContext = { document, sessionToken: { locationId: document.startLocationId, surfaceType: 'flow', revision: document.revision, generation: 1 } }
    const preview = createProductivityPreview(context, { kind: 'text', scope: 'course', find: '旧文', replacement: '新😀' })
    expect(preview.items).toHaveLength(3)
    const result = applyProductivityPreview(context, preview, preview.items.map(item => item.id))
    if (!result.ok || !result.step) throw new Error('expected one transaction')
    const next = result.step.nextDocument.surfaces[0]!
    if (next.type !== 'flow') throw new Error('expected flow')
    const block = next.blocks.find(item => item.id === 'mixed-body')!
    if (block.type !== 'paragraph') throw new Error('expected paragraph')
    expect(block.content.inlines.filter(inline => inline.type === 'math')).toEqual([mathA, mathB])
    const text = block.content.inlines.filter(inline => inline.type === 'text')
    expect(text.map(inline => inline.text).join('')).toBe('新😀新😀新😀')
    const grouped: { text: string; style: unknown }[] = []
    for (const inline of text) {
      const previous = grouped.at(-1)
      if (previous && JSON.stringify(previous.style) === JSON.stringify(inline.style)) previous.text += inline.text
      else grouped.push({ text: inline.text, style: inline.style })
    }
    expect(grouped).toEqual([{ text: '新😀', style: { bold: true } }, { text: '新😀', style: { color: '#123456' } }, { text: '新😀', style: { fontSize: 24 } }])
    expect(result.step.nextDocument.revision).toBe(document.revision + 1)
    const initial = { document, resources: { assetFiles: {}, componentPackages: {} } }
    expect(applyEditorTransactionStep(applyEditorTransactionStep(initial, result.step, 'forward'), result.step, 'inverse')).toEqual(initial)
  })
  it('Remix maps explicit slots to independent editable content and one reversible archive transaction', () => {
    const { context, scene } = fixture()
    const id = scene.layerItems[0]!.layerItemId
    const preview = previewStyleRemix(context, scene.id, { [id]: '新课题' })
    expect(preview.issues).toEqual([])
    expect(preview.slots[0]!.issue).toBeUndefined()
    const result = applyStyleRemix(context, preview, {})
    if (!result.ok || !result.step) throw new Error(result.ok ? 'missing step' : result.reason)
    const next = result.step.nextDocument.surfaces[0]!
    if (next.type !== 'slide') throw new Error('slide')
    const original = next.scenes[0]!.layerItems[0]!, copy = next.scenes[1]!.layerItems[0]!
    expect(copy.layerItemId).not.toBe(original.layerItemId)
    if (copy.kind !== 'native' || copy.content.nativeType !== 'text') throw new Error('text')
    expect(copy.content.data.text).toBe('新课题')
    expect(next.scenes[0]).toEqual(scene)
    expect(result.step.nextDocument.revision).toBe(context.document.revision + 1)
    const initial = { document: context.document, resources: { assetFiles: {}, componentPackages: {} } }
    const applied = applyEditorTransactionStep(initial, result.step, 'forward')
    expect(applyEditorTransactionStep(applied, result.step, 'inverse')).toEqual(initial)
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: applied.document, assetFiles: {}, componentFiles: {} }))
    expect(reopened.project).toEqual(applied.document)
  })
  it('Remix missing slots, overflow and stale preview leave the source unchanged', () => {
    const { context, scene } = fixture()
    const before = structuredClone(context.document), id = scene.layerItems[0]!.layerItemId
    for (const replacements of [{}, { [id]: '太长'.repeat(2000) }, { removed: '不存在' }]) {
      const preview = previewStyleRemix(context, scene.id, replacements)
      expect(applyStyleRemix(context, preview, {}).ok).toBe(false)
      expect(context.document).toEqual(before)
    }
    const preview = previewStyleRemix(context, scene.id, { [id]: '新' })
    expect(applyStyleRemix({ ...context, sessionToken: { ...context.sessionToken, generation: 2 } }, preview, {}).ok).toBe(false)
    expect(context.document).toEqual(before)
  })
  it('remaps self navigation but preserves another scene with the same presentation state IDs', () => {
    const { context, scene, surface } = fixture()
    scene.presentation = { initialStateId: 'initial', states: [{ id: 'initial', name: '初始', layerItemOverrides: {} }] }
    const destination = structuredClone(scene)
    destination.id = 'destination'; destination.name = '外部目标'; destination.layerItems = []
    surface.scenes.push(destination)
    context.document.locations.push({ kind: 'slide-scene', id: 'destination-location', surfaceId: surface.id, sceneId: destination.id, label: '外部目标' })
    for (const target of [scene.id, destination.id]) {
      scene.interactions.push({ id: `go-${target}`, enabled: true, trigger: { type: 'node.click', nodeId: scene.layerItems[0]!.layerItemId }, conditions: [], actions: [{ id: `action-${target}`, start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: target, targetStateId: 'initial' } }] })
    }
    const flow = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
    context.document.surfaces.push(...flow.surfaces)
    context.document.locations.push(...flow.locations)
    context.document.mixedPrintPlan = { pageSize: 'A4', orientation: 'auto', entries: [
      { id: 'print-slide', kind: 'slide-scenes', surfaceId: surface.id, sceneIds: surface.scenes.map(value => value.id) },
      { id: 'print-flow', kind: 'flow-document', surfaceId: flow.surfaces[0]!.id },
    ] }
    for (const locationId of [context.document.startLocationId, flow.startLocationId]) {
      scene.interactions.push({ id: `go-location-${locationId}`, enabled: true, trigger: { type: 'node.click', nodeId: scene.layerItems[0]!.layerItemId }, conditions: [], actions: [{ id: `location-action-${locationId}`, start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId } }] })
    }
    const before = structuredClone(context.document)
    expect(courseProjectDocumentSchema.parse(before)).toEqual(before)
    const result = cloneReferencePage(context, scene.id, {})
    if (!result.ok || !result.step) throw new Error(result.ok ? 'missing clone step' : result.reason)
    const next = result.step.nextDocument.surfaces[0]!
    if (next.type !== 'slide') throw new Error('expected slide')
    const clone = next.scenes[1]!
    expect(clone.interactions[0]!.actions[0]!.action).toEqual({ type: 'scene.go', sceneId: clone.id, targetStateId: clone.presentation!.initialStateId })
    expect(clone.interactions[1]!.actions[0]!.action).toEqual({ type: 'scene.go', sceneId: destination.id, targetStateId: 'initial' })
    const cloneLocation = result.step.nextDocument.locations.find(location => location.kind === 'slide-scene' && location.sceneId === clone.id)!
    expect(clone.interactions[2]!.actions[0]!.action).toEqual({ type: 'location.go', locationId: cloneLocation.id })
    expect(clone.interactions[3]!.actions[0]!.action).toEqual({ type: 'location.go', locationId: flow.startLocationId })
    expect(clone.presentation!.initialStateId).not.toBe('initial')
    expect(context.document).toEqual(before)
    expect(collectCourseProjectHealth(result.step.nextDocument, { assetFiles: {}, componentFiles: {} }).filter(finding => finding.code === 'interaction-state-reference-missing')).toEqual([])
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: result.step.nextDocument, assetFiles: {}, componentFiles: {} }))
    expect(reopened.project).toEqual(result.step.nextDocument)
    const initial = { document: before, resources: { assetFiles: {}, componentPackages: {} } }
    const forward = applyEditorTransactionStep(initial, result.step, 'forward')
    expect(applyEditorTransactionStep(forward, result.step, 'inverse').document).toEqual(before)
  })
  it('applies selected text only, preserves styles between matches, and reverses one transaction', () => {
    const { context, scene } = fixture()
    const second = structuredClone(scene.layerItems[0]!); second.layerItemId = 'other-text'; second.order = 2; scene.layerItems.push(second)
    const preview = createProductivityPreview(context, { kind: 'text', scope: 'page', find: '旧', replacement: '新文字' })
    expect(preview.items).toHaveLength(2)
    const result = applyProductivityPreview(context, preview, [preview.items[0]!.id])
    if (!result.ok) throw new Error(result.reason)
    if (!result.ok || !result.step) throw new Error('expected step')
    const state = { document: context.document, resources: { assetFiles: {}, componentPackages: {} } }
    const forward = applyEditorTransactionStep(state, result.step, 'forward')
    const surface = forward.document.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected slide')
    const content = surface.scenes[0]!.layerItems[0]!
    if (content.kind !== 'native' || content.content.nativeType !== 'text') throw new Error('expected text')
    expect(content.content.data.text).toBe('新文字甲新文字乙')
    expect(content.content.data.runs).toContainEqual({ start: 3, end: 4, style: { bold: true } })
    expect(content.content.data.runs).toContainEqual({ start: 7, end: 8, style: { italic: true } })
    expect(surface.scenes[0]!.layerItems[1]).toEqual(second)
    expect(courseProjectDocumentSchema.parse(forward.document)).toEqual(forward.document)
    expect(applyEditorTransactionStep(forward, result.step, 'inverse').document).toEqual(context.document)
  })
  it('rejects revision/session changes and forged preview values with zero source mutation', () => {
    const { context } = fixture(); const before = structuredClone(context.document)
    const preview = createProductivityPreview(context, { kind: 'text', scope: 'course', find: '旧', replacement: '新' })
    expect(applyProductivityPreview({ ...context, sessionToken: { ...context.sessionToken, generation: 2 } }, preview, preview.items.map(i => i.id)).ok).toBe(false)
    expect(applyProductivityPreview({ ...context, document: { ...context.document, revision: 1 } }, preview, preview.items.map(i => i.id)).ok).toBe(false)
    preview.items[0]!.newValue = '伪造'
    expect(applyProductivityPreview(context, preview, preview.items.map(i => i.id)).ok).toBe(false)
    expect(context.document).toEqual(before)
  })
  it('excludes shared owners from page scope and applies inherited background explicitly', () => {
    const { context, scene, surface } = fixture()
    const shared = structuredClone(scene.layerItems[0]!); shared.layerItemId = 'shared'
    surface.surfaceLayerItems.push({ item: shared, visibility: { mode: 'all', locationIds: [] } })
    expect(createProductivityPreview(context, { kind: 'text', scope: 'page', find: '旧', replacement: '新' }).items).toHaveLength(1)
    expect(createProductivityPreview(context, { kind: 'text', scope: 'surface', find: '旧', replacement: '新' }).items).toHaveLength(2)
    scene.backgroundMode = 'inherit'; context.document.backgroundColor = '#123456'
    const preview = createProductivityPreview(context, { kind: 'color', scope: 'page', tokenId: 'accent', property: 'background' })
    const background = preview.items.find(i => i.property === 'backgroundColor' && i.target === '背景')!
    expect(background.oldValue).toBe('#123456')
    const result = applyProductivityPreview(context, preview, [background.id])
    if (!result.ok || !result.step) throw new Error('expected step')
    const next = result.step.nextDocument.surfaces[0]!
    if (next.type !== 'slide') throw new Error('expected slide')
    expect(next.scenes[0]!.backgroundMode).toBe('own')
    expect(next.scenes[0]!.backgroundColor).toBe('#2563eb')
    expect(result.step.nextDocument.designTokens).toEqual(context.document.designTokens)
  })
  it('edits Flow chart labels/colors and plain rich text without changing code', () => {
    const { context } = fixture(); const chart = createChartNode()
    chart.title = '旧图表'
    const layer = sceneNodeToCourseLayerItem(chart, 0)
    if (layer.kind !== 'native' || layer.content.nativeType !== 'chart') throw new Error('chart')
    context.document.surfaces.push({ id: 'flow', type: 'flow', title: '讲义', surfaceLayerItems: [], layout: { readingWidth: 800, wideContentWidth: 1000 }, blocks: [{ id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: '旧正文' }] } }, { id: 'chart', type: 'chart', chart: layer.content.data, height: 320 }, { id: 'code', type: 'code', code: '旧代码' }] })
    context.document.mixedPrintPlan = { pageSize: 'A4', orientation: 'portrait', entries: [{ id: 'flow-print', kind: 'flow-document', surfaceId: 'flow' }, { id: 'slide-print', kind: 'slide-scenes', surfaceId: context.document.surfaces[0]!.id, sceneIds: [context.document.locations[0]!.kind === 'slide-scene' ? context.document.locations[0]!.sceneId : ''] }] }
    context.document.locations.push({ id: 'flow-location', kind: 'flow-block', surfaceId: 'flow', blockId: 'p', label: '正文' })
    context.sessionToken = { ...context.sessionToken, locationId: 'flow-location', surfaceType: 'flow' }
    expect(createProductivityPreview(context, { kind: 'text', scope: 'page', find: '旧', replacement: '新' }).items).toHaveLength(2)
    const preview = createProductivityPreview(context, { kind: 'color', scope: 'page', tokenId: 'accent', property: 'text' })
    expect(preview.items.some(i => i.property === '全文颜色')).toBe(true)
    const result = applyProductivityPreview(context, preview, preview.items.map(i => i.id))
    if (!result.ok || !result.step) throw new Error(result.ok ? 'no step' : result.reason)
    expect(courseProjectDocumentSchema.safeParse(result.step.nextDocument).success).toBe(true)
  })
  it('clones stable chart IDs, presentation references and asset bytes without changing source', () => {
    const { context, scene } = fixture()
    scene.layerItems.push(sceneNodeToCourseLayerItem(createChartNode(), 2))
    const image = createImageNode({ assetId: 'photo', width: 100, height: 100 })
    scene.layerItems.push(sceneNodeToCourseLayerItem(image, 3))
    context.document.assets.photo = { id: 'photo', filename: 'photo.png', path: 'assets/photo.png', kind: 'image', mimeType: 'image/png', byteLength: 3 }
    const source = structuredClone(context.document)
    const result = cloneReferencePage(context, scene.id, { photo: new Uint8Array([1, 2, 3]) })
    if (!result.ok || !result.step) throw new Error(result.ok ? 'no step' : result.reason)
    const next = result.step.nextDocument.surfaces[0]!
    if (next.type !== 'slide') throw new Error('slide')
    expect(next.scenes).toHaveLength(2)
    expect(next.scenes[0]).toEqual(scene)
    expect(next.scenes[1]!.id).not.toBe(scene.id)
    expect(next.scenes[1]!.presentation!.initialStateId).not.toBe(scene.presentation!.initialStateId)
    expect(JSON.stringify(next.scenes[1])).not.toContain('"assetId":"photo"')
    const oldChart = scene.layerItems[1]!, newChart = next.scenes[1]!.layerItems[1]!
    if (oldChart.kind !== 'native' || oldChart.content.nativeType !== 'chart' || newChart.kind !== 'native' || newChart.content.nativeType !== 'chart') throw new Error('chart')
    expect(newChart.content.data.categories[0]!.id).not.toBe(oldChart.content.data.categories[0]!.id)
    expect(newChart.content.data.series[0]!.points[0]!.categoryId).toBe(newChart.content.data.categories[0]!.id)
    expect(result.step.resourceChanges.assetFileChanges).toHaveLength(1)
    expect(courseProjectDocumentSchema.safeParse(result.step.nextDocument).success).toBe(true)
    expect(context.document).toEqual(source)
    expect(cloneReferencePage(context, scene.id, {}).ok).toBe(false)
  })
  it('previews checkbox selection and rejects a retired session from the visible dialog', () => {
    const { context } = fixture(); const onCommit = vi.fn(() => true)
    render(<ProductivityDialog getContext={() => context} getAssetFiles={() => ({})} onCommit={onCommit} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('查找文字'), { target: { value: '旧' } })
    fireEvent.change(screen.getByLabelText('替换文字'), { target: { value: '新' } })
    fireEvent.click(screen.getByText('预览修改'))
    expect(screen.getByText('新值：新甲新乙')).toBeTruthy()
    context.sessionToken = { ...context.sessionToken, generation: 7 }
    fireEvent.click(screen.getByText('应用勾选项'))
    expect(screen.getByRole('status').textContent).toContain('预览已过期')
    expect(onCommit).not.toHaveBeenCalled()
    cleanup()
  })
  it('clones interaction state declarations and input managed-family references together', () => {
    const { context, scene } = fixture()
    context.document.courseState.push({ key: 'answer', valueType: 'string', defaultValue: '' }, { key: 'valid', valueType: 'boolean', defaultValue: false })
    const item = structuredClone(scene.layerItems[0]!)
    item.layerItemId = 'answer-input'; item.order = 2
    if (item.kind !== 'native') throw new Error('native')
    item.content = { nativeType: 'input', data: { answerType: 'text', stateKey: 'answer', validityKey: 'valid', ruleFamilyRuleIds: ['answer-rule'], placeholder: '答案', style: { fontFamily: 'Arial', fontSize: 24, textColor: '#000000', fillColor: '#ffffff', fillOpacity: 1, borderColor: '#000000', borderOpacity: 1, borderWidth: 1, cornerRadius: 0, horizontalAlign: 'left', padding: 8 } } }
    scene.layerItems.push(item)
    scene.interactions.push({ id: 'answer-rule', enabled: true, trigger: { type: 'input.submit', nodeId: item.layerItemId }, conditions: [{ type: 'course-state.compare', key: 'answer', operator: 'eq', value: '正确' }], actions: [{ id: 'set-valid', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'valid', value: true } }] })
    const result = cloneReferencePage(context, scene.id, {})
    if (!result.ok || !result.step) throw new Error(result.ok ? 'no step' : result.reason)
    const surface = result.step.nextDocument.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('slide')
    const clone = surface.scenes[1]!, input = clone.layerItems[1]!
    if (input.kind !== 'native' || input.content.nativeType !== 'input') throw new Error('input')
    expect(input.content.data.stateKey).not.toBe('answer')
    expect(input.content.data.ruleFamilyRuleIds).toEqual([clone.interactions[0]!.id])
    expect(result.step.nextDocument.courseState).toHaveLength(4)
    expect(courseProjectDocumentSchema.safeParse(result.step.nextDocument).success).toBe(true)
  })
})
