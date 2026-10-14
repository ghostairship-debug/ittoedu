// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BufferedInput, FontFamilyPicker, PropertyDraftBoundary, PropertyDraftFieldBoundary, RangeField,
  discardPropertiesDrafts, flushPropertiesDrafts, hasPropertiesDrafts, preservePropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import { DesignTokensEditor } from '../../src/renderer/ui/DesignTokensEditor'
import { ColorInput } from '../../src/renderer/ui/ColorInput'
import { ComponentPropertiesEditor } from '../../src/renderer/ui/ComponentPropertiesEditor'
import { SlideInputProperties, type SlideInputPropertiesCommands } from '../../src/renderer/ui/properties/SlideInputProperties'
import { SpatialCameraPanel } from '../../src/renderer/ui/SpatialCameraPanel'
import { ImageProperties, type PropertiesImageView } from '../../src/renderer/ui/properties/SlideNativePropertiesPanel'
import { componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import { createImageData, IMAGE_DEFINITION } from '../../src/components/image'
import { createChartPropertiesCommands } from '../../src/renderer/ui/properties/chartPropertiesCommands'
import { createChartData } from '../../src/components/chart/data'
import { projectDesignTokensSchema } from '../../src/shared/contracts/design-v1/schema'
import { createInputData, inputAnswerContent } from '../../src/components/input/data'
import type { ComponentDefinition } from '../../src/shared/contracts/component-platform'
import type { InputRuleConfig } from '../../src/core/tools/inputRuleFamily'

const key = (documentId = 'A') => JSON.stringify([documentId, 'epoch', 'surface', null, ['instance']])
const boundary = (children: React.ReactNode, documentId = 'A') => <PropertyDraftBoundary bindingKey={key(documentId)} onStale={() => {}}>{children}</PropertyDraftBoundary>
afterEach(() => { cleanup(); for (const id of ['A', 'B']) discardPropertiesDrafts(id) })

it('CA300 preserves the original document token input while an equal-valued second document mounts', async () => {
  const first = vi.fn(), second = vi.fn(), value = projectDesignTokensSchema.parse(undefined)
  const ui = (doc: string, commit: typeof first) => boundary(<DesignTokensEditor value={value} onChange={commit} />, doc)
  const { rerender } = render(ui('A', first))
  const field = screen.getByLabelText('字体 Token 1 名称')
  fireEvent.change(field, { target: { value: 'A 的字体稿' } })
  expect(hasPropertiesDrafts('A')).toBe(true)
  rerender(ui('B', second)); fireEvent.blur(field)
  await act(async () => { expect(await flushPropertiesDrafts('A')).toBe(false) })
  expect(field).toHaveValue('A 的字体稿'); expect(second).not.toHaveBeenCalled(); expect(first).not.toHaveBeenCalled()
})

it('CA342 keeps the slider input and refuses a new writer after the same field changes externally', async () => {
  const first = vi.fn(), latest = vi.fn()
  const ui = (value: number, writer: typeof first) => boundary(<RangeField label="透明度" value={value} min={0} max={100} onChange={writer} />)
  const { rerender } = render(ui(0, first)); const slider = screen.getByLabelText('透明度')
  fireEvent.pointerDown(slider); fireEvent.change(slider, { target: { value: '60' } })
  rerender(ui(80, latest)); expect(slider).toHaveAttribute('aria-invalid', 'true')
  fireEvent.pointerUp(slider)
  await act(async () => { expect(await flushPropertiesDrafts('A')).toBe(false) })
  expect(slider).toHaveValue('60'); expect(latest).not.toHaveBeenCalled()
})

it('CA240 recovers only the retired area draft and never consumes another mounted field', async () => {
  const a = vi.fn(), b = vi.fn()
  const ui = () => boundary(<>{[['a', 10, a], ['b', 20, b]].map(([id, value, onChange]) =>
    <PropertyDraftFieldBoundary fieldKey={['safeArea', String(id)]} key={String(id)}><RangeField label="左侧位置" value={value as number} min={0} max={100} onChange={onChange as typeof a} /></PropertyDraftFieldBoundary>)}</>)
  const first = render(ui()); fireEvent.change(screen.getAllByLabelText('左侧位置')[0]!, { target: { value: '40' } }); first.unmount()
  render(ui()); const fields = screen.getAllByLabelText('左侧位置')
  expect(fields[0]).toHaveValue('40'); expect(fields[1]).toHaveValue('20')
  await act(async () => { expect(await flushPropertiesDrafts('A')).toBe(true) })
  expect(a).toHaveBeenCalledExactlyOnceWith(40); expect(b).not.toHaveBeenCalled()
})

it('CA240 the production image panel restores A while B retains its separate safe-area value', async () => {
  const data = createImageData('asset'); data.safeAreas = [{ id: 'a', label: 'A', x: .1, y: .1, width: .2, height: .2 }, { id: 'b', label: 'B', x: .2, y: .2, width: .2, height: .2 }]
  const node = componentPropertiesView({ id: 'image', definitionId: IMAGE_DEFINITION.id, data: JSON.parse(JSON.stringify(data)) }, IMAGE_DEFINITION) as PropertiesImageView
  const patch = vi.fn(), ui = () => boundary(<ImageProperties node={node} update={patch} onReplaceImage={() => {}} />)
  const first = render(ui()); fireEvent.change(screen.getAllByLabelText('左侧位置')[0]!, { target: { value: '40' } }); first.unmount()
  render(ui()); expect(screen.getAllByLabelText('左侧位置').map(field => (field as HTMLInputElement).value)).toEqual(['40', '20'])
  await act(async () => { expect(await flushPropertiesDrafts('A')).toBe(true) })
  expect(patch).toHaveBeenCalledTimes(1); expect(patch.mock.lastCall?.[0].safeAreas).toMatchObject([{ id: 'a', x: .4 }, { id: 'b', x: .2 }])
})

it('CA346 keeps a literal dotted-key input on its original field through a data order change', () => {
  const definition: ComponentDefinition = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: '' },
    dataSchema: { type: 'object', properties: { 'a.b': { type: 'string' }, a: { type: 'object', properties: { b: { type: 'string' } } }, counter: { type: 'number' } } } }
  const write = vi.fn()
  const ui = (data: Record<string, any>) => boundary(<ComponentPropertiesEditor definition={definition} node={{ id: 'instance', definitionId: definition.id, data }} onChange={write} />)
  const { rerender } = render(ui({ 'a.b': 'same', a: { b: 'same' }, counter: 0 }))
  fireEvent.change(screen.getByLabelText('a.b'), { target: { value: 'literal-draft' } })
  rerender(ui({ a: { b: 'same' }, 'a.b': 'same', counter: 1 }))
  expect(screen.getByLabelText('a · b')).toHaveValue('same'); expect(screen.getByLabelText('a.b')).toHaveValue('literal-draft')
  fireEvent.blur(screen.getByLabelText('a.b'))
  expect(write).toHaveBeenCalledExactlyOnceWith({ a: { b: 'same' }, 'a.b': 'literal-draft', counter: 1 })
})

it('CA099 flushes focused font and color inputs, and preserves both when their ACK is rejected', async () => {
  const font = vi.fn(async () => { throw new Error('font rejected') }), color = vi.fn(async () => { throw new Error('color rejected') })
  render(boundary(<><FontFamilyPicker value="serif" onCommit={font} /><ColorInput id="ink" label="墨色" value="#000000" onChange={color} /></>))
  fireEvent.change(screen.getByLabelText('字体'), { target: { value: 'Teacher Font' } })
  fireEvent.change(screen.getByLabelText('墨色'), { target: { value: '#22c55e' } })
  expect(preservePropertiesDrafts('A').map(draft => draft.raw)).toEqual(expect.arrayContaining(['Teacher Font', '#22c55e']))
  await act(async () => { expect(await flushPropertiesDrafts('A')).toBe(false) })
  expect(font).toHaveBeenCalledExactlyOnceWith('Teacher Font'); expect(color).toHaveBeenCalledExactlyOnceWith('#22c55e')
  expect(screen.getByLabelText('字体')).toHaveValue('Teacher Font'); expect(screen.getByLabelText('墨色')).toHaveValue('#22c55e')
  expect(hasPropertiesDrafts('A')).toBe(true)
})

it('CA120 forwards a real chart range validation failure to the buffered input', async () => {
  const chart = createChartData(); chart.style = { ...chart.style, valueMax: 10 } as typeof chart.style
  const report = vi.fn(), commit = vi.fn(() => null), commands = createChartPropertiesCommands(chart, commit, report)
  render(boundary(<BufferedInput label="轴最小值" value="" allowEmpty onCommit={value => commands.patchStyle({ valueMin: Number(value) })} />))
  fireEvent.change(screen.getByLabelText('轴最小值'), { target: { value: '20' } })
  await act(async () => { expect(await flushPropertiesDrafts('A')).toBe(false) })
  expect(commit).not.toHaveBeenCalled(); expect(report).toHaveBeenCalled(); expect(screen.getByLabelText('轴最小值')).toHaveValue('20')
  expect(hasPropertiesDrafts('A')).toBe(true)
})

function inputUi(config: InputRuleConfig, configure: SlideInputPropertiesCommands['configure']) {
  const data = createInputData(), content = inputAnswerContent('input', data)
  return <SlideInputProperties node={{ id: 'input', type: 'input', ...content } as any} patch={() => {}} commands={{
    inspection: { managed: true, conflict: false, config } as any, feedbackTargets: [{ id: 'error-box', name: '新的错误反馈' }], configure }} />
}
it('CA328 syncs clean answers after an external change and preserves conflicting manual answers', async () => {
  const configure = vi.fn<SlideInputPropertiesCommands['configure']>(() => null), config: InputRuleConfig = { answerType: 'text', answers: ['old'], correct: [], error: [] }
  const { rerender } = render(inputUi(config, configure)); rerender(inputUi({ ...config, answers: ['new'] }, configure))
  expect(screen.getByLabelText('正确答案')).toHaveValue('new')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '应用判题配置' })))
  expect(configure.mock.lastCall?.[0]).toMatchObject({ config: { answers: ['new'] } })
  fireEvent.change(screen.getByLabelText('正确答案'), { target: { value: 'manual' } })
  rerender(inputUi({ ...config, answers: ['external'] }, configure))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '应用判题配置' })))
  expect(configure).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('正确答案')).toHaveValue('manual'); expect(screen.getByRole('alert')).toHaveTextContent('已保留')
})

it('CA100 changing error feedback keeps independent correct-side actions', async () => {
  const configure = vi.fn<SlideInputPropertiesCommands['configure']>(() => null), correct = [{ type: 'audio.play', nodeId: 'correct-tone' }] as any
  render(inputUi({ answerType: 'text', answers: ['yes'], correct, error: [] }, configure))
  fireEvent.change(screen.getByLabelText('错误反馈'), { target: { value: 'error-box' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '应用判题配置' })))
  expect(configure.mock.lastCall?.[0]).toMatchObject({ config: { correct,
    error: expect.arrayContaining([expect.objectContaining({ type: 'node.enter', nodeId: 'error-box' })]) } })
})

it('CA328 keeps input typed during its own grading ACK and advances that field baseline', async () => {
  let accept!: () => void
  const configure = vi.fn<SlideInputPropertiesCommands['configure']>(() => new Promise<null>(resolve => { accept = () => resolve(null) }))
  const initial: InputRuleConfig = { answerType: 'text', answers: ['old'], correct: [], error: [] }
  const { rerender } = render(inputUi(initial, configure))
  fireEvent.change(screen.getByLabelText('正确答案'), { target: { value: 'first' } })
  fireEvent.click(screen.getByRole('button', { name: '应用判题配置' }))
  fireEvent.change(screen.getByLabelText('正确答案'), { target: { value: 'second during ACK' } })
  await act(async () => accept())
  rerender(inputUi({ ...initial, answers: ['first'] }, configure))
  expect(screen.getByLabelText('正确答案')).toHaveValue('second during ACK')
  configure.mockReturnValue(null)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '应用判题配置' })))
  expect(configure.mock.lastCall?.[0]).toMatchObject({ config: { answers: ['second during ACK'] } })
})

it('CA167 retains semantic-zoom object selection after a rejected ACK', async () => {
  const add = vi.fn(async () => { throw new Error('rule conflict') })
  render(<SpatialCameraPanel surfaceTitle="空间" frames={[]} home={{ x: 0, y: 0, zoom: 1 }} sessionCamera={null} activeCameraFrameId={null} showCameraFrames={false}
    worldInstances={[{ id: 'object', name: '教学对象', definitionId: 'shape', data: {} }]} semanticZoomRules={[]} onAddSemanticZoomRule={add}
    onShowCameraFramesChange={() => {}} onAddFrame={() => {}} onRenameFrame={() => {}} onReorderFrame={() => {}} onDeleteFrame={() => {}} onSetHome={() => {}} onActivateFrame={() => {}} onUpdateSemanticZoomRule={() => {}} onDeleteSemanticZoomRule={() => {}} />)
  fireEvent.click(screen.getByLabelText('教学对象'))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '添加语义缩放规则' })))
  expect(screen.getByLabelText('教学对象')).toBeChecked(); expect(screen.getByRole('alert')).toHaveTextContent('rule conflict')
})
