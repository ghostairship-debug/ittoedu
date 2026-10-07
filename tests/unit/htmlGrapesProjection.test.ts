import { expect, it } from 'vitest'
import { createHtmlGrapesProjection } from '../../src/renderer/documentFiles/html/htmlGrapesProjection'
import { applyHtmlSourceEdit } from '../../src/main/workbench/htmlPreview/htmlSourceEdits'
import { inspectHtmlSource, flattenHtmlSourceNodes } from '../../src/shared/html/htmlSourceStructure'
import type { HtmlSourceEditCommand } from '../../src/shared/html/sourceEditCommands'

it('projects real GJS move and style into local source commands without add/remove or replay writes', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const source = '<html><head><style>p{margin:4px}</style></head><body><main><p id="a">same</p><script>window.keep=1</script><p id="b">same</p></main></body></html>'
  let current = source
  const commands: HtmlSourceEditCommand[] = []
  const projection = createHtmlGrapesProjection(container, { select() {}, async commit(command) {
    commands.push(command)
    const result = applyHtmlSourceEdit(current, command)
    expect(result.ok).toBe(true)
    if (result.ok) current = result.source
  } })
  try {
    projection.project(source)
    expect(commands).toHaveLength(0)
    const nodes = flattenHtmlSourceNodes(inspectHtmlSource(source).roots)
    const a = nodes.find(node => node.attributes.id === 'a')!, main = nodes.find(node => node.name === 'main')!
    projection.move(a.key, main.key, 2)
    await Promise.resolve()
    expect(commands).toHaveLength(1)
    expect(commands[0].type).toBe('move')
    expect(current).toContain('<script>window.keep=1</script><p id="b">same</p><p id="a">same</p>')
    projection.project(current)
    const b = flattenHtmlSourceNodes(inspectHtmlSource(current).roots).find(node => node.attributes.id === 'b')!
    projection.style(b.key, { color: 'red' })
    await Promise.resolve()
    expect(commands).toHaveLength(2)
    expect(current).toContain('<p id="b" style="color: red;">same</p>')
    projection.project(source) // canonical undo, then redo/ACK, are projection only
    projection.project(current)
    expect(commands).toHaveLength(2)
    expect(projection.editor.UndoManager.getStack().length).toBe(0)
  } finally { projection.dispose(); container.remove() }
})

it('remaps a style-then-move gesture within one exact source batch', () => {
  const source = '<main><p id="a">A</p><p id="b">B</p></main>'
  const nodes = flattenHtmlSourceNodes(inspectHtmlSource(source).roots)
  const a = nodes.find(node => node.attributes.id === 'a')!, main = nodes.find(node => node.name === 'main')!
  expect(applyHtmlSourceEdit(source, { type: 'batch', commands: [
    { type: 'style', target: a.address!, patch: { width: '140px' } },
    { type: 'move', target: a.address!, parent: main.address!, index: 1 },
  ] })).toMatchObject({ ok: true, source: '<main><p id="b">B</p><p id="a" style="width: 140px;">A</p></main>' })
})

it('moves a root sibling in ordinary fragment HTML without introducing document wrappers', async () => {
  const container = document.createElement('div'); document.body.append(container)
  let source = '<p id="a">A</p><p id="b">B</p>'
  let transactions = 0
  const projection = createHtmlGrapesProjection(container, { select() {}, async commit(command) {
    transactions++
    const result = applyHtmlSourceEdit(source, command)
    if (!result.ok) throw new Error(result.message)
    source = result.source
  } })
  try {
    projection.project(source)
    const nodes = flattenHtmlSourceNodes(inspectHtmlSource(source).roots)
    projection.move(nodes.find(node => node.attributes.id === 'a')!.key, nodes.find(node => node.name === 'body')!.key, 1)
    await Promise.resolve()
    expect(source).toBe('<p id="b">B</p><p id="a">A</p>')
    expect(transactions).toBe(1)
  } finally { projection.dispose(); container.remove() }
})
