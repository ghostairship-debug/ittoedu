import { describe, expect, it, vi } from 'vitest'
import { parse as parseHtml, type DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseJavaScript } from 'acorn'
import { extractHtmlResources, htmlResourceSources } from '../../src/main/workbench/htmlImport/extractHtmlResources'
import { readHtmlClosure } from '../../src/main/workbench/htmlImport/readHtmlClosure'
import { readComponentSourceClosure } from '../../src/main/workbench/projectFiles/componentSourceClosure'
import { htmlPreviewContentSecurityPolicy } from '../../src/main/workbench/htmlPreview/htmlPreviewResponse'
import { authoredDocumentBootstrap, installAuthoredDocumentPrograms, type AuthoredDocumentPrograms } from '../../src/components/web/authoredDocumentBootstrap'
import { compileHtmlModules } from '../../src/main/workbench/contentApply/compilation/compileHtmlModules'
import { cssUrlReferences, resolveCssAssetReferences } from '../../src/shared/composition/projectReferences'
import { parseFlowHtml } from '../../src/shared/document/html'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
const bytes = (text: string) => new TextEncoder().encode(text)
const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
const extract = (html: string, files: Record<string, Uint8Array> = {}) => extractHtmlResources({ html, siblingFiles: new Map(Object.entries(files)) })
function elements(html: string, tag: string) {
  const result: DefaultTreeAdapterTypes.Element[] = []
  const visit = (node: DefaultTreeAdapterTypes.Node) => { if ('tagName' in node && node.tagName === tag) result.push(node); if ('childNodes' in node) node.childNodes.forEach(visit) }
  visit(parseHtml(html)); return result
}
describe('R37–R40 resource counterexamples', () => {
  it('CA277 substitutes only module/classic string literals in the real bootstrap producer', () => {
    let programs: AuthoredDocumentPrograms | undefined
    authoredDocumentBootstrap({ html: '<script type="module"></script>', moduleGraph: { entries: { '0': 'main.js' }, modules: { 'main.js': { code: 'export const pattern=/cw-resource:r1/; export const source="cw-resource:r1";', imports: [] } } } } as any,
      { nonce: 'test', instanceId: 'web', resources: { 'cw-resource:r1': 'data:image/png;base64,AA==' }, bridge: input => { programs = input; return '' } })
    const code = programs!.graph!.modules['main.js'].code
    expect(code).toContain('/cw-resource:r1/'); expect(code).toContain('"data:image/png;base64,AA=="')
    expect(() => parseJavaScript(code, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
  })
  it('CA193 binds module-relative URL expressions to the actual installed graph lease', async () => {
    const result = await compileHtmlModules({ entry: 'main.js', files: { 'main.js': 'export const url=new URL("./helper.js",import.meta.url);', 'helper.js': 'export default 42;' } }, async source => ({ code: source, warnings: [] }))
    if (result.status !== 'ready') throw new Error('ready')
    let programs: AuthoredDocumentPrograms | undefined
    authoredDocumentBootstrap({ html: '<script type="module"></script>', moduleGraph: { entries: { '0': 'main.js' }, modules: result.artifact.modules! } } as any,
      { nonce: 'meta', instanceId: 'web', resources: {}, bridge: input => { programs = input; return '' } })
    let index = 0
    const create = vi.fn(() => `blob:https://guoling.local/${index++}`), revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    const lease = installAuthoredDocumentPrograms(programs!)
    try {
      const registry = (window as unknown as Record<string, Record<string, string>>)[programs!.moduleProperty!]
      const code = programs!.graph!.modules['main.js'].code.replace('export const url=', 'return ')
      expect(new Function('globalThis', 'URL', code)(window, URL).href).toBe(registry['helper.js'])
    } finally { lease.release(); expect((window as any)[programs!.moduleProperty!]).toBeUndefined() }
  })
  it('CA306 diagnoses inline event code while preserving usable Flow text', () => {
    const result = parseFlowHtml('<p><span onclick="this.textContent=\'答案2\'">点击查看</span></p>', { assets: {} })
    expect(result.blocks).toHaveLength(1); expect(result.diagnostics.some(issue => issue.code === 'flow-program')).toBe(true)
  })
  it('CA325 transports external String.raw source unchanged into classic Blob programs', () => {
    const source = 'window.lessonText=String.raw`</script>`;'
    const result = extract('<script src="lesson.js"></script>', { 'lesson.js': bytes(source) })
    const script = elements(result.html, 'script')[0]
    expect(JSON.parse(script.attrs.find(attribute => attribute.name === 'data-guoling-classic-source')!.value)).toBe(source)
    let programs: AuthoredDocumentPrograms | undefined
    authoredDocumentBootstrap({ html: result.html } as any, { nonce: 'test', instanceId: 'web', resources: {}, bridge: input => { programs = input; return '' } })
    expect(programs!.classic['0']).toBe(source)
  })
  it('CA018 consumes an already-authorized supplied parent resource key', () => {
    const result = extract('<img src="../assets/p.svg">', { '../assets/p.svg': svg })
    expect(result.resources).toHaveLength(1); expect(result.diagnostics).toEqual([])
  })
  it('CA019 decodes child HTML and stylesheet BOMs before inlining', () => {
    const utf16 = (text: string) => new Uint8Array(Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]))
    const result = extract('<iframe src="child.html"></iframe><link rel="stylesheet" href="style.css">', { 'child.html': utf16('<h1>中文课件</h1>'), 'style.css': utf16('h1::before{content:"中文样式"}') })
    expect(elements(result.html, 'iframe')[0].attrs.find(attribute => attribute.name === 'srcdoc')?.value).toContain('中文课件')
    expect(result.html).toContain('中文样式'); expect(result.html).not.toContain('\uFFFD')
  })
  it('CA020 closes handler and SVG filter image resources', () => {
    const result = extract('<button onclick="new Image().src=\'p.svg\';return false">图</button><svg><filter><feImage href="p.svg"/></filter></svg>', { 'p.svg': svg })
    expect(result.resources).toHaveLength(1); expect(result.html.match(/cw-resource:/g)?.length).toBe(2)
    expect(result.diagnostics.some(issue => issue.code === 'script-parse')).toBe(false)
  })
  it('CA021 decodes quoted and unquoted CSS escaped URLs', () => {
    for (const reference of ['url("my\\20 image.svg")', 'url(my\\ image.svg)']) {
      const result = extract(`<style>body{background:${reference}}</style>`, { 'my image.svg': svg })
      expect(result.resources).toHaveLength(1); expect(result.diagnostics).toEqual([])
    }
  })
  it('CA106 resolves remote base references before removing the base', () => {
    const result = extract('<base href="https://assets.example/lesson/"><img src="p.svg">')
    expect(result.html).not.toContain('<base'); expect(result.html).toContain('https://assets.example/lesson/p.svg')
    expect(htmlResourceSources(result.remoteReferences)).toEqual([{ url: 'https://assets.example/lesson/p.svg', usage: 'image' }])
  })
  it('CA107 keeps a certain media sink alongside unrelated data reflection', () => {
    const result = extract('<script>new Image().src="p.svg";Object.getOwnPropertyDescriptor({score:1},"score");</script>', { 'p.svg': svg })
    expect(result.resources).toHaveLength(1); expect(result.html).toContain('cw-resource:')
  })
  it('CA108 leaves a bad directory reference local and imports a healthy sibling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'audit-html-'))
    try {
      await writeFile(path.join(root, 'lesson.html'), '<h1>正文</h1><img src="directory"><img src="p.svg">'); await mkdir(path.join(root, 'directory')); await writeFile(path.join(root, 'p.svg'), svg)
      const result = await readHtmlClosure({ htmlPath: path.join(root, 'lesson.html'), rootDir: root })
      expect(result.html).toContain('正文'); expect(result.resources).toHaveLength(1)
      expect(result.diagnostics.some(issue => issue.reference === 'directory')).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('CA109 recognizes existing IMG and input-image URL consumers', () => {
    const result = extract('<img id="picture"><input type="image" src="https://image.example/button.png"><script>document.getElementById("picture").src="https://image.example/p.png";</script>')
    expect(htmlResourceSources(result.remoteReferences).filter(source => source.usage === 'image')).toHaveLength(2)
  })
  it('CA110 grants passive dependencies only from the already-authorized stylesheet origin', () => {
    const policy = htmlPreviewContentSecurityPolicy([], [], [{ usage: 'stylesheet', url: 'https://style.example/site.css' }])
    expect(policy.split('; ').find(rule => rule.startsWith('img-src'))).toContain('https://style.example')
    expect(policy.split('; ').find(rule => rule.startsWith('font-src'))).toContain('https://style.example')
    expect(policy).not.toContain('https://foreign.example')
  })
  it('CA038 captures CSS parent imports and their downstream files in root coordinates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'audit-css-'))
    try {
      await mkdir(path.join(root, 'styles')); await mkdir(path.join(root, 'common')); await mkdir(path.join(root, 'images'))
      await writeFile(path.join(root, 'main.js'), 'import "./styles/theme.css";'); await writeFile(path.join(root, 'styles/theme.css'), '@import "../common/base.css";')
      await writeFile(path.join(root, 'common/base.css'), 'body{background:url("../images/p.svg")}'); await writeFile(path.join(root, 'images/p.svg'), svg)
      const result = await readComponentSourceClosure({ filename: path.join(root, 'main.js'), rootDir: root, bytes: bytes('import "./styles/theme.css";'), text: 'import "./styles/theme.css";' })
      expect([...result.files.keys()]).toContain('images/p.svg')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('CA142 resolves uppercase URL functions', () => {
    expect(resolveCssAssetReferences('body{background:URL(../assets/p.svg)}', { 'assets/p.svg': { assetId: 'p' } }, () => 'data:image/svg+xml,SVG')).toContain('url("data:image/svg+xml,SVG")')
  })
  it('CA274 leaves URL-looking strings and comments untouched', () => {
    const css = 'body::before{content:"url(../assets/p.svg)"}/*url(../assets/p.svg)*/'
    expect(cssUrlReferences(css)).toEqual([]); expect(resolveCssAssetReferences(css, { 'assets/p.svg': { assetId: 'p' } }, () => 'data:image/svg+xml,SVG')).toBe(css)
  })
  it('CA349 includes dependencies for the classic MIME domain supported by the runtime', () => {
    const result = extract('<script type="text/jscript" src="lesson.js"></script>', { 'lesson.js': bytes('new Image().src="p.svg";'), 'p.svg': svg })
    expect(result.resources).toHaveLength(1); expect(result.html).toContain('cw-resource:')
  })
  it('CA354 does not parse ignored body text of an external module', () => {
    const result = extract('<script type="module" src="main.js">fallback ??? invalid JS</script>', { 'main.js': bytes('export const answer=42;') })
    expect(result.modules?.['main.js']).toContain('answer'); expect(result.diagnostics.some(issue => issue.code === 'script-parse')).toBe(false)
  })
  it('CA371 retains the native disabled stylesheet and a portable URL for later enabling', () => {
    const result = extract('<link rel="stylesheet" id="theme" disabled href="theme.css">', { 'theme.css': bytes('body{color:red}') })
    const link = elements(result.html, 'link')[0]
    expect(link.attrs.some(attribute => attribute.name === 'disabled')).toBe(true)
    const href = link.attrs.find(attribute => attribute.name === 'href')!.value
    expect(href).toMatch(/^data:text\/css/); expect(decodeURIComponent(href)).toContain('body{color:red}')
    expect(elements(result.html, 'style')).toHaveLength(0)
  })
})
