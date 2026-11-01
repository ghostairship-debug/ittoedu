// @vitest-environment node
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { describe, expect, it } from 'vitest'
import { webModuleCompilationInput } from '../../src/components/web/moduleGraph'
import { compileHtmlModules } from '../../src/main/workbench/contentApply/compilation/compileHtmlModules'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { componentCompilationInput, componentModuleSource, componentSourceFileText } from '../../src/core/components/compilation/componentCompilationInput'
import { courseThemeVariables, courseTokenVariableName } from '../../src/shared/contracts/design-v1/theme'
import { projectWebModuleUrls, resolveWebJavaScriptResources } from '../../src/components/web/resources'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
const bytes = (source: string) => new TextEncoder().encode(source)
const identityTransform = async (source: string) => ({ code: source, warnings: [] })
const project = (): CourseProjectV10 => (createTestProjectFromLegacy({ schemaVersion: 10, id: 'modules', revision: 0, title: 'Modules', definitions: {}, instances: {}, surfaces: [], global: { underlay: [], overlay: [] }, assets: {} }))
describe('R39/R41/R42/R87 native source counterexamples', () => {
  it('closes nested media URL objects through extraction, compilation and runtime resource binding', async () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
    const wav = new Uint8Array(46), header = new DataView(wav.buffer)
    wav.set(bytes('RIFF'), 0); header.setUint32(4, 38, true); wav.set(bytes('WAVEfmt '), 8)
    header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true)
    header.setUint32(24, 8000, true); header.setUint32(28, 16000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true)
    wav.set(bytes('data'), 36); header.setUint32(40, 2, true)
    const extracted = extractHtmlResources({ html: '<script type="module" src="./scenes/main.js"></script>', siblingFiles: new Map([
      ['scenes/main.js', bytes('export const photo = new URL("../media/pixel.png", import.meta.url); export const sound = new URL("../media/tone.wav", import.meta["url"]).href; export const helper = () => import("../helper.js");')],
      ['helper.js', bytes('export const value = 42;')], ['media/pixel.png', png], ['media/tone.wav', wav],
    ]) })
    expect(extracted.resources.map(resource => resource.mediaType).sort()).toEqual(['audio/wav', 'image/png'])
    expect(extracted.modules?.['helper.js']).toContain('42')
    const prepared = webModuleCompilationInput({ html: extracted.html, modules: extracted.modules })!
    const compiled = await compileHtmlModules(prepared.input, identityTransform)
    if (compiled.status !== 'ready') throw new Error('Expected compiled local media modules')
    const urls = new Map(extracted.resources.map(resource => [`cw-resource:${resource.key}`, `data:${resource.mediaType};base64,${Buffer.from(resource.bytes).toString('base64')}`]))
    const code = resolveWebJavaScriptResources(compiled.artifact.modules!['scenes/main.js'].code, reference => urls.get(reference), true)
    const result = new Function(`${code.replace(/\bexport\s+/g, '')};return {photo,sound};`)() as { photo: URL; sound: string }
    expect(result.photo).toBeInstanceOf(URL)
    expect(new Uint8Array(await (await fetch(result.photo)).arrayBuffer())).toEqual(png)
    expect(new Uint8Array(await (await fetch(result.sound)).arrayBuffer())).toEqual(wav)
  })
  it.each([
    'export function asset(URL) { return new URL("./photo.png", import.meta.url); }',
    'import.meta.url = "https://example.test/changed.js"; export const asset = new URL("./photo.png", import.meta.url);',
  ])('preserves non-native or mutable-base URL constructors without inventing local media (%s)', source => {
    const result = extractHtmlResources({ html: '<script type="module" src="./main.js"></script>', siblingFiles: new Map([
      ['main.js', bytes(source)], ['photo.png', new Uint8Array([1, 2, 3])],
    ]) })
    expect(result.resources).toEqual([])
    expect(result.modules?.['main.js']).toBe(source)
  })
  it('CA038 closes newly edited CSS imports through the current supplied modules', async () => {
    const result = await compileHtmlModules({ entry: 'main.js', files: { 'main.js': 'import "./theme.css";', 'theme.css': '@import "./nested.css";body{color:red}', 'nested.css': 'body{background:url(cw-resource:image)}' } }, identityTransform)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('ready')
    expect(result.artifact.modules!['theme.css'].code).toContain('cw-resource:image')
    expect(result.artifact.modules!['theme.css'].code).not.toContain('@import')
  })
  it('CA037 accepts a literal percent filename alongside healthy modules', () => {
    const prepared = webModuleCompilationInput({ html: '<script type="module" src="progress100%.js"></script><script type="module" src="healthy.js"></script>', modules: { 'progress100%.js': 'export default 1', 'healthy.js': 'export default 2' } })!
    expect(Object.values(prepared.entries)).toEqual(['progress100%.js', 'healthy.js'])
    expect(Object.keys(prepared.input.files)).toEqual(['progress100%.js', 'healthy.js'])
  })
  it('CA191 compiles a shared root and its self-import as one singleton, but distinguishes overrides', async () => {
    const p = project(), source = { kind: 'source' as const, language: 'javascript' as const, source: 'import { token as selfToken } from "Self";export const token={};export const same=()=>selfToken===token;', moduleBindings: { Self: 'A' } }
    p.definitions.A = { id: 'A', role: 'content', implementation: source }
    const compiler = createEsbuildComponentCompiler(), input = componentCompilationInput(p, source)
    expect(input.rootDefinitionId).toBe('A')
    const result = await compiler.compile({ ...input, options: { sourceMap: false } })
    if (result.status !== 'ready') throw new Error(JSON.stringify(result.diagnostics))
    const runnable = result.artifact.code.replace(/export\s*\{[\s\S]*?\};?\s*$/, '')
    expect(new Function(`${runnable};return same();`)()).toBe(true)
    expect(componentCompilationInput(p, { ...source }).rootDefinitionId).toBeUndefined()
  })
  it('CA192 avoids inline entry collisions only within its own basename', async () => {
    const prepared = webModuleCompilationInput({ html: '<base href="child/"><script type="module">import "./helper.js";</script><script type="module" src="__html_module_root_0.js"></script>', modules: { 'child/__html_module_root_0.js': 'export default 1;', 'child/helper.js': 'export default 2;' } })!
    expect(prepared.entries['0']).toBe('child/___html_module_root_0.js')
    const result = await compileHtmlModules(prepared.input, identityTransform)
    if (result.status !== 'ready') throw new Error('ready')
    expect(result.artifact.diagnostics).toEqual([])
    expect(result.artifact.modules!['child/___html_module_root_0.js'].imports[0].path).toBe('child/helper.js')
  })
  it('CA193 projects import metadata onto the original logical source coordinates', async () => {
    const result = await compileHtmlModules({ entry: 'child/main.js', files: { 'child/main.js': 'export const url=new URL("./helper.js",import.meta.url);', 'child/helper.js': 'export const value=42;' } }, identityTransform)
    if (result.status !== 'ready') throw new Error('ready')
    const code = result.artifact.modules!['child/main.js'].code
    expect(code).not.toContain('import.meta.url')
    expect(result.artifact.modules!['child/helper.js']).toBeDefined()
    const runnable = projectWebModuleUrls(code, 'moduleUrls').replace('export const url=', 'return ')
    expect(new Function('moduleUrls', runnable)({ 'child/helper.js': 'blob:https://guoling.local/helper' }).href).toBe('blob:https://guoling.local/helper')
  })
  it('CA284 normalizes local base and accepted relative source keys in data input', async () => {
    const prepared = webModuleCompilationInput({ html: '<base href="child/"><script type="module" src="./main.js"></script>', modules: { './child/main.js': 'export const value=42;' } })!
    expect(prepared.input.files).toEqual({ 'child/main.js': 'export const value=42;' }); expect(prepared.entries['0']).toBe('child/main.js')
    const result = await compileHtmlModules(prepared.input, identityTransform)
    if (result.status !== 'ready') throw new Error('ready')
    expect(result.artifact.diagnostics).toEqual([])
  })
  it('CA373 captures an author local import map and rewrites its bare alias to the same graph', async () => {
    const source = '<script type="importmap">{"imports":{"lesson-math":"./math.js"}}</script><script type="module">import {answer} from "lesson-math";export {answer};</script>'
    const extracted = extractHtmlResources({ html: source, siblingFiles: new Map([['math.js', bytes('export const answer=42;')]]) })
    expect(extracted.modules?.['math.js']).toContain('answer')
    const prepared = webModuleCompilationInput({ html: extracted.html, modules: extracted.modules })!
    const result = await compileHtmlModules(prepared.input, identityTransform)
    if (result.status !== 'ready') throw new Error('ready')
    expect(result.artifact.diagnostics).toEqual([])
    const entry = prepared.entries['1']
    expect(result.artifact.modules![entry].imports[0].path).toBe('math.js'); expect(result.artifact.modules!['math.js']).toBeDefined()
  })
  it('CA382 admits legitimate UTF8 program NUL characters without misclassifying binary encodings', async () => {
    const source = 'export default {mount(){return "\0"}};'
    expect(componentSourceFileText(bytes(source))).toBe(source); expect(componentSourceFileText(new Uint8Array([255, 254, 0]))).toBeNull()
    const input = componentModuleSource({ kind: 'source', language: 'javascript', workspace: { ownerId: 'owner', entry: 'main.js' } }, { assets: {}, components: { owner: { 'main.js': bytes(source) } } })
    expect(input.files['main.js']).toBe(source); expect(input.binaryFiles).toBeUndefined()
    expect((await createEsbuildComponentCompiler().compile(input)).status).toBe('ready')
  })
  it('CA280 maps legal color/font token IDs injectively with one declaration/reference helper', () => {
    const variables = courseThemeVariables({ fonts: [{ id: 'body.main', label: 'Body', fontFamily: 'serif' }, { id: 'body-main', label: 'Other', fontFamily: 'sans-serif' }], colors: [{ id: 'accent.primary', label: 'Red', color: '#ff0000' }, { id: 'accent-primary', label: 'Blue', color: '#0000ff' }, { id: 'accent_2e_primary', label: 'Green', color: '#00ff00' }] })
    expect(Object.keys(variables)).toHaveLength(5)
    expect(variables[courseTokenVariableName('color', 'accent.primary')]).toBe('#ff0000'); expect(variables[courseTokenVariableName('color', 'accent-primary')]).toBe('#0000ff')
    expect(variables[courseTokenVariableName('font', 'body.main')]).toBe('serif'); expect(variables[courseTokenVariableName('font', 'body-main')]).toBe('sans-serif')
  })
})
