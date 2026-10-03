import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg data-mermaid-id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text>flow</text></svg>` })),
  },
}))

const mdSource = `# Demo

正文前段。

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

正文后段。
`

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { document.body.innerHTML = '' })

describe('Markdown editor mermaid integration', () => {
  it('parses the .md source into a code block and the editor mounts a mermaid preview above it', async () => {
    const parsed = parseDocumentMarkdown(mdSource, { createId: () => crypto.randomUUID(), target: 'file', resolveImage: () => { throw new Error('unused') } })
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    const codeBlocks = parsed.document.content.blocks.filter(block => block.type === 'code')
    expect(codeBlocks).toHaveLength(1)
    expect((codeBlocks[0] as { language?: string }).language).toBe('mermaid')
    const host = document.createElement('div')
    document.body.append(host)
    const editor = createLayoutEditor(host, {
      document: parsed.document,
      revision: 'r1',
      change: () => true,
      undo: () => {}, redo: () => {}, diagnostic: () => {},
    })
    await vi.waitFor(() => {
      const preview = host.querySelector<HTMLElement>('.mermaid-preview')
      expect(preview).toBeTruthy()
      expect(preview!.dataset.state).toBe('ready')
      expect(preview!.querySelector('svg')).toBeTruthy()
    }, { timeout: 3000 })
    // Source code must still be editable in the same block.
    const pre = host.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre!.textContent).toContain('flowchart LR')
    editor.destroy()
    host.remove()
  })
})
