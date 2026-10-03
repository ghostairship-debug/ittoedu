// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'
import { collectRemoteMediaOrigins } from '../../src/main/workbench/htmlImport/remoteHtmlReferences'
import { validateHtmlImport } from '../../src/main/workbench/htmlImport/validateHtmlImport'

const png = Uint8Array.of(137, 80, 78, 71, 1, 2, 3, 4)
const gif = Uint8Array.of(71, 73, 70, 56, 7, 7, 7)
const audio = Uint8Array.of(73, 68, 51, 4, 0, 0, 0, 0)
const font = Uint8Array.of(119, 79, 70, 70, 1, 0)
const video = Uint8Array.of(0, 0, 0, 24, 102, 116, 121, 112)
const text = (value: string) => new TextEncoder().encode(value)
const dataUri = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const files = (entries: Array<[string, Uint8Array]>) => new Map(entries)
const scriptBody = (html: string) => {
  const match = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)
  expect(match?.[1]).toBeTruthy()
  return match![1]
}

describe('extractHtmlResources', () => {
  it.each([
    'class Lesson{constructor(){this.x=1}}',
    'const opts=document.querySelectorAll("button");for(let i=0;i<opts.length;i++){opts[i].onclick=()=>{opts[i].textContent="answered"}}',
  ])('preserves the whole unproven script while still importing independent HTML media: %s', body => {
    const code = `${body};document.querySelector('img').src=${JSON.stringify(dataUri(png, 'image/png'))};`
    const result = extractHtmlResources({ html: `<img src="pic.png"><script>${code}</script>`, siblingFiles: files([['pic.png', png]]) })
    expect(validateHtmlImport(result).filter(item => item.level === 'error')).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ level: 'warning', code: 'unsupported-dynamic-url-sink' }))
    expect(scriptBody(result.html)).toBe(code)
    expect(scriptBody(result.html)).not.toContain('cw-resource:')
    expect(result.resources).toHaveLength(1)
    expect(result.html).toContain('<img src="cw-resource:')
  })

  it('leaves a dynamic URL sink unchanged while localizing a proven static sink', () => {
    const code = 'const img=document.querySelector("img");img.src="pic.png";function set(audio,u){audio.src=u}'
    const result = extractHtmlResources({ html: `<script>${code}</script>`, siblingFiles: files([['pic.png', png]]) })
    expect(validateHtmlImport(result).filter(item => item.level === 'error')).toEqual([])
    expect(result.html).toContain('cw-resource:')
    expect(result.html).toContain('audio.src=u')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ level: 'warning', code: 'unsupported-dynamic-url-sink' }))
  })

  it.each([
    ['missing.png', 'missing-relative-resource'],
    ['http://example.com/a.png', 'remote-https-required'],
    ['file:///C:/a.png', 'unsupported-url-scheme'],
    ['blob:https://example.com/a', 'unsupported-url-scheme'],
  ])('keeps the explicit bad resource %s rejected inside an otherwise unproven script', (url, code) => {
    const source = `class Lesson{constructor(){}};document.querySelector('img').src=${JSON.stringify(url)};`
    const result = extractHtmlResources({ html: `<script>${source}</script>` })
    expect(scriptBody(result.html)).toBe(source)
    expect(result.resources).toEqual([])
    // A missing local file stays as a placeholder reference; addresses that can never load stay errors of the source.
    expect(validateHtmlImport(result)).toContainEqual(expect.objectContaining({ level: code === 'missing-relative-resource' ? 'warning' : 'error', code }))
  })

  it('drops script/style loading hints and keeps non-media references without creating unusable placeholders', () => {
    const result = extractHtmlResources({ html: '<link rel="modulepreload" href="a.js"><link rel="preload" as="style" href="a.css"><link rel="preload" as="image" href="pic.png"><video><track src="a.vtt"></video>',
      siblingFiles: files([['a.js', text('window.ready=true')], ['a.css', text('body{color:red}')], ['pic.png', png], ['a.vtt', text('WEBVTT')]]) })
    expect(validateHtmlImport(result).filter(item => item.level === 'error')).toEqual([])
    expect(result.html).not.toContain('modulepreload')
    expect(result.html).not.toContain('as="style"')
    expect(result.html).toContain('as="image" href="cw-resource:')
    expect(result.html).toContain('<track src="a.vtt">')
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0].mediaType).toBe('image/png')
    expect(validateHtmlImport(extractHtmlResources({ html: '<link rel="preload" as="script" href="missing.js">' }))).toContainEqual(expect.objectContaining({ level: 'warning', code: 'missing-relative-resource' }))
  })

  it('extracts an image data URI from img and replaces it with a content hash', () => {
    const uri = dataUri(png, 'image/png')
    const result = extractHtmlResources({ html: `<img src="${uri}" alt="cat">` })
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]).toMatchObject({ key: sha256(png), mediaType: 'image/png', bytes: png })
    expect(result.resources[0]?.origins).toEqual([{ kind: 'data-uri', context: 'html-attr', reference: uri }])
    expect(result.html).toContain(`src="cw-resource:${sha256(png)}"`)
    expect(result.html).not.toContain('base64,')
    const long = new Uint8Array(96)
    long[0] = 9
    const longUri = dataUri(long, 'image/png')
    const clipped = extractHtmlResources({ html: `<img src="${longUri}">` })
    expect(longUri.length).toBeGreaterThan(64)
    expect(clipped.resources[0]?.origins[0]?.reference).toBe(longUri.slice(0, 64))
    expect(result.diagnostics).toEqual([])
    expect(result.remoteReferences).toEqual([])
  })

  it('extracts a data URI inside a CSS url()', () => {
    const uri = dataUri(png, 'image/png')
    const result = extractHtmlResources({ html: `<style>.hero{background:url("${uri}")}</style><div style="background:url('${uri}')"></div>` })
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.origins.map(origin => origin.context)).toEqual(['css-url', 'css-url'])
    expect(result.html).toContain(`url("cw-resource:${sha256(png)}")`)
    expect(result.html).toContain(`url('cw-resource:${sha256(png)}')`)
    expect(result.html).not.toContain('base64,')
  })

  it('extracts a link icon data URI', () => {
    const uri = dataUri(png, 'image/png')
    const result = extractHtmlResources({ html: `<link rel="icon" href="${uri}">` })
    expect(result.resources.map(resource => resource.mediaType)).toEqual(['image/png'])
    expect(result.html).toContain(`href="cw-resource:${sha256(png)}"`)
    expect(result.resources[0]?.origins[0]).toMatchObject({ kind: 'data-uri', context: 'html-attr' })
  })

  it('extracts classic script resource consumers without breaking the surrounding program', () => {
    const uri = dataUri(audio, 'audio/mpeg')
    const html = `<script>
const re = /["'\`]/;
const label = "ready";
function load() { new Audio("${uri}"); image.src=\`${uri}\`; }
function total(a, b) { return a + b; }
if (a < b) { total(1, 2); }
const ratio = 10 / 2;
</script>`
    const result = extractHtmlResources({ html })
    const code = scriptBody(result.html)
    expect(result.resources).toEqual([expect.objectContaining({ key: sha256(audio), mediaType: 'audio/mpeg', bytes: audio })])
    expect(result.resources[0]?.origins).toHaveLength(2)
    expect(result.resources[0]?.origins.every(origin => origin.context === 'js-string' && origin.kind === 'data-uri')).toBe(true)
    expect(code).toContain(`cw-resource:${sha256(audio)}`)
    expect(code).not.toContain('base64,')
    expect(code).toContain('a < b')
    expect(code).toContain('10 / 2')
    expect(() => new Function(code)).not.toThrow()
  })

  it('deduplicates identical bytes and keeps every origin', () => {
    const uri = dataUri(png, 'image/png')
    const result = extractHtmlResources({ html: `<img src="${uri}"><style>.a{background:url(${uri})}</style>` })
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.bytes).toEqual(png)
    expect(result.resources[0]?.origins.map(origin => origin.context)).toEqual(['html-attr', 'css-url'])
    expect(result.html.match(/cw-resource:/g)).toHaveLength(2)
  })

  it('rewrites srcset candidates independently', () => {
    const uri = dataUri(gif, 'image/gif')
    const result = extractHtmlResources({
      html: `<img src="small.png" srcset="${uri} 1x, small.png 480w, https://cdn.example.com/big.png 800w">`,
      siblingFiles: files([['small.png', png]]),
    })
    expect(result.resources.map(resource => resource.mediaType).sort()).toEqual(['image/gif', 'image/png'])
    expect(result.html).toContain(`cw-resource:${sha256(gif)} 1x`)
    expect(result.html).toContain(`cw-resource:${sha256(png)} 480w`)
    expect(result.html).toContain('https://cdn.example.com/big.png 800w')
    expect(result.remoteReferences).toEqual([{ url: 'https://cdn.example.com/big.png', context: 'srcset', usage: 'image' }])
    expect(result.resources.find(resource => resource.mediaType === 'image/png')?.origins.map(origin => origin.context).sort()).toEqual(['html-attr', 'srcset'])
  })

  it('extracts a sibling image and reports a missing one without touching unrelated links', () => {
    const result = extractHtmlResources({
      html: '<img src="./img/cat.png?v=2"><img src="missing.png"><video poster="img/cat.png"></video><a href="page.html">go</a>',
      siblingFiles: files([['img/cat.png', png]]),
    })
    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.origins).toHaveLength(2)
    expect(result.resources[0]?.origins.every(origin => origin.kind === 'relative')).toBe(true)
    expect(result.html).toContain(`src="cw-resource:${sha256(png)}"`)
    expect(result.html).toContain(`poster="cw-resource:${sha256(png)}"`)
    expect(result.html).toContain('src="missing.png"')
    expect(result.html).toContain('href="page.html"')
    expect(result.diagnostics).toEqual([expect.objectContaining({ level: 'warning', code: 'missing-relative-resource', reference: 'missing.png' })])
  })

  it('inlines sibling js and css and resolves nested urls from each file', () => {
    const css = text([
      '.hero{background:url("../img/cat.png")}',
      `.badge{background:url("${dataUri(gif, 'image/gif')}")}`,
    ].join('\n'))
    const js = text([
      `function load() { new Audio(${JSON.stringify(dataUri(audio, 'audio/mpeg'))}); }`,
      "function style() { element.style.cssText = 'background:url(\"../fonts/extra.woff\")'; }",
      'function total(a, b) { return a + b; }',
      'const ratio = 8 / 2;',
    ].join('\n'))
    const result = extractHtmlResources({
      html: '<link rel="stylesheet" href="styles/app.css" media="print"><script src="./vendor/app.js"></script>',
      siblingFiles: files([
        ['styles/app.css', css],
        ['vendor/app.js', js],
        ['img/cat.png', png],
        ['fonts/extra.woff', font],
      ]),
    })
    expect(result.html).not.toContain('styles/app.css')
    expect(result.html).not.toContain('vendor/app.js')
    expect(result.html).toContain('<style media="print">')
    expect(result.html).toContain(`url("cw-resource:${sha256(png)}")`)
    expect(result.html).toContain(`url("cw-resource:${sha256(gif)}")`)
    expect(result.html).toContain(`cw-resource:${sha256(audio)}`)
    expect(result.html).toContain(`cw-resource:${sha256(font)}`)
    expect(result.html).not.toContain('base64,')
    const code = scriptBody(result.html)
    expect(() => new Function(code)).not.toThrow()
    expect(new Function(`${code}; return total(ratio, 1);`)()).toBe(5)
    const types = result.resources.map(resource => resource.mediaType).sort()
    expect(types).toEqual(['audio/mpeg', 'font/woff', 'image/gif', 'image/png'])
    expect(result.diagnostics).toEqual([])
  })

  it('reports remote references and leaves them in place', () => {
    const html = '<img src="https://cdn.example.com/a.png"><img src="//cdn.example.com/b.png"><script>const ns = "http://www.w3.org/2000/svg";</script>'
    const result = extractHtmlResources({ html })
    expect(result.html).toContain('https://cdn.example.com/a.png')
    expect(result.html).toContain('https://cdn.example.com/b.png')
    expect(result.html).toContain('http://www.w3.org/2000/svg')
    expect(result.remoteReferences).toEqual([
      { url: 'https://cdn.example.com/a.png', context: 'html-attr', usage: 'image' },
      { url: 'https://cdn.example.com/b.png', context: 'html-attr', usage: 'image' },
    ])
    expect(result.resources).toEqual([])
    expect(() => new Function(scriptBody(result.html))).not.toThrow()
  })

  it('preserves HTTPS image, audio and video links with exact media origins while preserving remote scripts as nonblocking warnings', () => {
    const result = extractHtmlResources({ html: '<img src="https://cdn.example.test/p?id=1"><audio src="https://cdn.example.test/a"></audio><video src="https://media.example.test/v" poster="https://cdn.example.test/p"></video><script src="https://cdn.example.test/app.js"></script>' })
    expect(result.html).toContain('https://media.example.test/v')
    expect(result.remoteReferences.map(reference => reference.usage)).toEqual(['image', 'media', 'media', 'image'])
    expect(collectRemoteMediaOrigins(result)).toEqual(['https://cdn.example.test', 'https://media.example.test'])
    const diagnostics = validateHtmlImport(result)
    expect(diagnostics.filter(diagnostic => diagnostic.level === 'warning')).toHaveLength(5)
    expect(diagnostics.filter(diagnostic => diagnostic.level === 'error')).toEqual([])
    expect(diagnostics.map(diagnostic => diagnostic.code)).toContain('remote-script')
  })

  it('distinguishes CSS background media from stylesheet dependencies', () => {
    const result = extractHtmlResources({ html: '<style>.hero{background:url(https://cdn.example.test/photo)}@import "https://cdn.example.test/theme.css";</style>' })
    expect(result.remoteReferences.map(reference => reference.usage)).toEqual(['image', 'stylesheet'])
    expect(collectRemoteMediaOrigins(result)).toEqual(['https://cdn.example.test'])
    expect(validateHtmlImport(result).map(diagnostic => diagnostic.code)).toEqual(['remote-media-preserved', 'remote-stylesheet'])
  })

  it('keeps a percent-encoded SVG data URI and records an info diagnostic', () => {
    const uri = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"
    const result = extractHtmlResources({ html: `<img src="${uri}">` })
    expect(result.html).toContain(uri)
    expect(result.resources).toEqual([])
    expect(result.remoteReferences).toEqual([])
    expect(result.diagnostics).toEqual([expect.objectContaining({ level: 'info', code: 'non-base64-data-uri' })])
  })

  it('leaves non-media base64 data URIs in place', () => {
    const uri = 'data:text/plain;base64,SGk='
    const result = extractHtmlResources({ html: `<img src="${uri}">` })
    expect(result.html).toContain(uri)
    expect(result.resources).toEqual([])
    expect(result.diagnostics).toEqual([expect.objectContaining({ level: 'info', code: 'unsupported-data-uri-type' })])
  })

  it('extracts font and video data URIs', () => {
    const result = extractHtmlResources({
      html: `<style>@font-face{src:url(${dataUri(font, 'font/woff')})}</style><video src="${dataUri(video, 'video/mp4')}"></video>`,
    })
    expect(result.resources.map(resource => resource.mediaType).sort()).toEqual(['font/woff', 'video/mp4'])
    expect(result.html).not.toContain('base64,')
  })

  it('is deterministic for the same input', () => {
    const input = {
      html: `<img src="${dataUri(png, 'image/png')}" srcset="small.png 1x, https://cdn.example.com/a.png 2x"><script>const n = "${dataUri(audio, 'audio/mpeg')}";</script>`,
      siblingFiles: files([['small.png', png]]),
    }
    expect(extractHtmlResources(input)).toEqual(extractHtmlResources(input))
  })
})
