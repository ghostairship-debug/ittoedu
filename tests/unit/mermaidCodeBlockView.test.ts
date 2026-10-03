import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { EditorState } from 'prosemirror-state'
import { documentEditorSchema as schema } from '../../src/renderer/document/editorSchema'
import { MermaidCodeBlockView } from '../../src/renderer/document/mermaidCodeBlockView'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg data-id="${id}" xmlns="http://www.w3.org/2000/svg" width="100"><text>ok</text></svg>` })),
  },
}))

function codeBlock(code: string, language: string) {
  return schema.nodes.code_block.create({ id: 'blk-mermaid', data: { type: 'code', code, language } }, schema.text(code))
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { document.body.innerHTML = '' })

describe('MermaidCodeBlockView', () => {
  it('renders SVG preview for mermaid code', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const node = codeBlock('flowchart LR\n  A --> B', 'mermaid')
    const state = EditorState.create({ doc: schema.nodes.doc.create(null, [node]) })
    const view = new EditorView(host, {
      state,
      nodeViews: { code_block: (n, v) => new MermaidCodeBlockView(n, v as EditorView) },
    })
    await vi.waitFor(() => {
      const preview = host.querySelector<HTMLElement>('.mermaid-preview')
      expect(preview).toBeTruthy()
      expect(preview!.dataset.state).toBe('ready')
      expect(preview!.querySelector('svg')).toBeTruthy()
    }, { timeout: 3000 })
    view.destroy()
    host.remove()
  })

  it('leaves empty preview when source has no mermaid keyword', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const node = codeBlock('just some\nplain text\nno diagram keyword here', 'mermaid')
    const state = EditorState.create({ doc: schema.nodes.doc.create(null, [node]) })
    const view = new EditorView(host, {
      state,
      nodeViews: { code_block: (n, v) => new MermaidCodeBlockView(n, v as EditorView) },
    })
    // Give microtasks a chance to run.
    await new Promise(resolve => setTimeout(resolve, 50))
    const preview = host.querySelector<HTMLElement>('.mermaid-preview')
    expect(preview).toBeTruthy()
    expect(preview!.dataset.state).toBe('empty')
    expect(preview!.querySelector('svg')).toBeNull()
    view.destroy()
    host.remove()
  })

  it('marks preview with error state when mermaid.render rejects', async () => {
    const mermaid = (await import('mermaid')).default as unknown as { render: ReturnType<typeof vi.fn> }
    mermaid.render.mockRejectedValueOnce(new Error('boom'))
    const host = document.createElement('div')
    document.body.append(host)
    const node = codeBlock('flowchart LR\n  A --> B', 'mermaid')
    const state = EditorState.create({ doc: schema.nodes.doc.create(null, [node]) })
    const view = new EditorView(host, {
      state,
      nodeViews: { code_block: (n, v) => new MermaidCodeBlockView(n, v as EditorView) },
    })
    await vi.waitFor(() => {
      const preview = host.querySelector<HTMLElement>('.mermaid-preview')
      expect(preview!.dataset.state).toBe('error')
      expect(preview!.textContent).toContain('boom')
    }, { timeout: 3000 })
    view.destroy()
    host.remove()
  })

  it('acts as a plain pre/code for non-mermaid languages', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const node = codeBlock('console.log(1)', 'javascript')
    const state = EditorState.create({ doc: schema.nodes.doc.create(null, [node]) })
    const view = new EditorView(host, {
      state,
      nodeViews: { code_block: (n, v) => new MermaidCodeBlockView(n, v as EditorView) },
    })
    expect(host.querySelector('.mermaid-preview')).toBeNull()
    const pre = host.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre!.querySelector('code')!.textContent).toBe('console.log(1)')
    view.destroy()
    host.remove()
  })
})
