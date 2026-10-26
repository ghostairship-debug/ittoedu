// @vitest-environment node
import { expect, it } from 'vitest'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'

const inertPreload = '(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);function n(e){if(e.ep)return;e.ep=!0;let n={credentials:`same-origin`};fetch(e.href,n)}})();'

it('keeps the audited polyfill exception inside its own subtree and reports a following sibling fetch', () => {
  const onlyPolyfill = extractHtmlResources({html: `<script>${inertPreload}</script>`})
  expect(onlyPolyfill.diagnostics.filter(x => x.code === 'unsupported-network-sink')).toHaveLength(0)
  const source = `<script>${inertPreload}function load(){fetch("https://example.test/data.json")};load();</script>`
  const result = extractHtmlResources({html: source})
  expect(result.html).toBe(source)
  expect(result.diagnostics.filter(x => x.message.startsWith('脚本网络/动态调用保留原样执行: fetch'))).toHaveLength(1)
})

it('keeps each script resource context distinct while retaining literal nested HTML and following resource writes', () => {
  const first = 'document.getElementById("root").innerHTML = \'<img src="nested.png">\'; const asset = new Image(); asset.src="https://media.example/picture.png";'
  const second = 'const asset = new Audio(); asset.src="https://media.example/sound.mp3";'
  const result = extractHtmlResources({html: `<div id="root"></div><script>${first}</script><script>${second}</script>`,
    siblingFiles: new Map([['nested.png', new Uint8Array([1, 2, 3])]])})
  expect(result.localReferences).toContain('nested.png')
  expect(result.resources).toContainEqual(expect.objectContaining({mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3])}))
  expect(result.html).toContain('cw-resource:')
  expect(result.remoteReferences).toContainEqual(expect.objectContaining({url: 'https://media.example/picture.png', usage: 'image'}))
  expect(result.remoteReferences).toContainEqual(expect.objectContaining({url: 'https://media.example/sound.mp3', usage: 'media'}))
  expect(result.diagnostics.some(x => x.code === 'script-rewrite')).toBe(false)
})
