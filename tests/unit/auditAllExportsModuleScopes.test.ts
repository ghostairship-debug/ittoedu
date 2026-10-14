// @vitest-environment node
import { expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import { webModuleCompilationInput, projectWebModuleGraph, webModuleGraphForDocument, type WebRuntimeData } from '../../src/components/web/moduleGraph'
import { authoredDocumentBootstrap, installAuthoredDocumentPrograms } from '../../src/components/web/authoredDocumentBootstrap'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { componentCompilationInputSchema } from '../../src/shared/workbench/componentCompilation'
import { resolveWebResourceBindings } from '../../src/components/web/resources'

it('CA037/216: the same authored module resolves each parser document import map independently through the real compiler and native ESM', async () => {
  const doc = (target: string) => `<script type="importmap">{"imports":{"lib":"./${target}.js"}}</script><script type="module" src="./shared.js"></script>`
  const child = doc('b'), data = { html: `<!doctype html><html><head>${doc('a')}</head><body><iframe sandbox="allow-scripts" srcdoc="${child.replaceAll('"', '&quot;')}"></iframe></body></html>`,
    modules: { 'shared.js': 'const workerUrl = new URL("./worker.js", import.meta.url); import { v } from "lib"; document.body.dataset.ownerValue = v;',
      'a.js': 'export const v="ROOT";', 'b.js': 'export const v="CHILD";', 'worker.js': 'postMessage(42);' } }
  data.modules['shared.js'] += 'document.body.dataset.workerUrl = workerUrl.href;'
  const prepared = webModuleCompilationInput(data)!
  expect(prepared.input.htmlModuleBindings).toBeUndefined()
  expect(prepared.input.htmlModuleDocuments!.map(doc => doc.bindings)).toEqual([{ lib: 'a.js' }, { lib: 'b.js' }])
  const cache = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const projected = await projectWebModuleGraph({ id: 'web', definitionId: 'web', data }, input => cache.compile(componentCompilationInputSchema.parse(input)))
  const unresolved = (projected.data as unknown as WebRuntimeData).moduleGraph!
  expect(unresolved.modules['__guoling_parser_doc_0/shared.js']!.code).toContain('guoling-module-url:__guoling_parser_doc_0/worker.js')
  const resolved = resolveWebResourceBindings(projected, () => undefined)
  const graph = (resolved.data as unknown as WebRuntimeData).moduleGraph!
  const root = webModuleGraphForDocument(graph)!, nested = webModuleGraphForDocument(graph, '0')!
  const rootEntry = root.modules[root.entries['1']!]!, childEntry = nested.modules[nested.entries['0:1']!]!
  expect(rootEntry.imports.map(imported => imported.path)).toEqual(['a.js'])
  expect(childEntry.imports.map(imported => imported.path)).toEqual(['__guoling_parser_doc_0/b.js'])
  expect(childEntry.code).not.toContain('guoling-module-url:')
  expect(rootEntry.moduleUrls).toEqual(['worker.js'])
  expect(childEntry.moduleUrls).toEqual(['__guoling_parser_doc_0/worker.js'])
  expect(root.modules['worker.js']).toBeDefined()
  expect(nested.modules['__guoling_parser_doc_0/worker.js']).toBeDefined()
  expect(childEntry.code.slice(childEntry.imports[0]!.start, childEntry.imports[0]!.end)).toBe('"lib"')
  expect(Object.keys(root.modules)).not.toContain('b.js')
  expect(Object.keys(nested.modules)).not.toContain('a.js')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(authoredDocumentBootstrap(resolved.data as unknown as WebRuntimeData, { nonce: 'scope-map', instanceId: 'web', resources: {},
      bridge: programs => `(${installAuthoredDocumentPrograms.toString()})(${JSON.stringify(programs)});` }))
    await page.waitForFunction(() => document.body.dataset.ownerValue === 'ROOT')
    const child = page.frames().find(frame => frame !== page.mainFrame())!
    await child.waitForFunction(() => document.body.dataset.ownerValue === 'CHILD')
    expect(await page.evaluate(() => document.body.dataset.ownerValue)).toBe('ROOT')
    expect(await child.evaluate(() => document.body.dataset.ownerValue)).toBe('CHILD')
    for (const [frame, path] of [[page.mainFrame(), 'worker.js'], [child, '__guoling_parser_doc_0/worker.js']] as const) {
      expect(await frame.evaluate(path => {
        const map = (window as unknown as Record<string, Record<string, string>>).__guoling_module_urls_web!
        return { installed: map[path], used: document.body.dataset.workerUrl }
      }, path)).toEqual({ installed: expect.stringMatching(/^blob:/), used: expect.stringMatching(/^blob:/) })
      expect(await frame.evaluate(path => (window as unknown as Record<string, Record<string, string>>).__guoling_module_urls_web![path]
        === document.body.dataset.workerUrl, path)).toBe(true)
    }
  } finally { await browser.close() }
  expect(data.modules['shared.js']).toContain('from "lib"')
}, 20_000)
