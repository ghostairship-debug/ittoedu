// @vitest-environment node
import { expect, it } from 'vitest'
import { analyzeHtmlResources } from '../../src/main/workbench/htmlImport/htmlResourceAnalysis'

it('settles actual source analysis outside the caller event loop and preserves proven resource dependencies', async () => {
  let turned = false
  const turn = new Promise<void>(resolve => setImmediate(() => { turned = true; resolve() }))
  const result = await analyzeHtmlResources({ html: '<img src="https://media.example/photo.png"><link rel="stylesheet" href="theme.css">',
    siblingFiles: new Map([['theme.css', new TextEncoder().encode('p{background:url(https://media.example/background.png)}')]]) })
  expect(turned).toBe(true)
  await turn
  expect(result.localReferences).toContain('theme.css')
  expect(result.remoteReferences).toContainEqual(expect.objectContaining({ url: 'https://media.example/photo.png', usage: 'image' }))
  expect(result.remoteReferences).toContainEqual(expect.objectContaining({ url: 'https://media.example/background.png', usage: 'image' }))
})

it('settles a worker analysis error and permits a later independent request', async () => {
  await expect(analyzeHtmlResources({ html: null as unknown as string })).rejects.toThrow('HTML 资源分析未完成')
  expect((await analyzeHtmlResources({ html: '<p>still usable</p>' })).html).toContain('<p>still usable</p>')
})
