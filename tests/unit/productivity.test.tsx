import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { createProductivityPreview, applyProductivityPreview, type ProductivityContext, type DesignProductionStep } from '../../src/renderer/authoring/productivity'
import { ProductivityDialog } from '../../src/renderer/ui/productivity/ProductivityDialog'
import { createDesignProductionActions } from '../../src/renderer/composition/designProductionActions'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { FlowTextContent } from '../../src/shared/document/content'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const math = [{ type: 'math' as const, formulaId: 'math-a', latex: 'x^{2}', accessibleText: 'x平方' },
  { type: 'math' as const, formulaId: 'math-b', latex: '\\frac{1}{2}', accessibleText: '二分之一' }]
function fixture(): CourseProjectV10 {
  const data = createTextData('旧文字'), content: FlowTextContent = { inlines: [
    { type: 'text', text: '旧', style: { bold: true } }, { type: 'text', text: '文', style: { italic: true } }, math[0],
    { type: 'text', text: '旧', style: { color: '#123456' } }, { type: 'text', text: '文', style: { underline: true } }, math[1],
    { type: 'text', text: '旧文', style: { fontSize: 24 } },
  ] }
  return { schemaVersion: 10, id: 'productivity', revision: 0, title: '正文', definitions: {
    [TEXT_DEFINITION.id]: TEXT_DEFINITION, custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export const text = "旧代码"' } },
  }, instances: { mixed: { id: 'mixed', definitionId: TEXT_DEFINITION.id, data: json({ ...data, content }) },
    neighbor: { id: 'neighbor', definitionId: TEXT_DEFINITION.id, data: json(createTextData('旧文')) },
    global: { id: 'global', definitionId: TEXT_DEFINITION.id, data: json(createTextData('旧文')) },
    code: { id: 'code', definitionId: 'custom', data: { label: '旧文' } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['mixed', 'neighbor', 'code'] }],
    global: { underlay: [], overlay: ['global'] }, assets: {}, background: { color: '#123456' },
    designTokens: { colors: [{ id: 'accent', label: '强调色', color: '#2563eb' }], fonts: [] } }
}

it('replaces only checked rich-text segments across style boundaries, preserving math, shared content, code and one reversible saved transaction', async () => {
  const project = fixture(), h = await createV10StoreHost(project), commands = createDesignProductionActions({ kernel: h.kernel })
  const context = (): ProductivityContext => ({ document: h.kernel.readDocument(), target: h.kernel.captureTarget() })
  try {
    const preview = createProductivityPreview(context(), { kind: 'text', scope: 'page', find: '旧文', replacement: '新😀' })
    expect(preview.items).toHaveLength(4)
    expect(preview.unsupported).toEqual([expect.stringContaining('自定义组件')])
    expect(createProductivityPreview(context(), { ...preview.request, scope: 'course' }).items).toHaveLength(5)
    const result = applyProductivityPreview(context(), preview, preview.items.filter(item => item.id.startsWith('mixed/')).map(item => item.id))
    if (!result.ok || !result.step) throw new Error('Expected a canonical operation')
    expect(await commands.commitDesignProduction(result.step)).toBe(true)
    const content = (h.model().project.instances.mixed.data as unknown as { content: FlowTextContent }).content
    expect(content.inlines.filter(inline => inline.type === 'math')).toEqual(math)
    expect(content.inlines.filter(inline => inline.type === 'text')).toEqual([
      { type: 'text', text: '新😀', style: { bold: true } }, { type: 'text', text: '新😀', style: { color: '#123456' } },
      { type: 'text', text: '新😀', style: { fontSize: 24 } },
    ])
    for (const id of ['neighbor', 'global', 'code']) expect(h.model().project.instances[id]).toEqual(project.instances[id])
    expect(h.model().project.definitions).toEqual(project.definitions)
    expect(h.first.read().undoDepth).toBe(1)
    expect(h.driver.load(h.driver.serialize(h.model()))).toEqual(h.model())
    await h.bridge.undo(); expect(h.model().project.instances).toEqual(project.instances)
    await h.bridge.redo()
    const color = createProductivityPreview(context(), { kind: 'color', scope: 'page', tokenId: 'accent', property: 'background' })
    const background = color.items.find(item => item.target === '背景')!
    expect(background.oldValue).toBe('#123456')
    const beforeColor = structuredClone(h.model().project.instances)
    const recolor = applyProductivityPreview(context(), color, [background.id])
    if (!recolor.ok || !recolor.step) throw new Error('Expected inherited background change')
    expect(await commands.commitDesignProduction(recolor.step)).toBe(true)
    expect(h.model().project.surfaces[0].background).toEqual({ mode: 'own', color: '#2563eb' })
    expect(h.model().project.background).toEqual(project.background)
    expect(h.model().project.instances).toEqual(beforeColor)
    const fresh = createProductivityPreview(context(), { kind: 'text', scope: 'page', find: '新😀', replacement: '下一稿' }), before = structuredClone(h.first.read())
    const forged = structuredClone(fresh); forged.items[0].newValue = '伪造'
    expect(applyProductivityPreview(context(), forged, [forged.items[0].id])).toMatchObject({ ok: false })
    expect(applyProductivityPreview({ ...context(), target: { ...context().target, epoch: 'retired' } }, fresh, [])).toMatchObject({ ok: false })
    expect(h.first.read()).toEqual(before)
  } finally { h.bridge.dispose() }
})

it('applies checkbox selection from the visible dialog through the real writer and retains a stale preview without committing', async () => {
  const h = await createV10StoreHost(fixture()), onClose = vi.fn(), commands = createDesignProductionActions({ kernel: h.kernel })
  const context = (): ProductivityContext => ({ document: h.kernel.readDocument(), target: h.kernel.captureTarget() })
  const onCommit = vi.fn((step: DesignProductionStep) => commands.commitDesignProduction(step))
  try {
    render(<ProductivityDialog getContext={context} getAssetFiles={() => ({})} onCommit={onCommit} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('查找文字'), { target: { value: '旧文' } })
    fireEvent.change(screen.getByLabelText('替换文字'), { target: { value: '新文' } })
    fireEvent.click(screen.getByText('预览修改'))
    fireEvent.click(screen.getByText('全不选')); fireEvent.click(screen.getAllByRole('checkbox')[3])
    await act(async () => { fireEvent.click(screen.getByText('应用勾选项')) })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(h.model().project.instances.neighbor.data).toMatchObject({ content: { inlines: [{ type: 'text', text: '新文' }] } })
    expect(h.model().project.instances.mixed).toEqual(fixture().instances.mixed)
    expect(h.first.read().undoDepth).toBe(1)
    fireEvent.click(screen.getByText('预览修改'))
    await act(async () => { await h.kernel.edit([{ type: 'data.set', instanceId: 'mixed', path: ['content'], value: { inlines: [{ type: 'text', text: '后来的内容' }] } }]) })
    const before = structuredClone(h.first.read())
    await act(async () => { fireEvent.click(screen.getByText('应用勾选项')) })
    expect(screen.getByRole('status')).toHaveTextContent('内容已变化')
    expect(onCommit).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1)
    expect(h.first.read()).toEqual(before)
  } finally { cleanup(); h.bridge.dispose() }
})
