import { afterEach, expect, it, vi } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { EditorState } from 'prosemirror-state'
import { documentEditorSchema as schema } from '../../src/renderer/document/editorSchema'

const api = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>恢复成功</text></svg>' })) }))
vi.mock('mermaid', () => ({ default: api }))
afterEach(() => { document.body.replaceChildren(); vi.resetModules(); vi.clearAllMocks() })
it('clears a failed loader initialization cache and retries explicitly without editing or duplicating source', async () => {
  api.initialize.mockImplementationOnce(() => { throw Error('chunk initialization failed') }).mockImplementation(() => {})
  const { MermaidCodeBlockView } = await import('../../src/renderer/document/mermaidCodeBlockView')
  const host = document.createElement('div'); document.body.append(host)
  const code = '%% comment\nsequenceDiagram\n A->>B: hi'
  const node = schema.nodes.code_block.create({ id: 'code', data: { type: 'code', code, language: 'mermaid' } }, schema.text(code))
  const view = new EditorView(host, { state: EditorState.create({ doc: schema.nodes.doc.create(null, [node]) }), nodeViews: { code_block: (node, view) => new MermaidCodeBlockView(node, view) } })
  try {
    await vi.waitFor(() => expect(host.querySelector('.mermaid-preview')?.getAttribute('data-state')).toBe('error'))
    expect(api.initialize).toHaveBeenCalledOnce(); expect(api.render).not.toHaveBeenCalled()
    const retry = host.querySelector<HTMLButtonElement>('.mermaid-preview button')!; expect(retry).toBeTruthy(); retry.click()
    await vi.waitFor(() => expect(host.querySelector('.mermaid-preview')?.getAttribute('data-state')).toBe('ready'))
    expect(api.initialize).toHaveBeenCalledTimes(2); expect(api.render).toHaveBeenCalledOnce()
    expect(view.state.doc.textContent).toBe(code); expect(host.querySelectorAll('code')).toHaveLength(1)
  } finally { view.destroy() }
})
