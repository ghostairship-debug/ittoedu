// @vitest-environment jsdom
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'
import { readHtmlClosure } from '../../src/main/workbench/htmlImport/readHtmlClosure'
import { validateHtmlImport } from '../../src/main/workbench/htmlImport/validateHtmlImport'

const png = Uint8Array.of(137, 80, 78, 71, 1, 2, 3, 4)
const uri = `data:image/png;base64,${Buffer.from(png).toString('base64')}`

describe('HTML import closure', () => {
  it('decodes JavaScript literals and safely re-encodes their runtime values', () => {
    const escaped = uri.replace('data:', '\\x64ata:')
    const result = extractHtmlResources({ html: `<script>const x = ''; const image = {}; image.src = '${escaped}'; image.poster = \`${uri}\`; const c = \`prefix\${x}${uri}\`;</script>` })
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.origins).toHaveLength(2)
    const code = result.html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(new Function(`${code}; return [image.src, image.poster];`)()).toEqual([`cw-resource:${result.resources[0]?.key}`, `cw-resource:${result.resources[0]?.key}`])
    expect(code).toContain(`prefix\${x}${uri}`)
    expect(validateHtmlImport(result)).toEqual([])
  })

  it('keeps rewritten inline JavaScript intact in a real HTML parser', () => {
    const html = `<script>const image = {}; image.src = '${uri} \\x3c/script><p id="injected">'; const x = image.src; window.finished = true;</script>`
    const result = extractHtmlResources({ html })
    expect(validateHtmlImport(result)).toEqual([])
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    expect(document.querySelector('#injected')).toBeNull()
    expect(document.querySelectorAll('script')).toHaveLength(1)
    const source = document.querySelector('script')?.textContent ?? ''
    const state: Record<string, unknown> = {}
    expect(new Function('window', `${source}; return [x, window.finished];`)(state)).toEqual([`cw-resource:${result.resources[0]?.key} </script><p id="injected">`, true])
  })

  it('keeps the HTML parser out of script escaped-comment mode after rewriting', () => {
    const html = `<script>const image = {}; image.src = '${uri} \\x3c!-- \\x3cscript>'; const x = image.src; window.finished = true;</script><p id="after">after</p>`
    const result = extractHtmlResources({ html })
    expect(validateHtmlImport(result)).toEqual([])
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    expect(document.querySelector('#after')?.textContent).toBe('after')
    const source = document.querySelector('script')?.textContent ?? ''
    const state: Record<string, unknown> = {}
    expect(new Function('window', `${source}; return [x, window.finished];`)(state)).toEqual([`cw-resource:${result.resources[0]?.key} <!-- <script>`, true])
    expect(source).toContain('\\u003c!-- \\u003cscript>')
  })

  it('fails on invalid scripts and external module graphs without scanning as success', () => {
    const invalid = extractHtmlResources({ html: `<script>const = '${uri}'</script>` })
    expect(invalid.resources).toEqual([])
    expect(validateHtmlImport(invalid).map(error => error.code)).toContain('script-parse')
    const module = extractHtmlResources({ html: '<script type="module">import "./dependency.js"</script>' })
    expect(validateHtmlImport(module).map(error => error.code)).toContain('unsupported-module-graph')
  })

  it('preserves unused resource-looking strings and visible text', () => {
    const result = extractHtmlResources({ html: `<script>const caption=${JSON.stringify(uri)};label.textContent=caption;</script>` })
    expect(validateHtmlImport(result)).toEqual([])
    expect(result.resources).toEqual([])
    const label = { textContent: '' }
    const source = result.html.match(/<script>([\s\S]*?)<\/script>/)![1]
    new Function('label', source)(label)
    expect(label.textContent).toBe(uri)
  })

  it('keeps non-executable JSON data and rejects direct network loaders', () => {
    const data = extractHtmlResources({ html: `<script type="application/json">{"picture":"${uri}"}</script>` })
    expect(data.resources).toEqual([])
    expect(data.html).toContain(uri)
    const network = extractHtmlResources({ html: '<script>fetch("https://example.test/data.json")</script>' })
    expect(validateHtmlImport(network).map(error => error.code)).toContain('unsupported-network-sink')
  })

  it('classifies member network calls and element URL assignments as sinks', () => {
    const remote = extractHtmlResources({ html: '<script>window.fetch("https://cdn.example/api"); image.src="https://cdn.example/pic.png";</script>' })
    expect(validateHtmlImport(remote).map(error => error.code)).toEqual(expect.arrayContaining(['unsupported-network-sink', 'remote-resource']))
    const padded = extractHtmlResources({ html: '<script>image.src="  https://cdn.example/pic.png";</script>' })
    expect(validateHtmlImport(padded).map(error => error.code)).toContain('remote-resource')
    const mixedSrcset = extractHtmlResources({ html: `<script>image.srcset="${uri} 1x, https://cdn.example/pic.png 2x";</script>` })
    expect(validateHtmlImport(mixedSrcset).map(error => error.code)).toContain('remote-resource')
    const missing = extractHtmlResources({ html: '<script>image.src="picture.png";</script>' })
    expect(validateHtmlImport(missing).map(error => error.code)).toContain('missing-relative-resource')
    const local = extractHtmlResources({ html: '<script>image.src="picture.png";</script>', siblingFiles: new Map([['picture.png', png]]) })
    expect(local.resources).toHaveLength(1)
    expect(validateHtmlImport(local)).toEqual([])
    const code = local.html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(new Function('image', `${code}; return image.src;`)({})).toBe(`cw-resource:${local.resources[0]?.key}`)
    const namespace = extractHtmlResources({ html: '<script>const ns="http://www.w3.org/2000/svg";</script>' })
    expect(validateHtmlImport(namespace)).toEqual([])
  })

  it('resolves simple constant URL sinks without treating ordinary URL text as a request', () => {
    const text = extractHtmlResources({ html: '<script>const ns="http://www.w3.org/2000/svg"; const docs="https://react.dev";</script>' })
    expect(validateHtmlImport(text)).toEqual([])
    const alias = extractHtmlResources({ html: '<script>const u="https://example.org/a.png"; document.createElement("img").src=u;</script>' })
    expect(validateHtmlImport(alias)).toEqual([expect.objectContaining({ level: 'warning', code: 'remote-media-preserved' })])
    const audio = extractHtmlResources({ html: '<script>new Audio("https://example.org/a.mp3")</script>' })
    expect(validateHtmlImport(audio)).toEqual([expect.objectContaining({ level: 'warning', code: 'remote-media-preserved' })])
    const audioAlias = extractHtmlResources({ html: '<script>const clip="https://example.org/a.mp3"; new Audio(clip)</script>' })
    expect(validateHtmlImport(audioAlias)).toEqual([expect.objectContaining({ level: 'warning', code: 'remote-media-preserved' })])
    const image = extractHtmlResources({ html: '<script>const img = new Image(); img.src="https://example.org/picture"</script>' })
    expect(validateHtmlImport(image)).toEqual([expect.objectContaining({ level: 'warning', code: 'remote-media-preserved' })])
    const background = extractHtmlResources({ html: '<script>image.style.backgroundImage="url(https://cdn.example.test/a.png)"</script>' })
    expect(validateHtmlImport(background)).toEqual([expect.objectContaining({ level: 'warning', code: 'remote-media-preserved' })])
    const script = extractHtmlResources({ html: '<script>const script = document.createElement("script"); script.src="https://example.org/code"</script>' })
    expect(validateHtmlImport(script).map(diagnostic => diagnostic.code)).toContain('remote-script')
  })

  it('rejects ambiguous or computed URL sinks instead of treating them as local', () => {
    for (const code of [
      'image.src=chooseImage()',
      'new Audio(chooseClip())',
      'const u="https://example.org/a.png"; function f(u){image.src=u}',
      'const u="local.png"; try {} catch(u) {image.src=u}',
      'const u="local.png"; function f({u}) {image.src=u}',
      'const u="https://example.org/a.png"; u="local.png"; image.src=u',
    ]) {
      const result = extractHtmlResources({ html: `<script>${code}</script>` })
      expect(validateHtmlImport(result).map(error => error.code)).toContain('unsupported-dynamic-url-sink')
    }
  })

  it('accepts an inert Vite modulepreload fallback but rejects an active fetch', () => {
    const vite = '(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);function n(e){if(e.ep)return;e.ep=!0;let n={credentials:`same-origin`};fetch(e.href,n)}})();'
    expect(validateHtmlImport(extractHtmlResources({ html: `<script>${vite}</script>` }))).toEqual([])
    expect(validateHtmlImport(extractHtmlResources({ html: '<script>fetch(location.href)</script>' })).map(error => error.code)).toContain('unsupported-network-sink')
    expect(validateHtmlImport(extractHtmlResources({ html: `<script>${vite.replace('fetch(e.href,n)', 'fetch(e.href,n);fetch(location.href)')}</script>` })).map(error => error.code)).toContain('unsupported-network-sink')
    const eager = vite.replace('let e=document.createElement(`link`).relList;', 'n({href:location.href});let e=document.createElement(`link`).relList;')
    expect(validateHtmlImport(extractHtmlResources({ html: `<script>${eager}</script>` })).map(error => error.code)).toContain('unsupported-network-sink')
  })

  it('accepts the original complete Vite fallback and preserves its native-support early return', () => {
    const vite = '(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();'
    const result = extractHtmlResources({ html: `<script type="module">${vite}</script>` })
    expect(validateHtmlImport(result)).toEqual([])
    const calls: unknown[] = []
    const document = {
      createElement: () => ({ relList: { supports: (name: string) => name === 'modulepreload' } }),
      querySelectorAll: () => { throw new Error('native support must return before querying links') },
    }
    new Function('document', 'fetch', 'MutationObserver', vite)(document, (...args: unknown[]) => calls.push(args), class { constructor() { throw new Error('observer must be unreachable') } })
    expect(calls).toEqual([])
    const quoted = vite.replaceAll('`', "'").replace('if(e&&', '/* preserved formatting */\nif (e&&')
    expect(validateHtmlImport(extractHtmlResources({ html: `<script>${quoted}</script>` }))).toEqual([])
  })

  it.each([
    ['comment-hidden eager call', (code: string) => code.replace('let e=document', 'n/**/({href:location.href});let e=document')],
    ['unused nested guard', (code: string) => code.replace('if(e&&e.supports&&e.supports(`modulepreload`))return;', 'function unused(){if(e&&e.supports&&e.supports(`modulepreload`))return;}')],
    ['inverted guard', (code: string) => code.replace('if(e&&e.supports&&e.supports(`modulepreload`))', 'if(!(e&&e.supports&&e.supports(`modulepreload`)))')],
    ['extra fetch', (code: string) => code.replace('fetch(e.href,n)', 'fetch(e.href,n);fetch(location.href)')],
    ['guard alternate branch', (code: string) => code.replace('))return;', ')){}else return;')],
    ['guard in callback', (code: string) => code.replace('if(e&&e.supports&&e.supports(`modulepreload`))return;', '(()=>{if(e&&e.supports&&e.supports(`modulepreload`))return;})();')],
    ['injected IIFE argument', (code: string) => code.replace('})();', '})(fetch(location.href));')],
    ['guard variable reassigned', (code: string) => code.replace('if(e&&', 'e=null;if(e&&')],
  ])('rejects the Vite lookalike with %s', (_name, mutate) => {
    const vite = '(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);function n(e){if(e.ep)return;e.ep=!0;let n={credentials:`same-origin`};fetch(e.href,n)}})();'
    const result = extractHtmlResources({ html: `<script>${mutate(vite)}</script>` })
    expect(validateHtmlImport(result).map(error => error.code)).toContain('unsupported-network-sink')
  })

  it('rejects CSS import modifiers rather than turning them into media queries', () => {
    const files = new Map([['theme.css', new TextEncoder().encode('.title{color:red}')]])
    const media = extractHtmlResources({ html: '<style>@import "theme.css" screen;</style>', siblingFiles: files })
    expect(validateHtmlImport(media)).toEqual([])
    expect(media.html).toContain('@media screen{.title{color:red}}')
    for (const modifier of ['layer(theme)', 'supports(display: grid)', 'layer(theme) supports(display: grid)', '/*comment*/ layer(theme)']) {
      const result = extractHtmlResources({ html: `<style>@import "theme.css" ${modifier};</style>`, siblingFiles: files })
      expect(validateHtmlImport(result).map(error => error.code)).toContain('unsupported-css-import')
      expect(result.html).not.toContain('@media')
    }
  })

  it('localizes image-set string resources and rejects remote strings', () => {
    const local = extractHtmlResources({ html: '<style>.x{background:image-set("picture.png" 1x, -webkit-image-set("picture.png" 2x))}</style>', siblingFiles: new Map([['picture.png', png]]) })
    expect(local.resources).toHaveLength(1)
    expect(local.resources[0]?.origins).toHaveLength(2)
    expect(validateHtmlImport(local)).toEqual([])
    const remote = extractHtmlResources({ html: '<style>.x{background:-webkit-image-set("https://cdn.example/a.png" 1x)}</style>' })
    expect(validateHtmlImport(remote)).toEqual([expect.objectContaining({ level: 'warning', code: 'remote-media-preserved' })])
    const typed = extractHtmlResources({ html: '<style>.x{background:image-set("picture.png" type("image/png") 1x)}</style>', siblingFiles: new Map([['picture.png', png]]) })
    expect(validateHtmlImport(typed)).toEqual([])
    expect(typed.resources).toHaveLength(1)
    const closingParen = extractHtmlResources({ html: '<style>.x{background:image-set("p).png" 1x,"https://cdn.example/b.png" 2x)}</style>', siblingFiles: new Map([['p).png', png]]) })
    expect(validateHtmlImport(closingParen).map(error => error.code)).toContain('remote-media-preserved')
  })

  it('rejects data URI script sources and handles computed property names precisely', () => {
    const script = extractHtmlResources({ html: '<script src="data:text/javascript,fetch(%22https%3A%2F%2Fcdn.example%22)"></script>' })
    expect(validateHtmlImport(script).map(error => error.code)).toContain('unsupported-script-source')
    const base64 = extractHtmlResources({ html: `<script src="data:text/javascript;base64,${Buffer.from('fetch("https://cdn.example")').toString('base64')}"></script>` })
    expect(validateHtmlImport(base64).map(error => error.code)).toContain('unsupported-script-source')
    const dynamic = extractHtmlResources({ html: '<script>const src="name"; state[src]="picture.png"</script>' })
    expect(validateHtmlImport(dynamic)).toEqual([])
    const literal = extractHtmlResources({ html: '<script>image["src"]="picture.png"</script>' })
    expect(validateHtmlImport(literal).map(error => error.code)).toContain('missing-relative-resource')
  })

  it('includes modulepreload and SVG image references in closure decisions', () => {
    const remote = extractHtmlResources({ html: '<link rel="modulepreload" href="https://cdn.example/mod.js">' })
    expect(validateHtmlImport(remote).map(error => error.code)).toEqual(expect.arrayContaining(['unsupported-module-graph', 'remote-script']))
    const local = extractHtmlResources({ html: '<svg><image href="picture.png"/><image xlink:href="picture.png"/></svg>', siblingFiles: new Map([['picture.png', png]]) })
    expect(local.resources).toHaveLength(1)
    expect(local.resources[0]?.origins).toHaveLength(2)
    expect(validateHtmlImport(local)).toEqual([])
  })

  it('does not rewrite comments or HTML text', () => {
    const result = extractHtmlResources({ html: `<!-- ${uri} --><p>${uri}</p><script>// ${uri}\nconst answer = 42</script>` })
    expect(result.resources).toEqual([])
    expect(result.html).toContain(`<!-- ${uri} -->`)
    expect(validateHtmlImport(result)).toEqual([])
  })

  it('reads only a recursive CSS closure and preserves nested relative paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'g20-html-'))
    await mkdir(join(root, 'css'))
    await mkdir(join(root, 'img'))
    await writeFile(join(root, 'page.html'), '<link rel="stylesheet" href="css/main.css">')
    await writeFile(join(root, 'css', 'main.css'), '@import "nested.css";')
    await writeFile(join(root, 'css', 'nested.css'), '.hero{background:url("../img/cat.png")}')
    await writeFile(join(root, 'img', 'cat.png'), png)
    const result = await readHtmlClosure({ htmlPath: join(root, 'page.html') })
    expect(validateHtmlImport(result)).toEqual([])
    expect([...result.siblingFiles.keys()].sort()).toEqual(['css/main.css', 'css/nested.css', 'img/cat.png'])
    expect(result.resources).toHaveLength(1)
    expect(result.html).toContain(`cw-resource:${result.resources[0]?.key}`)
  })

  it('does not read a symlinked sibling outside the approved root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'g20-html-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'g20-html-outside-'))
    await writeFile(join(root, 'page.html'), '<img src="linked/picture.png">')
    await writeFile(join(outside, 'picture.png'), png)
    await symlink(outside, join(root, 'linked'), 'junction')
    const result = await readHtmlClosure({ htmlPath: join(root, 'page.html') })
    expect(result.siblingFiles.size).toBe(0)
    expect(validateHtmlImport(result).map(error => error.code)).toContain('missing-relative-resource')
  })

  it('reports CSS cycles and unauthorized resource sinks', () => {
    const cycle = extractHtmlResources({ html: '<link rel="stylesheet" href="a.css">', siblingFiles: new Map([['a.css', new TextEncoder().encode('@import "a.css";')]]) })
    expect(validateHtmlImport(cycle).map(error => error.code)).toContain('css-import-cycle')
    const blocked = extractHtmlResources({ html: '<base href="/"><script src="https://cdn.example/a.js"></script><img src="../escape.png"><iframe src="x.html"></iframe>' })
    expect(validateHtmlImport(blocked).map(error => error.code)).toEqual(expect.arrayContaining(['unsupported-html-capability', 'remote-script', 'missing-relative-resource']))
  })
})
