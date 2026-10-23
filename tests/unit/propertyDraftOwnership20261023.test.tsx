// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { BufferedInput, PropertyDraftBoundary, RangeField, discardPropertiesDrafts, flushPropertiesDrafts,
  preservePropertiesDrafts, restorePropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import { ColorInput } from '../../src/renderer/ui/ColorInput'
import { ComponentPropertiesEditor } from '../../src/renderer/ui/ComponentPropertiesEditor'
import { CourseComponentUnknownError } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createChartPropertiesCommands } from '../../src/renderer/ui/properties/chartPropertiesCommands'
import { createChartData } from '../../src/components/chart/data'
import { ChartProperties, type ChartPropertiesView } from '../../src/renderer/ui/properties/ChartProperties'
import { CHART_DEFINITION } from '../../src/components/chart'
import { componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import { NativeTableProperties, type NativeTablePropertiesCommands, type NativeTablePropertiesView } from '../../src/renderer/ui/properties/NativeTableProperties'
import { createTableData, TABLE_DEFINITION } from '../../src/components/table'
import { SharedBackgroundProperties, backgroundImportHandler } from '../../src/renderer/ui/properties/SharedBackgroundProperties'

const binding = (documentId: string) => JSON.stringify([documentId, 'epoch', 'slide', null, ['shape'], false])
afterEach(() => { cleanup(); discardPropertiesDrafts('closed-a'); discardPropertiesDrafts('active-b'); discardPropertiesDrafts('retained') })

it('keeps unmounted recovered input without blocking a different current property', async () => {
  const record = { bindingKey: binding('retained'), label: 'X', kind: 'number' as const, raw: '-', baseline: '35', composing: false }
  restorePropertiesDrafts('retained', [record])
  const commit = vi.fn()
  render(<PropertyDraftBoundary bindingKey={binding('retained')} onStale={() => {}}>
    <BufferedInput label="名称" value="旧名" onCommit={commit}/>
  </PropertyDraftBoundary>)
  fireEvent.focus(screen.getByLabelText('名称'))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新名' } })
  await act(async () => expect(await flushPropertiesDrafts('retained')).toBe(true))
  expect(commit).toHaveBeenCalledExactlyOnceWith('新名')
  expect(preservePropertiesDrafts('retained')).toEqual([record])
})

it('registers a reused text control after closing its previous document before switching to the next', async () => {
  const commitA = vi.fn(), commitB = vi.fn()
  const view = (documentId: string, onCommit: (value: string) => void) =>
    <PropertyDraftBoundary bindingKey={binding(documentId)} onStale={() => {}}>
      <BufferedInput label="名称" value={documentId} onCommit={onCommit}/>
    </PropertyDraftBoundary>
  const mounted = render(view('closed-a', commitA))
  discardPropertiesDrafts('closed-a')
  mounted.rerender(view('active-b', commitB))
  fireEvent.focus(screen.getByLabelText('名称'))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'B的新名称' } })
  expect(preservePropertiesDrafts('active-b')).toEqual([expect.objectContaining({ raw: 'B的新名称' })])
  await act(async () => expect(await flushPropertiesDrafts('active-b')).toBe(true))
  expect(commitB).toHaveBeenCalledExactlyOnceWith('B的新名称')
  expect(commitA).not.toHaveBeenCalled()
})

it('retains an incomplete active value for document preservation while explicit apply remains incomplete', async () => {
  const commit = vi.fn()
  render(<PropertyDraftBoundary bindingKey={binding('active-b')} onStale={() => {}}>
    <BufferedInput label="X" value={35} type="number" onCommit={commit}/>
  </PropertyDraftBoundary>)
  fireEvent.focus(screen.getByLabelText('X'))
  fireEvent.change(screen.getByLabelText('X'), { target: { value: '1e' } })
  await act(async () => {
    expect(await flushPropertiesDrafts('active-b')).toBe(false)
    expect(await flushPropertiesDrafts('active-b', 'preserve')).toBe(true)
  })
  expect(preservePropertiesDrafts('active-b')).toEqual([expect.objectContaining({ raw: '1e', baseline: '35' })])
  expect(commit).not.toHaveBeenCalled()
  fireEvent.compositionStart(screen.getByLabelText('X'))
  await act(async () => expect(await flushPropertiesDrafts('active-b', 'preserve')).toBe(false))
})

it('preserves a mounted recovered IME draft without pretending it is a live browser composition', async () => {
  const commit = vi.fn()
  render(<PropertyDraftBoundary bindingKey={binding('active-b')} onStale={() => {}}>
    <BufferedInput label="名称" value="before" onCommit={commit}/>
  </PropertyDraftBoundary>)
  await act(async () => restorePropertiesDrafts('active-b', [{ bindingKey: binding('active-b'), label: '名称', kind: 'text', raw: '恢复候选', baseline: 'before', composing: true }]))
  await act(async () => {
    expect(await flushPropertiesDrafts('active-b')).toBe(false)
    expect(await flushPropertiesDrafts('active-b', 'preserve')).toBe(true)
  })
  expect(preservePropertiesDrafts('active-b')).toEqual([expect.objectContaining({ raw: '恢复候选', composing: true })])
  expect(commit).not.toHaveBeenCalled()
})

it.each(['range', 'color', 'structured'] as const)('%s queries its exact failed operation before cancelling and retains unknown raw input', async kind => {
  let outcome: 'pending' | 'ready' = 'pending'
  const resolve = vi.fn(async () => outcome)
  const failed = new CourseComponentUnknownError('回执尚未确认', `${kind}-operation`, resolve)
  const commit = vi.fn(async () => { throw failed })
  const field = kind === 'range' ? <RangeField label="透明度" value={10} min={0} max={100} onChange={commit}/>
    : kind === 'color' ? <ColorInput id="ink" label="墨色" value="#000000" onChange={commit}/>
    : <ComponentPropertiesEditor definition={{ id: 'text-component', role: 'content', implementation: { kind: 'source', language: 'javascript', source: '' },
      dataSchema: { type: 'object', properties: { message: { type: 'string' } } } }}
      node={{ id: 'text', definitionId: 'text-component', data: { message: 'old' } }} onChange={commit}/>
  render(<PropertyDraftBoundary bindingKey={binding('active-b')} onStale={() => {}}>{field}</PropertyDraftBoundary>)
  const label = kind === 'range' ? '透明度' : kind === 'color' ? '墨色' : 'message'
  const next = kind === 'range' ? '60' : kind === 'color' ? '#22c55e' : 'new raw'
  const initial = kind === 'range' ? '10' : kind === 'color' ? '#000000' : 'old'
  const input = screen.getByLabelText(label)
  fireEvent.focus(input); fireEvent.change(input, { target: { value: next } })
  await act(async () => expect(await flushPropertiesDrafts('active-b')).toBe(false))
  expect(resolve).toHaveBeenCalledExactlyOnceWith('cancel')
  expect(preservePropertiesDrafts('active-b')).toEqual([expect.objectContaining({ raw: next })])
  await act(async () => fireEvent.keyDown(input, { key: 'Escape' }))
  expect((input as HTMLInputElement).value).toBe(next)
  expect(commit).toHaveBeenCalledTimes(1)
  outcome = 'ready'
  await act(async () => fireEvent.keyDown(input, { key: 'Escape' }))
  expect((input as HTMLInputElement).value).toBe(initial)
  expect(preservePropertiesDrafts('active-b')).toEqual([])
  expect(commit).toHaveBeenCalledTimes(1)
})

it('keeps the chart typed result through both adapters and resolves the original operation on reset', async () => {
  let outcome: 'pending' | 'ready' = 'pending'
  const resolve = vi.fn(async () => outcome)
  const failed = new CourseComponentUnknownError('图表回执尚未确认', 'chart-operation', resolve)
  const data = createChartData(), commit = vi.fn(async () => { throw failed })
  const node = componentPropertiesView({ id: 'chart', definitionId: CHART_DEFINITION.id, data: JSON.parse(JSON.stringify(data)) }, CHART_DEFINITION) as ChartPropertiesView
  render(<PropertyDraftBoundary bindingKey={binding('active-b')} onStale={() => {}}>
    <ChartProperties node={node} bindingKey={binding('active-b')} commands={createChartPropertiesCommands(data, commit, () => {})}/>
  </PropertyDraftBoundary>)
  fireEvent.change(screen.getByLabelText('系列一 在 甲 的值'), { target: { value: '42' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '应用数据' })))
  await waitFor(() => expect(resolve).toHaveBeenCalledExactlyOnceWith('cancel'))
  expect(screen.getByLabelText('系列一 在 甲 的值')).toHaveValue('42')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重置' })))
  expect(screen.getByLabelText('系列一 在 甲 的值')).toHaveValue('42')
  outcome = 'ready'
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重置' })))
  expect(screen.getByLabelText('系列一 在 甲 的值')).not.toHaveValue('42')
  expect(preservePropertiesDrafts('active-b')).toEqual([])
  expect(commit).toHaveBeenCalledTimes(1)
})

it('automatically acknowledges a lost field ACK once the original operation is confirmed applied', async () => {
  const resolve = vi.fn(async () => 'applied' as const)
  const failed = new CourseComponentUnknownError('回执暂时中断', 'already-applied', resolve)
  const commit = vi.fn()
  function Field() {
    const [value, setValue] = useState('before')
    return <PropertyDraftBoundary bindingKey={binding('active-b')} onStale={() => {}}>
      <BufferedInput label="名称" value={value} onCommit={async next => { commit(next); setValue(next); throw failed }}/>
    </PropertyDraftBoundary>
  }
  render(<Field/>)
  fireEvent.focus(screen.getByLabelText('名称'))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'after' } })
  await act(async () => expect(await flushPropertiesDrafts('active-b')).toBe(true))
  expect(screen.getByLabelText('名称')).toHaveValue('after')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(preservePropertiesDrafts('active-b')).toEqual([])
  expect(commit).toHaveBeenCalledExactlyOnceWith('after')
})

it('parks a dirty property when its target changes and restores it without blocking the next target', async () => {
  const commitA = vi.fn(), commitB = vi.fn()
  const view = (id: string, onCommit: (value: string) => void) => <PropertyDraftBoundary bindingKey={binding(id)} onStale={() => {}}>
    <BufferedInput label="名称" value={id} onCommit={onCommit}/>
  </PropertyDraftBoundary>
  const ui = render(view('closed-a', commitA))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'A raw' } })
  ui.rerender(view('active-b', commitB))
  expect(screen.getByLabelText('名称')).toHaveValue('active-b')
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'B raw' } })
  await act(async () => expect(await flushPropertiesDrafts('active-b')).toBe(true))
  expect(commitB).toHaveBeenCalledExactlyOnceWith('B raw')
  expect(commitA).not.toHaveBeenCalled()
  ui.rerender(view('closed-a', commitA))
  expect(screen.getByLabelText('名称')).toHaveValue('A raw')
})

it('keeps a real IME input DOM through target handoff and releases it after compositionend', async () => {
  const commitA = vi.fn(), commitB = vi.fn()
  const view = (id: string, onCommit: (value: string) => void) => <PropertyDraftBoundary bindingKey={binding(id)} onStale={() => {}}>
    <BufferedInput label="名称" value={id} onCommit={onCommit}/>
  </PropertyDraftBoundary>
  const ui = render(view('closed-a', commitA)), input = screen.getByLabelText('名称')
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '中文候选' } })
  ui.rerender(view('active-b', commitB))
  expect(screen.getByLabelText('名称')).toBe(input)
  await act(async () => fireEvent.compositionEnd(input, { target: { value: '中文完成' } }))
  await waitFor(() => expect(screen.getByLabelText('名称')).not.toBe(input))
  expect(screen.getByLabelText('名称')).toHaveValue('active-b')
  expect(preservePropertiesDrafts('closed-a')).toEqual([expect.objectContaining({ raw: '中文完成', composing: false })])
  expect(commitA).not.toHaveBeenCalled(); expect(commitB).not.toHaveBeenCalled()
})

it('parks an admitted ACK instead of freezing another document and preserves its late rejection', async () => {
  let reject!: (error: unknown) => void
  const pending = new Promise<void>((_, fail) => { reject = fail })
  const commitA = vi.fn(() => pending), commitB = vi.fn()
  const view = (id: string, onCommit: (value: string) => void | Promise<void>) => <PropertyDraftBoundary bindingKey={binding(id)} onStale={() => {}}>
    <BufferedInput label="名称" value={id} onCommit={onCommit}/>
  </PropertyDraftBoundary>
  const ui = render(view('closed-a', commitA))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'A pending' } })
  let flush!: Promise<boolean>
  act(() => { flush = flushPropertiesDrafts('closed-a') })
  ui.rerender(view('active-b', commitB))
  expect(screen.getByLabelText('名称')).toHaveValue('active-b')
  await act(async () => { reject(new Error('A refused')); expect(await flush).toBe(false) })
  expect(screen.getByLabelText('名称')).toHaveValue('active-b')
  expect(preservePropertiesDrafts('closed-a')).toEqual([expect.objectContaining({ raw: 'A pending' })])
})

it('keeps the real table cell composition DOM while its raw input remains with the existing cell owner', async () => {
  const data = createTableData({ rows: 1, columns: 1 })
  const node = componentPropertiesView({ id: 'table', definitionId: TABLE_DEFINITION.id, data: JSON.parse(JSON.stringify(data)) }, TABLE_DEFINITION) as NativeTablePropertiesView
  const commands: NativeTablePropertiesCommands = {
    mergeCells: vi.fn(), splitCells: vi.fn(), beginCellEdit: vi.fn(), updateCellDraft: vi.fn(), cancelCellEdit: vi.fn(),
    commitCellText: vi.fn(), commitLastCellAndAppendRow: vi.fn(), patchStyle: vi.fn(), patchCellStyle: vi.fn(),
    setRowHeight: vi.fn(), setColumnWidth: vi.fn(), insertRow: vi.fn(), deleteRow: vi.fn(), moveRow: vi.fn(),
    insertColumn: vi.fn(), deleteColumn: vi.fn(), moveColumn: vi.fn(),
  }
  const view = (id: string) => <PropertyDraftBoundary bindingKey={binding(id)} onStale={() => {}}>
    <NativeTableProperties node={node} bindingKey={binding(id)} commands={commands}/>
  </PropertyDraftBoundary>
  const label = `单元格 ${node.rows[0].id} / ${node.columns[0].id}`
  const ui = render(view('closed-a')), input = screen.getByLabelText(label)
  fireEvent.focus(input); fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '表格中文' } })
  ui.rerender(view('active-b'))
  expect(screen.getByLabelText(label)).toBe(input)
  await act(async () => fireEvent.compositionEnd(input, { target: { value: '表格中文完成' } }))
  await waitFor(() => expect(screen.getByLabelText(label)).not.toBe(input))
  expect(commands.updateCellDraft).toHaveBeenLastCalledWith(node.rows[0].cells[0].id, '表格中文完成', false)
  expect(commands.commitCellText).not.toHaveBeenCalled()
})

it('retains uploaded bytes while an exact outcome is unknown and confirms without uploading twice', async () => {
  let outcome: 'pending' | 'applied' = 'pending'
  const resolve = vi.fn(async () => outcome)
  const failed = new CourseComponentUnknownError('上传回执尚未确认', 'upload-original', resolve)
  const commit = vi.fn(async () => { throw failed })
  render(<PropertyDraftBoundary bindingKey={binding('active-b')} onStale={() => {}}>
    <SharedBackgroundProperties ownerLabel="演示页" color="#ffffff" assetId={null} assets={{}}
      effective={{ color: '#ffffff', assetId: null, sourceOwner: 'course' }} onColorChange={() => {}} onAssetChange={() => {}}
      onImportAsset={backgroundImportHandler(() => 'original-target', commit)}/>
  </PropertyDraftBoundary>)
  const bytes = Uint8Array.from([137, 80, 78, 71]), file = new File([bytes], 'kept.png', { type: 'image/png' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer })
  fireEvent.change(screen.getByTestId('shared-background-properties-asset-file-input'), { target: { files: [file] } })
  await screen.findByRole('button', { name: '重试上传' })
  expect(resolve).toHaveBeenCalledExactlyOnceWith('cancel')
  const saved = preservePropertiesDrafts('active-b').find(record => record.label.endsWith(':图片上传'))!
  expect(JSON.parse(saved.raw)).toMatchObject({ name: 'kept.png', bytes: Array.from(bytes) })
  expect(screen.getByTestId('shared-background-properties-asset-upload')).toBeDisabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试上传' })))
  expect(commit).toHaveBeenCalledTimes(1)
  outcome = 'applied'
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试上传' })))
  expect(commit).toHaveBeenCalledTimes(1)
  expect(preservePropertiesDrafts('active-b')).toEqual([])
  expect(screen.getByTestId('shared-background-properties-asset-upload')).not.toBeDisabled()
})
