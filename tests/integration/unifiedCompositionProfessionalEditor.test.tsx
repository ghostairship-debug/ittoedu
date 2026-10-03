import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { createTableLayerItem, createTableNode, createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionContentEdit } from '../../src/shared/composition/edit'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'
import { CompositionProfessionalEditor, type CompositionProfessionalNode } from '../../src/renderer/composition/CompositionProfessionalEditor'
import * as editorSession from '../../src/renderer/document/editorSession'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'

const roots: string[] = []
afterEach(async () => {
  cleanup(); vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const relative = path.relative(os.tmpdir(), root)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

function composition(model: DocumentModel): CompositionLayerItem {
  if (model.kind !== 'course-v9') throw new Error('Course required')
  const item = locateCourseLayer(model.project, 'quality-composition')?.item
  if (item?.kind !== 'composition') throw new Error('Composition required')
  return item
}
function professional(model: DocumentModel, nodeId: string): CompositionProfessionalNode {
  const node = findCompositionNode(composition(model).content.root, nodeId)
  if (!node || node.kind !== 'document' && node.kind !== 'native') throw new Error('Professional node required')
  return node
}

it('uses the real document, text, chart and table editors, commits once per applied draft, and preserves professional semantics through save and reopen', async () => {
  const source = compositionFragmentFixture()
  const text = createTextNode({ text: '甲乙', runs: [{ start: 0, end: 2, style: { bold: true, color: '#13579b' } }] })
  const documentNode: CompositionProfessionalNode = { id: 'professional-document', kind: 'document', content: { blocks: [
    { id: 'professional-p', type: 'paragraph', content: { inlines: [
      { type: 'text', text: '预测', style: { bold: true } },
      { type: 'math', formulaId: 'professional-math', latex: 'x^2', accessibleText: 'x的平方' },
    ] } },
    { id: 'professional-list', type: 'list', ordered: true, items: [{ id: 'professional-item', content: { inlines: [{ type: 'text', text: '保留原步骤' }] } }] },
  ] } }
  const textNode: CompositionProfessionalNode = { id: 'professional-text', kind: 'native', content: { nativeType: 'text', data: {
    text: text.text, runs: text.runs, style: text.style,
  } } }
  const tableNode: CompositionProfessionalNode = { id: 'professional-table', kind: 'native', content: createTableLayerItem(createTableNode()).content }
  const root = source.item.content.root
  if (root.kind !== 'element') throw new Error('Root element required')
  root.children.push(documentNode, textNode, tableNode)
  const driver = new CourseV9Driver()
  let savedBytes!: Uint8Array
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save(input) {
      if (input.binding.kind !== 'file') throw new Error('File required')
      savedBytes = input.bytes; await fs.writeFile(input.binding.path, input.bytes)
      return { ...input.binding, version: `revision-${input.revision}` }
    } } })
  const session = await registry.create({ kind: 'course-v9', project: source.project, resources: { assets: source.assetFiles, components: {} } }, 'professional.h5lesson')
  const initial = session.read()
  const commands: CompositionContentEdit[] = []
  let rejectNext = false
  function Harness({ nodeId }: { nodeId: string }) {
    const [snapshot, setSnapshot] = useState<DocumentSnapshot>(() => session.read())
    return <CompositionProfessionalEditor key={nodeId} node={professional(snapshot.model, nodeId)} onEdit={async edit => {
      if (rejectNext) { rejectNext = false; throw new Error('当前提交未完成；草稿保留') }
      const current = session.read()
      const result = await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: {
          type: 'composition.edit', layerItemId: source.item.layerItemId, edit,
        } } })
      expect(result.status).toBe('applied'); commands.push(edit); setSnapshot(session.read())
    }} />
  }
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  const mounted = render(<Harness nodeId={documentNode.id} />)
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  act(() => editor.view.dispatch(editor.view.state.tr.insertText('先', 1)))
  expect(session.read().revision).toBe(initial.revision)
  fireEvent.click(screen.getByRole('button', { name: '应用到作品' }))
  await waitFor(() => expect(commands).toHaveLength(1))
  const documentAfter = professional(session.read().model, documentNode.id)
  expect(documentAfter.kind === 'document' && documentAfter.content.blocks[0]).toMatchObject({
    id: 'professional-p', type: 'paragraph', content: { inlines: [
      { type: 'text', text: '先预测', style: { bold: true } },
      { type: 'math', formulaId: 'professional-math', latex: 'x^2', accessibleText: 'x的平方' },
    ] },
  })
  expect(documentAfter.kind === 'document' && documentAfter.content.blocks[1]).toEqual(documentNode.content.blocks[1])

  mounted.rerender(<Harness nodeId={textNode.id} />)
  const input = screen.getByLabelText('文字')
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '甲乙丙' } }); fireEvent.blur(input)
  fireEvent.click(screen.getByRole('button', { name: '应用到作品' }))
  await waitFor(() => expect(commands).toHaveLength(2))
  const textAfter = professional(session.read().model, textNode.id)
  expect(textAfter.kind === 'native' && textAfter.content).toMatchObject({ nativeType: 'text', data: { text: '甲乙丙',
    runs: [{ start: 0, end: 3, style: { bold: true, color: '#13579b' } }], style: text.style } })

  mounted.rerender(<Harness nodeId="chart" />)
  const chartBefore = professional(session.read().model, 'chart')
  if (chartBefore.kind !== 'native' || chartBefore.content.nativeType !== 'chart') throw new Error('Chart required')
  const firstCategory = chartBefore.content.data.categories[0]!
  const firstSeries = chartBefore.content.data.series[0]!
  fireEvent.change(screen.getByLabelText(`${firstSeries.name} 在 ${firstCategory.label} 的值`), { target: { value: '37' } })
  fireEvent.click(screen.getByRole('button', { name: '应用数据' }))
  rejectNext = true
  fireEvent.click(screen.getByRole('button', { name: '应用到作品' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('草稿保留')
  expect(commands).toHaveLength(2)
  expect(screen.getByLabelText(`${firstSeries.name} 在 ${firstCategory.label} 的值`)).toHaveValue('37')
  fireEvent.click(screen.getByRole('button', { name: '应用到作品' }))
  await waitFor(() => expect(commands).toHaveLength(3))
  const chartAfter = professional(session.read().model, 'chart')
  expect(chartAfter.kind === 'native' && chartAfter.content.nativeType === 'chart' && chartAfter.content.data.series[0]!.points[0]).toEqual({
    ...firstSeries.points[0], value: 37,
  })

  mounted.rerender(<Harness nodeId={tableNode.id} />)
  if (tableNode.kind !== 'native' || tableNode.content.nativeType !== 'table') throw new Error('Table required')
  const cell = tableNode.content.data.rows[0]!.cells[0]!
  const cellInput = screen.getByLabelText(`单元格 ${tableNode.content.data.rows[0]!.id} / ${cell.columnId}`)
  fireEvent.focus(cellInput); fireEvent.change(cellInput, { target: { value: '专业表格保留' } }); fireEvent.blur(cellInput)
  fireEvent.click(screen.getByRole('button', { name: '应用到作品' }))
  await waitFor(() => expect(commands).toHaveLength(4))
  const tableAfter = professional(session.read().model, tableNode.id)
  expect(tableAfter.kind === 'native' && tableAfter.content.nativeType === 'table' && tableAfter.content.data.rows[0]!.cells[0]).toEqual({ ...cell, text: '专业表格保留' })
  expect(session.read().undoDepth).toBe(initial.undoDepth + 4)

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-professional-')); roots.push(temp)
  const filename = path.join(temp, 'professional.h5lesson')
  await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
  expect(savedBytes.length).toBeGreaterThan(0)
  const reopened = driver.load(new Uint8Array(await fs.readFile(filename)))
  for (const nodeId of [documentNode.id, textNode.id, 'chart', tableNode.id]) expect(professional(reopened, nodeId)).toEqual(professional(session.read().model, nodeId))
  for (const nodeId of ['css', 'paragraph-text', 'counter', 'picture']) {
    expect(findCompositionNode(composition(reopened).content.root, nodeId)).toEqual(findCompositionNode(composition(initial.model).content.root, nodeId))
  }
  expect(Object.keys(reopened.resources.assets)).toEqual(Object.keys(initial.model.resources.assets))
  for (const assetId of Object.keys(initial.model.resources.assets)) {
    expect(Array.from(reopened.resources.assets[assetId]!)).toEqual(Array.from(initial.model.resources.assets[assetId]!))
  }
  expect(reopened.resources.components).toEqual(initial.model.resources.components)
  expect(composition(reopened).frame).toEqual(composition(initial.model).frame)
  expect(session.read().dirty).toBe(false)
})
