// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error jsdom is a Vitest-only fixture and does not ship declarations here.
import { JSDOM } from 'jsdom'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import type { HtmlPreviewEditContext } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import type { HtmlSourceEditCommand } from '../../src/shared/html/sourceEditCommands'
import { inspectHtmlSource, flattenHtmlSourceNodes } from '../../src/shared/html/htmlSourceStructure'
import { applyHtmlSourceEdit } from '../../src/main/workbench/htmlPreview/htmlSourceEdits'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('edits ordinary two-column HTML through its document writer and retains scope, structure and live data after save/reopen', async () => {
  const source = await fs.readFile(path.resolve('tests/fixtures/html-source-edit/two-column.html'), 'utf8')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-html-deep-')); roots.push(root)
  const filename = path.join(root, 'garden.html'); await fs.writeFile(filename, source)
  const host = new DocumentHostService(path.join(root, 'journal'))
  let snapshot = await host.open(filename)
  if (snapshot.binding.kind !== 'file') throw new Error('file binding required')
  const lease = { leaseId: 'lease', loadId: 'load', documentId: snapshot.documentId, epoch: snapshot.epoch,
    revision: snapshot.revision, bindingVersion: snapshot.binding.bindingVersion, url: 'preview://test' }
  const service = new HtmlSourceEditService({ readDocument: id => host.internalAPI.read(id),
    execute: operation => host.internalAPI.dispatch(operation), withFileAccess: work => host.fileCoordinator.withFileAccess(work) })
  let op = 0
  const apply = async (make: (source: string) => HtmlSourceEditCommand) => {
    const context: HtmlPreviewEditContext = { lease, tabId: 'tab', snapshot, bindingPath: filename,
      rootRealPath: root, entryRealPath: filename }
    if (snapshot.model.kind !== 'text') throw new Error('text model')
    const result = await service.editSource({ type: 'html-preview.edit-source', operationId: `edit-${op++}`,
      documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      bindingVersion: lease.bindingVersion, leaseId: lease.leaseId, loadId: lease.loadId,
      command: make(snapshot.model.source) }, context)
    expect(result).toMatchObject({ status: 'applied', reload: true })
    snapshot = await host.internalAPI.read(snapshot.documentId)
  }
  await apply(current => {
    const rule = inspectHtmlSource(current).rules.find(rule => rule.selector === 'main' && rule.context.length === 0)!
    return { type: 'stylesheet', target: rule.address, patch: { 'grid-template-columns': '2fr 1fr' } }
  })
  await apply(current => {
    const rule = inspectHtmlSource(current).rules.find(rule => rule.selector === '.card' && rule.context.length === 0)!
    return { type: 'stylesheet', target: rule.address, patch: { background: '#fff8e6' } }
  })
  await apply(current => {
    const nodes = flattenHtmlSourceNodes(inspectHtmlSource(current).roots)
    return { type: 'style', target: nodes.find(node => node.attributes.id === 'right')!.address!, patch: { padding: '32px' } }
  })
  await apply(current => {
    const nodes = flattenHtmlSourceNodes(inspectHtmlSource(current).roots)
    return { type: 'move', target: nodes.find(node => node.attributes.id === 'right')!.address!,
      parent: nodes.find(node => node.attributes.id === 'garden')!.address!, index: 0 }
  })
  await apply(current => ({ type: 'data', target: inspectHtmlSource(current).data[0]!.address,
    path: ['title'], value: '十四天观察计划' }))
  await host.saveToPath(snapshot.documentId)
  const reopened = await new DocumentHostService(path.join(root, 'reopen')).open(filename)
  expect(reopened.dirty).toBe(false)
  if (reopened.model.kind !== 'text') throw new Error('text model')
  const reopenedSource = reopened.model.source
  const structure = inspectHtmlSource(reopenedSource)
  const nodes = flattenHtmlSourceNodes(structure.roots)
  const garden = nodes.find(node => node.attributes.id === 'garden')!
  expect(garden.children.map(node => node.attributes.id)).toEqual(['right', 'left'])
  expect(structure.rules.find(rule => rule.selector === 'main' && !rule.context.length)?.declarations).toContain('grid-template-columns: 2fr 1fr')
  expect(structure.rules.find(rule => rule.selector === 'main' && rule.context.length)?.declarations).toContain('grid-template-columns:1fr')
  expect(nodes.find(node => node.attributes.id === 'left')?.attributes.style).toBeUndefined()
  expect(nodes.find(node => node.attributes.id === 'right')?.attributes.style).toContain('padding: 32px')
  expect(structure.rules.find(rule => rule.selector === '.card' && !rule.context.length)?.declarations).toContain('background: #fff8e6')
  const executable = source.slice(source.lastIndexOf('<script>'), source.lastIndexOf('</script>') + '</script>'.length)
  expect(reopenedSource).toContain(executable)
  const dom = new JSDOM(reopenedSource, { runScripts: 'dangerously' }) as { window: Window & { close(): void } }
  expect(dom.window.document.querySelector('#live-title')?.textContent).toBe('十四天观察计划')
  expect(dom.window.getComputedStyle(dom.window.document.querySelector('#left')!).backgroundColor).toBe('rgb(255, 248, 230)')
  expect(dom.window.getComputedStyle(dom.window.document.querySelector('#right')!).padding).toBe('32px')
  dom.window.document.querySelector<HTMLButtonElement>('#next-day')!.click()
  expect(dom.window.document.querySelector('#days')?.textContent).toBe('1')
  dom.window.close()
})

it('changes only real attribute/text spans and keeps an unknown program under source ownership', () => {
  const source = '<!doctype html><html><body><div id="a" class=\'card\' title="A &amp; B">前文 <b>重点</b> 后文</div><script>document.body.append(document.createTextNode("dynamic"))</script></body></html>'
  const nodes = flattenHtmlSourceNodes(inspectHtmlSource(source).roots)
  const target = nodes.find(node => node.attributes.id === 'a')!
  const attributes = applyHtmlSourceEdit(source, { type: 'attributes', target: target.address!, patch: { class: 'card chosen', title: null } })
  expect(attributes.ok).toBe(true)
  if (!attributes.ok) return
  expect(attributes.source).toContain("class='card chosen'")
  expect(attributes.source).not.toContain('title=')
  const text = nodes.find(node => node.kind === 'text' && node.value === '前文 ')!
  const edited = applyHtmlSourceEdit(source, { type: 'text', target: text.address!, text: '长文 & <内容> ' })
  expect(edited.ok && edited.source).toContain('长文 &amp; &lt;内容&gt; <b>重点</b> 后文')
  const executable = nodes.find(node => node.name === 'script')!
  expect(executable.sourceOnly).toBe(true)
  expect(inspectHtmlSource(source).data).toHaveLength(0)
  expect(applyHtmlSourceEdit(source, { type: 'text', target: executable.address!, text: 'static' })).toMatchObject({ ok: false, reason: 'not-editable' })
  const crlf = '<div>第一行\r\n第二行</div>\r\n'
  const crlfText = flattenHtmlSourceNodes(inspectHtmlSource(crlf).roots).find(node => node.kind === 'text')!
  const lineEdit = applyHtmlSourceEdit(crlf, { type: 'text', target: crlfText.address!, text: '新第一行\n新第二行' })
  expect(lineEdit.ok && lineEdit.source).toBe('<div>新第一行\r\n新第二行</div>\r\n')
})

it('retains CSS values with strings and data URLs and targets a nested media rule without expanding scope', () => {
  const source = '<style>.card { --info:"a;b"; background:url("data:image/svg+xml;a;b"); padding:8px; } @media (max-width:600px) { .card { padding:4px; } }</style><div class="card">A</div><div class="card">B</div>'
  const rules = inspectHtmlSource(source).rules
  const result = applyHtmlSourceEdit(source, { type: 'stylesheet', target: rules[1]!.address, patch: { padding: '12px' } })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(inspectHtmlSource(result.source).rules[0]!.declarations).toBe(rules[0]!.declarations)
  expect(inspectHtmlSource(result.source).rules[1]!.context).toEqual(['@media (max-width:600px)'])
  expect(inspectHtmlSource(result.source).rules[1]!.declarations).toContain('padding: 12px')
})
