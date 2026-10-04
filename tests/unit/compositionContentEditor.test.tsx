import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CompositionContentEditor } from '../../src/renderer/composition/CompositionContentEditor'
import { applyCompositionContentEdit } from '../../src/core/tools/compositionContent'
import { courseLayerItemToEditorCanvasNode } from '../../src/renderer/store/slideEditorProjection'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'

afterEach(cleanup)

function fixture(): CompositionLayerItem {
  return { layerItemId: 'composition', kind: 'composition', label: '图文组合', frame: { mode: 'absolute', x: 30, y: 40, width: 900, height: 600 },
    rotation: 15, opacity: 0.8, visible: true, locked: false, hitPolicy: 'auto', order: 2, playbackInitialVisibility: 'inherit',
    content: { assets: {}, root: { id: 'layout', kind: 'element', tagName: 'div', attributes: { style: 'display:grid;gap:24px' }, children: [
      { id: 'heading', kind: 'element', tagName: 'h1', attributes: { id: 'author-heading', style: 'color: red; width:50%;' }, children: [{ id: 'title-text', kind: 'text', text: '原始标题' }] },
      { id: 'whitespace', kind: 'text', text: '\n  ' },
      { id: 'picture', kind: 'element', tagName: 'img', attributes: { src: 'existing.png', alt: '示意图' }, children: [] },
    ] } } }
}

it('edits source text, styles and content order while retaining the composition root geometry and authored identities', async () => {
  let current = fixture()
  const originalFrame = structuredClone(current.frame)
  function Harness() {
    const [item, setItem] = useState(current), [selected, setSelected] = useState<string | null>('heading')
    return <CompositionContentEditor content={item.content} selectedNodeId={selected} onSelect={setSelected} onEdit={async edit => {
      const result = applyCompositionContentEdit(current.content, edit)
      if (!result.ok) throw new Error(result.diagnostic.message)
      current = { ...current, content: result.content }; setItem(current)
    }} />
  }
  render(<Harness />)
  const text = screen.getByLabelText('正文')
  fireEvent.change(text, { target: { value: '修改后的标题' } }); fireEvent.blur(text)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.getByLabelText('正文')).toHaveValue('修改后的标题')

  const width = screen.getByLabelText('宽度')
  fireEvent.change(width, { target: { value: '65%' } }); fireEvent.blur(width)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  // Switching to free placement keeps the displayed boundary, so it needs the live display (covered in Chromium).
  expect(screen.getByLabelText('定位')).toBeDisabled()
  const offset = screen.getByLabelText('横向偏移')
  fireEvent.change(offset, { target: { value: '20px' } }); fireEvent.blur(offset)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '后移' }))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())

  const root = current.content.root
  if (root.kind !== 'element') throw new Error('element required')
  expect(root.attributes.style).toBe('display:grid;gap:24px')
  expect(root.children.map(child => child.id)).toEqual(['whitespace', 'picture', 'heading'])
  const heading = root.children[2]!
  if (heading.kind !== 'element') throw new Error('heading required')
  expect(heading.attributes.id).toBe('author-heading')
  expect(heading.attributes.style).toContain('width: 65%;')
  expect(heading.attributes.style).not.toContain('position')
  expect(heading.attributes.style).toContain('left: 20px;')
  expect(heading.children[0]).toEqual({ id: 'title-text', kind: 'text', text: '修改后的标题' })
  expect(current.frame).toEqual(originalFrame)
  expect(courseLayerItemToEditorCanvasNode(current)).toEqual({ id: 'composition', name: '图文组合', type: 'composition',
    x: 30, y: 40, width: 900, height: 600, rotation: 15, opacity: 0.8, visible: true, locked: false, playbackInitialVisibility: 'inherit' })
})

it('keeps an unsuccessful author edit visible instead of claiming it was saved', async () => {
  render(<CompositionContentEditor content={fixture().content} selectedNodeId="heading" onSelect={() => {}}
    onEdit={async () => { throw new Error('目标内容已改变，请重新选择') }} />)
  const text = screen.getByLabelText('正文')
  fireEvent.change(text, { target: { value: '保留未确认输入' } }); fireEvent.blur(text)
  expect(await screen.findByRole('alert')).toHaveTextContent('目标内容已改变，请重新选择')
  expect(text).toHaveValue('保留未确认输入')
  expect(screen.queryByRole('status')).toBeNull()
})
