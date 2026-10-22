import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentBlock } from '../../src/shared/document/content'
import { createFlowObjectVersions } from '../../src/renderer/ui/flow/flowObjectVersions'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'

const layout = { readingWidth: 860, wideContentWidth: 1100 }
const blocks: DocumentBlock[] = [{ id: 'a', type: 'course-instance' }, { id: 'b', type: 'course-instance' }]
function fixture(): CourseProjectV10 {
  const frame = { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] }
  return { schemaVersion: 11, id: 'project', title: 'Flow', revision: 0, rootIds: ['flow'], global: { underlay: [], overlay: [] }, assets: {},
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'large-body'.repeat(100_000) } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['a', 'b', 'paragraph'], container: { kind: 'flow' } },
      a: { id: 'a', definitionId: 'source', data: {}, frame }, b: { id: 'b', definitionId: 'source', data: {}, frame: structuredClone(frame) },
      paragraph: { id: 'paragraph', definitionId: 'text', data: { content: { inlines: [{ type: 'text', text: 'old' }] } } } },
  } as unknown as CourseProjectV10
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('Flow object presentation versions', () => {
  it('keeps Source mounts through an unrelated text ACK and fresh transport object identities', () => {
    const read = createFlowObjectVersions(), first = fixture(), a = read(first, blocks, layout, 860, 'flow')
    const next = structuredClone(first)
    next.instances.paragraph.data = { content: { inlines: [{ type: 'text', text: 'next' }] } }
    expect(read(next, blocks, layout, 860, 'flow').revision).toBe(a.revision)
    // Compiled code and resource bytes are consumed by the existing World, not a PM wrapper.
    next.definitions.source.implementation = { kind: 'source', language: 'javascript', source: 'changed executable body' }
    expect(read(next, blocks, layout, 860, 'flow').revision).toBe(a.revision)
  })

  it('never reads or serializes the executable body to calculate a PM presentation version', () => {
    const project = fixture(), implementation = project.definitions.source.implementation
    Object.defineProperty(implementation, 'source', { enumerable: true, get() { throw new Error('PM touched executable source') } })
    expect(() => createFlowObjectVersions()(project, blocks, layout, 860, 'flow')).not.toThrow()
  })

  it('compares with the consumer accepted snapshot when the producer skips intermediate versions', () => {
    const read = createFlowObjectVersions(), project = fixture(), a = read(project, blocks, layout, 860, 'flow')
    const second: CourseProjectV10 = { ...project, instances: { ...project.instances, a: { ...project.instances.a, style: { borderColor: '#ff0000' } } } }
    const b = read(second, blocks, layout, 860, 'flow'), aAtB = b.forBlock(blocks[0]!)
    const third = { ...second, instances: { ...second.instances, b: { ...second.instances.b, style: { opacity: 0.5 } } } }
    const c = read(third, blocks, layout, 860, 'flow')
    expect([...c.changedSince(a.revision)].sort()).toEqual(['a', 'b'])
    expect([...c.changedSince(b.revision)]).toEqual(['b'])
    expect(b.forBlock(blocks[0]!)).toBe(aAtB)
  })

  it('lets PM reflow reading-group text without refreshing the parent style callback', () => {
    const project = fixture(), read = createFlowObjectVersions()
    project.instances.flow.childIds = ['group']
    project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['paragraph'], style: { display: 'flex', gap: 12 } }
    const group: DocumentBlock[] = [{ id: 'group', type: 'course-instance', blocks: [{ id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'old' }] } }] }]
    const a = read(project, group, layout, 860, 'flow')
    const next = structuredClone(project)
    next.instances.paragraph.data = { content: { inlines: [{ type: 'text', text: 'longer paragraph' }] } }
    expect(read(next, group, layout, 860, 'flow').revision).toBe(a.revision)
    next.instances.group.style = { display: 'flex', gap: 24 }
    expect([...read(next, group, layout, 860, 'flow').changedSince(a.revision)]).toEqual(['group'])
  })

  it('keeps asset and theme content updates with the existing World owner', () => {
    const project = fixture(), read = createFlowObjectVersions(), a = read(project, blocks, layout, 860, 'flow')
    const next = structuredClone(project)
    next.assets.image = { id: 'image', width: 400 } as any
    next.theme = { colors: { primary: '#ff0000' } } as any
    next.designTokens = { accent: '#00ff00' } as any
    expect(read(next, blocks, layout, 860, 'flow').revision).toBe(a.revision)
  })

  it('refreshes an opaque Source caption even when its projected document block is unchanged', () => {
    const project = fixture(), read = createFlowObjectVersions(), a = read(project, blocks, layout, 860, 'flow')
    const next = structuredClone(project)
    next.instances.a.flowLayout = { width: 'content-width', caption: { inlines: [{ type: 'text', text: 'New caption' }] } }
    expect([...read(next, blocks, layout, 860, 'flow').changedSince(a.revision)]).toEqual(['a'])
  })

  it('observes a retained Flow container moving into the formal global plane', () => {
    const project = fixture(), read = createFlowObjectVersions()
    project.definitions.web = { ...project.definitions.source, id: 'web', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances.a.definitionId = 'web'
    const a = read(project, blocks, layout, 860, 'flow'), next = structuredClone(project)
    next.rootIds = []
    next.global.underlay = ['flow']
    expect([...read(next, blocks, layout, 860, 'flow').changedSince(a.revision)]).toEqual(['a'])
  })

  it('updates only the changed PM object hosts, including when an intermediate render was never consumed', () => {
    const project = fixture(), read = createFlowObjectVersions(), first = read(project, blocks, layout, 860, 'flow')
    const element = document.createElement('div'); document.body.append(element)
    const renderObject = vi.fn((block: DocumentBlock, host: HTMLElement) => { const node = document.createElement('span'); node.dataset.objectId = block.id; host.append(node) })
    const base = { document: { content: { blocks }, resources: { assets: [], components: [] } }, revision: '0', presentation: 'flow' as const,
      change: () => true, diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), renderObject }
    const editor = createLayoutEditor(element, { ...base, objectRevision: first.revision, objectRevisionFor: first.forBlock, objectChangedIds: first.changedSince })
    try {
      const a = element.querySelector('[data-object-id="a"]'), b = element.querySelector('[data-object-id="b"]')
      const second: CourseProjectV10 = { ...project, instances: { ...project.instances, a: { ...project.instances.a, style: { opacity: 0.5 } } } }
      const next = read(second, blocks, layout, 860, 'flow')
      editor.update({ ...base, revision: '1', objectRevision: next.revision, objectRevisionFor: next.forBlock, objectChangedIds: next.changedSince })
      expect(element.querySelector('[data-object-id="a"]')).not.toBe(a)
      expect(element.querySelector('[data-object-id="b"]')).toBe(b)
      expect(renderObject.mock.calls.map(call => call[0].id)).toEqual(['a', 'b', 'a'])
      const third: CourseProjectV10 = { ...second, instances: { ...second.instances, a: { ...second.instances.a, style: { opacity: 0.6 } } } }
      read(third, blocks, layout, 860, 'flow') // Deliberately not passed to the consumer.
      const fourth = { ...third, instances: { ...third.instances, b: { ...third.instances.b, style: { opacity: 0.2 } } } }
      const latest = read(fourth, blocks, layout, 860, 'flow')
      editor.update({ ...base, revision: '3', objectRevision: latest.revision, objectRevisionFor: latest.forBlock, objectChangedIds: latest.changedSince })
      expect(renderObject.mock.calls.map(call => call[0].id)).toEqual(['a', 'b', 'a', 'a', 'b'])
    } finally { editor.destroy() }
  })
})
