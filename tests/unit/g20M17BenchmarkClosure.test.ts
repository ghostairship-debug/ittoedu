import { describe, expect, it } from 'vitest'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'
import { validateHtmlImport } from '../../src/main/workbench/htmlImport/validateHtmlImport'
import { MODULE_SOURCE } from '../../src/main/workbench/htmlImport/frameworks/react1927'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const sound = 'data:audio/mpeg;base64,SUQzAwAAAAAA'
const vendor = MODULE_SOURCE.map(([, source]) => `var ${source};`).join('\n')
const errors = (script: string) => validateHtmlImport(extractHtmlResources({ html: `<script type="module">${script}</script>` })).map(item => item.code)
const app = (src = 'D[key]', extra = '', props = `{src:${src},alt:"lesson"}`) => `
var D={a:${JSON.stringify(image)}}, k=${JSON.stringify(sound)};
${extra}
function lesson(){const key="a";return (0,T.jsxs)("div",{children:[(0,T.jsx)("img",${props}),(0,T.jsx)("audio",{src:k})]})}
(0,w.createRoot)(document.getElementById("root")).render((0,T.jsx)(lesson,{}));`

describe('audited framework resource closure', () => {
  it('proves complete library propagation only after proving application resources', () => {
    expect(errors(vendor + app())).toEqual([])
    expect(errors(vendor + app().replace('lesson"', 'new teaching text"'))).toEqual([])
    expect(errors(vendor + app().replace(image, 'data:image/png;base64,YWJj'))).toEqual([])
  })

  it('honors ordered resource replacement before the sole application mount', () => {
    expect(errors(vendor + app('D[key]', `Object.assign(D,{a:${JSON.stringify(image)}});k=${JSON.stringify(sound)};`))).toEqual([])
    const replaced = app('D[key]', `Object.assign(D,{a:${JSON.stringify(image)}});`).replace(`a:${JSON.stringify(image)}`, 'a:".data:image/png;base64,YWJj"')
    expect(errors(vendor + replaced)).toEqual([])
    expect(errors(vendor + app('D[key]', 'Object.assign(D,{a:"https://example.invalid/image.png"});'))).toContain('remote-js-resource')
    expect(errors(vendor + app('D[key]', 'k="https://example.invalid/sound.mp3";'))).toContain('remote-js-resource')
    expect(errors(vendor + app() + 'k="https://example.invalid/late.mp3";')).toContain('unsupported-dynamic-url-sink')
  })

  it.each([
    ['unknown call', 'chooseImage()', ''],
    ['unknown parameter', 'input', ''],
    ['table mutation', 'D[key]', 'D.a=chooseImage();'],
    ['table escape', 'D[key]', 'mutate(D);'],
    ['table alias mutation', 'D[key]', 'var alias=D;alias.a=chooseImage();'],
    ['nested table escape', 'D[key]', 'var box={table:D};box.table.a=chooseImage();'],
    ['implicit arrow escape', 'D[key]', 'const get=()=>D;mutate(get());'],
    ['sequence escape', 'D[key]', 'const get=()=>(0,D);mutate(get());'],
    ['unknown table method', 'D[key]', 'D.__defineGetter__("a",chooseImage);'],
  ])('rejects %s', (_name, src, extra) => {
    expect(errors(vendor + app(src, extra))).toContain('unsupported-dynamic-url-sink')
  })

  it('rejects props spreads and escaped framework entry functions', () => {
    expect(errors(vendor + app('D[key]', '', '{...incoming}'))).toContain('unsupported-framework-resource-input')
    expect(errors(vendor + app('D[key]', 'const make=T.jsx;'))).toContain('unsupported-framework-resource-input')
    expect(errors(vendor + app('D[key]', 'T.jsx=otherFactory;'))).toContain('unsupported-framework-resource-input')
    expect(errors(vendor + app('D[key]', 's=otherModule;'))).toContain('unsupported-framework-resource-input')
    expect(errors(vendor + app('D[key]', 'const document=otherDocument;'))).toContain('unsupported-framework-resource-input')
    expect(errors(vendor + app('D[key]', 'Object.prototype.remote="https://example.invalid/image";'))).toContain('unsupported-framework-resource-input')
  })

  it('does not grant summaries to changed library code or lookalike fragments', () => {
    expect(errors(vendor.replace('e.action=t', 'e.action=chooseAction()') + app())).toContain('unsupported-dynamic-url-sink')
    expect(errors('function update(e){var n=e.memoizedProps,r=e.stateNode;switch(e.type){case"img":r.src=n.src}}')).toContain('unsupported-dynamic-url-sink')
    expect(validateHtmlImport(extractHtmlResources({ html: `<script>${vendor + app()}</script>` })).map(item => item.code)).toContain('unsupported-dynamic-url-sink')
  })

  it.each([
    'const f=document.createElement("form");let url="https://example.invalid/submit";f.action=url;document.body.append(f);f.submit()',
    'const o=document.createElement("object");o.data=chooseData()',
    'const f=document.createElement("form");function setAction(t){t.action=chooseAction()}setAction(f)',
    'const f=document.createElement("form");function setAction(t){t.action=chooseAction()}setAction.bind(null,f)()',
    'const f=document.createElement("form");function setAction(t){t.action=chooseAction()}setAction.call(null,f)',
    'const f=document.createElement("form");function setAction(t){t.action=chooseAction()}setAction.apply(null,[f])',
    'let f={};f=document.createElement("form");f.action=chooseAction()',
    'const s={queue:document.createElement("form")};let url="https://example.invalid/submit";s.queue.action=url',
    'const s={queue:document.createElement("form")};var q=s.queue,d=q.dispatch;let url="https://example.invalid/submit";q.action=url',
    'function Make(){return document.createElement("form")}const f=new Make();let url="https://example.invalid/submit";f.action=url',
    'function Make(){this.pending=null;return document.createElement("form")}const f=new Make();f.action=chooseAction()',
    'function factory(){function Make(){this.pending=null;return document.createElement("form")}return Make}const Make=factory(),f=new Make();let url="https://example.invalid/submit";f.action=url',
    'function update(e){var n=e.memoizedProps,r=e.stateNode;switch(e.type){case "img":r.src=n.src}}update({type:"img",memoizedProps:{src:chooseImage()},stateNode:document.createElement("img")})',
    'function update(e){var n=e.memoizedProps,r=e.stateNode;switch(e.type){case "img":r.src=n.src}}const props={type:"img",memoizedProps:{src:"https://example.invalid/a.png"},stateNode:document.createElement("img")};const alias=props;update(alias)',
    'function update(e){var n=e.memoizedProps,r=e.stateNode;switch(e.type){case "img":r.src=n.src}}update(source())',
    'function update(e){var n=e.memoizedProps,r=e.stateNode;switch(e.type){case "img":r.src=n.src}}function apply(x){update(x)}apply({type:"img",memoizedProps:{src:"https://example.invalid/a.png"},stateNode:document.createElement("img")})',
  ])('rejects the previously misclassified DOM sink: %s', code => {
    expect(errors(code)).toContain('unsupported-dynamic-url-sink')
  })
})
