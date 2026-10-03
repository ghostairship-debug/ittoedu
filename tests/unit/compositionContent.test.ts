import { describe, expect, it } from 'vitest'
import { applyCompositionContentEdit, type CompositionContent, type CompositionContentEdit, type CompositionContentNode } from '../../src/core/tools/compositionContent'
import { findCompositionNode } from '../../src/shared/composition/content'
import { createImageNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { webCompositionSchema } from '../../src/shared/contracts/course-project-v9/schema'

function element(id: string, children: CompositionContentNode[] = [], attributes: Record<string, string> = {}): CompositionContentNode {
  return { id, kind: 'element', tagName: 'div', attributes, children }
}

function fixture(): CompositionContent {
  const image = sceneNodeToCourseLayerItem(createImageNode({ id: 'original-image', assetId: 'photo-asset' }))
  if (image.kind !== 'native') throw new Error('invalid native fixture')
  return {
    doctype: 'html', assets: { photo: { assetId: 'photo-asset' } },
    root: element('root', [
      element('left', [
        { id: 'text-a', kind: 'text', text: '原说明' },
        element('nested', [{ id: 'nested-text', kind: 'text', text: '嵌套说明' }]),
        { id: 'text-b', kind: 'text', text: '第二段' },
      ], { id: 'visible-dom-id', class: 'card', style: 'display: grid; color: red !important; color: pink; content: "A;B: C"; --Ink: navy; background-image: url("data:image/svg+xml;utf8,<svg></svg>");' }),
      element('right', [{ id: 'text-c', kind: 'text', text: '第三段' }]),
      { id: 'document', kind: 'document', content: { blocks: [{ id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: '专业正文' }] } }] } },
      { id: 'native-image', kind: 'native', content: image.content },
      { id: 'simulation', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3,
        enabled: true, renderMode: 'dom', source: 'export function mount() {}', content: { values: {} }, assets: {} } },
    ]),
  }
}

function apply(content: CompositionContent, edit: CompositionContentEdit): CompositionContent {
  const result = applyCompositionContentEdit(content, edit)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.content
}

function children(content: CompositionContent, id: string): string[] {
  const node = findCompositionNode(content.root, id)
  if (node?.kind !== 'element') throw new Error('missing element')
  return node.children.map(child => child.id)
}

describe('formal composition content edits', () => {
  it('preserves long text, identities and assets while changing actual attributes and CSS without a second frame', () => {
    const original = fixture(), snapshot = structuredClone(original)
    const longText = '布局和内容都需要完整保留。'.repeat(12_000)
    const text = apply(original, { type: 'text', nodeId: 'text-a', text: longText })
    expect(findCompositionNode(text.root, 'text-a')).toEqual({ id: 'text-a', kind: 'text', text: longText })
    expect(findCompositionNode(text.root, 'document')).toBe(findCompositionNode(original.root, 'document'))
    expect(applyCompositionContentEdit(text, { type: 'text', nodeId: 'text-a', text: longText })).toEqual({ ok: true, content: text, changed: false })
    const attributed = apply(text, { type: 'attributes', nodeId: 'left', patch: { id: 'new-dom-id', class: null, title: '问题卡片' } })
    const styled = apply(attributed, { type: 'style', nodeId: 'left', patch: {
      color: 'blue', '--ink': 'green', position: 'absolute', left: 'calc(50% - 10px)', top: '20px', width: '320px', height: 'auto',
    } })
    const left = findCompositionNode(styled.root, 'left')!
    if (left.kind !== 'element') throw new Error('wrong node')
    expect(left).toMatchObject({ id: 'left', attributes: { id: 'new-dom-id', title: '问题卡片' } })
    expect(left.attributes.class).toBeUndefined()
    expect(left).not.toHaveProperty('frame')
    expect(left.attributes.style).toContain('content: "A;B: C";')
    expect(left.attributes.style).toContain('data:image/svg+xml;utf8,<svg></svg>')
    const dom = document.createElement('div'); dom.setAttribute('style', left.attributes.style!)
    expect(dom.style.color).toBe('blue')
    expect(dom.style.getPropertyPriority('color')).toBe('')
    expect(dom.style.display).toBe('grid')
    expect(dom.style.getPropertyValue('--Ink')).toBe('navy')
    expect(dom.style.getPropertyValue('--ink')).toBe('green')
    expect(dom.style.position).toBe('absolute')
    expect(dom.style.width).toBe('320px')
    expect(styled.assets).toBe(original.assets)
    expect(original).toEqual(snapshot)
  })

  it('reorders in the final parent sequence, moves across parents and refuses only actual cycles or invalid destinations', () => {
    const original = fixture()
    const ordered = apply(original, { type: 'move', nodeId: 'text-a', parentId: 'left', index: 2 })
    expect(children(ordered, 'left')).toEqual(['nested', 'text-b', 'text-a'])
    expect(applyCompositionContentEdit(ordered, { type: 'move', nodeId: 'text-a', parentId: 'left', index: 2 }))
      .toEqual({ ok: true, content: ordered, changed: false })
    const moved = apply(ordered, { type: 'move', nodeId: 'nested', parentId: 'right', index: 0 })
    expect(children(moved, 'left')).toEqual(['text-b', 'text-a'])
    expect(children(moved, 'right')).toEqual(['nested', 'text-c'])
    expect(findCompositionNode(moved.root, 'nested')).toBe(findCompositionNode(original.root, 'nested'))
    const cycle = applyCompositionContentEdit(moved, { type: 'move', nodeId: 'right', parentId: 'nested', index: 0 })
    expect(cycle).toMatchObject({ ok: false, changed: false, diagnostic: { code: 'layout-cycle' } })
    expect(cycle.content).toBe(moved)
    expect(applyCompositionContentEdit(moved, { type: 'move', nodeId: 'text-b', parentId: 'text-c', index: 0 }))
      .toMatchObject({ ok: false, diagnostic: { code: 'wrong-node-kind' } })
    // Moving to an ancestor is valid, unlike moving a container into its own descendant.
    const promoted = apply(moved, { type: 'move', nodeId: 'nested', parentId: 'root', index: 1 })
    expect(children(promoted, 'root')).toEqual(['left', 'nested', 'right', 'document', 'native-image', 'simulation'])
    const removed = apply(promoted, { type: 'remove', nodeId: 'nested' })
    expect(findCompositionNode(removed.root, 'nested-text')).toBeUndefined()
    expect(removed.assets).toBe(original.assets)
    expect(children(original, 'left')).toEqual(['text-a', 'nested', 'text-b'])
  })

  it('retains professional document/native contracts, rejects static edits of runtimes and preserves replacement identity', () => {
    const original = fixture()
    const body = '完整的专业正文。'.repeat(12_000)
    const documentEdited = apply(original, { type: 'document', nodeId: 'document', content: {
      blocks: [{ id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: body, style: { bold: true } }] } }],
    } })
    expect(findCompositionNode(documentEdited.root, 'document')).toMatchObject({ kind: 'document', content: {
      blocks: [{ id: 'paragraph', content: { inlines: [{ text: body, style: { bold: true } }] } }],
    } })
    const nativeEdited = apply(documentEdited, { type: 'native', nodeId: 'native-image', patch: { crop: { left: 0.1 } } })
    expect(findCompositionNode(nativeEdited.root, 'native-image')).toMatchObject({ id: 'native-image', kind: 'native', content: {
      nativeType: 'image', data: { assetId: 'photo-asset', crop: { left: 0.1, right: 0, top: 0, bottom: 0 } },
    } })
    expect(applyCompositionContentEdit(nativeEdited, { type: 'text', nodeId: 'simulation', text: '假静态画面' }))
      .toMatchObject({ ok: false, diagnostic: { code: 'wrong-node-kind', message: expect.stringContaining('动态区域') } })
    expect(applyCompositionContentEdit(nativeEdited, { type: 'text', nodeId: 'document', text: '不能丢掉正文结构' }))
      .toMatchObject({ ok: false, diagnostic: { code: 'wrong-node-kind' } })
    const duplicate = applyCompositionContentEdit(nativeEdited, { type: 'replace', nodeId: 'left', node: element('new-root', [
      { id: 'text-c', kind: 'text', text: '与其他区域冲突' },
    ]) })
    expect(duplicate).toMatchObject({ ok: false, changed: false, diagnostic: { code: 'invalid-content' } })
    expect(duplicate.content).toBe(nativeEdited)
    const replaced = apply(nativeEdited, { type: 'replace', nodeId: 'left', node: element('discarded-root-id', [
      { id: 'replacement-text', kind: 'text', text: '新内容' },
    ], { style: 'display:flex; gap:12px' }) })
    expect(findCompositionNode(replaced.root, 'left')).toMatchObject({ id: 'left', kind: 'element' })
    expect(findCompositionNode(replaced.root, 'discarded-root-id')).toBeUndefined()
    expect(findCompositionNode(replaced.root, 'text-a')).toBeUndefined()
    expect(findCompositionNode(replaced.root, 'text-c')).toBe(findCompositionNode(original.root, 'text-c'))
    expect(replaced.assets).toBe(original.assets)
    expect(webCompositionSchema.safeParse(replaced).success).toBe(true)
    expect(applyCompositionContentEdit(replaced, { type: 'remove', nodeId: 'root' }))
      .toMatchObject({ ok: false, diagnostic: { code: 'root-required' } })
  })
})
