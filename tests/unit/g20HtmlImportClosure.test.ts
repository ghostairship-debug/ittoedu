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
    const result = extractHtmlResources({ html: `<script>const x = ''; const a = '${escaped}'; const b = \`${uri}\`; const c = \`prefix\${x}${uri}\`;</script>` })
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.origins).toHaveLength(2)
    const code = result.html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(new Function(`${code}; return [a, b];`)()).toEqual([`cw-resource:${result.resources[0]?.key}`, `cw-resource:${result.resources[0]?.key}`])
    expect(code).toContain(`prefix\${x}${uri}`)
    expect(validateHtmlImport(result)).toEqual([])
  })

  it('keeps rewritten inline JavaScript intact in a real HTML parser', () => {
    const html = `<script>const x = '${uri} \\x3c/script><p id="injected">'; window.finished = true;</script>`
    const result = extractHtmlResources({ html })
    expect(validateHtmlImport(result)).toEqual([])
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    expect(document.querySelector('#injected')).toBeNull()
    expect(document.querySelectorAll('script')).toHaveLength(1)
    const source = document.querySelector('script')?.textContent ?? ''
    const state: Record<string, unknown> = {}
    expect(new Function('window', `${source}; return [x, window.finished];`)(state)).toEqual([`cw-resource:${result.resources[0]?.key} </script><p id="injected">`, true])
  })

  it('fails on invalid scripts and external module graphs without scanning as success', () => {
    const invalid = extractHtmlResources({ html: `<script>const = '${uri}'</script>` })
    expect(invalid.resources).toEqual([])
    expect(validateHtmlImport(invalid).map(error => error.code)).toContain('script-parse')
    const module = extractHtmlResources({ html: '<script type="module">import "./dependency.js"</script>' })
    expect(validateHtmlImport(module).map(error => error.code)).toContain('unsupported-module-graph')
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
    expect(validateHtmlImport(remote).map(error => error.code)).toEqual(expect.arrayContaining(['unsupported-network-sink', 'remote-js-resource']))
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

  it('includes modulepreload and SVG image references in closure decisions', () => {
    const remote = extractHtmlResources({ html: '<link rel="modulepreload" href="https://cdn.example/mod.js">' })
    expect(validateHtmlImport(remote).map(error => error.code)).toEqual(expect.arrayContaining(['unsupported-module-graph', 'remote-resource']))
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
    expect(validateHtmlImport(blocked).map(error => error.code)).toEqual(expect.arrayContaining(['unsupported-html-capability', 'remote-script', 'missing-relative-resource', 'remote-resource']))
  })
})
