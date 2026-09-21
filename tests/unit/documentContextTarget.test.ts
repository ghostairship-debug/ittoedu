import { describe, expect, it } from 'vitest'
import { freezeDocumentEditTarget } from '../../src/renderer/ui/chat/documentContextTarget'
import { validateContextualEditTarget } from '../../src/shared/document/contextualEditTarget'
import type { ContextualEditTarget } from '../../src/shared/document/ports'

const ref = { kind: 'file' as const, path: '/ws/notes.md' }
const version = { contentVersion: 'v1', attachments: [] }
function fixture() {
  let source = '标题正文'
  const contextual: ContextualEditTarget = { ref, baseVersion: version, epoch: 7, scope: 'selection', mode: 'source', source, revision: source, selection: null, ranges: [{ from: 0, to: 2, before: '标题' }], label: '所选源文' }
  const session = { ref, epoch: 7, getSnapshot: () => ({ source, disk: { version } }) }
  return { contextual, session, change: (next: string) => { source = next }, target: { name: 'notes.md', getEditor: () => ({ session } as never), getContextualEditTarget: () => contextual } }
}
describe('frozen document target', () => {
  it('copies and recursively freezes a range without changing the live observation', () => {
    const f = fixture(), frozen = freezeDocumentEditTarget(f.target, 'selection')
    f.contextual.ranges![0]!.from = 2
    expect(frozen.ranges).toEqual([{ from: 0, to: 2, before: '标题' }])
    expect(Object.isFrozen(frozen.ranges![0])).toBe(true)
    expect(Object.isFrozen(f.contextual)).toBe(false)
  })
  it('rejects changed source, including an edit outside the selected range', () => {
    const f = fixture(); f.change('标题新正文')
    expect(() => freezeDocumentEditTarget(f.target, 'selection')).toThrow('文档已改变')
  })
  it('rejects the same bytes after a close/reopen or attachment version change', () => {
    const f = fixture(), frozen = freezeDocumentEditTarget(f.target, 'selection')
    expect(() => validateContextualEditTarget(frozen, { ref, source: '标题正文', version, epoch: 8 })).toThrow('关闭或切换')
    expect(() => validateContextualEditTarget(frozen, { ref, source: '标题正文', version: { ...version, attachments: [{ relativePath: 'image.png', contentVersion: 'new' }] }, epoch: 7 })).toThrow('已改变')
  })
  it('whole-document scope is explicit and independent of a selected range', () => {
    const f = fixture(), frozen = freezeDocumentEditTarget(f.target, 'document')
    expect(frozen.scope).toBe('document')
    expect(frozen.ranges).toEqual([{ from: 0, to: 4, before: '标题正文' }])
  })
})
