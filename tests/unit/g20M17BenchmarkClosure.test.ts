import { describe, expect, it } from 'vitest'
import { parse } from 'acorn'
import { runInNewContext } from 'node:vm'
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

const evaluateLesson = (html: string) => {
  const code = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]
  const appCode = code.slice(code.indexOf('var D=')).split('(0,w.createRoot)')[0]
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props })
  return runInNewContext(appCode + ';lesson()', { T: { jsx, jsxs: jsx } })
}

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

  it('rewrites a shared relative literal once and leaves parseable JavaScript', () => {
    const script = vendor + app('D.a').replace(JSON.stringify(image), '"pic.png"').replace('(0,T.jsx)("audio",{src:k})', '(0,T.jsx)("img",{src:D.a})')
    const result = extractHtmlResources({ html: `<script type="module">${script}</script>`, siblingFiles: new Map([['pic.png', Buffer.from(image.split(',')[1], 'base64')]]) })
    expect(validateHtmlImport(result)).toEqual([])
    const rewritten = result.html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]
    expect(() => parse(rewritten, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
    expect(rewritten.includes('D={a:"pic.png"}')).toBe(true)
    expect(evaluateLesson(result.html).props.children.map((child: { props: { src: string } }) => child.props.src)).toEqual([
      `cw-resource:${result.resources[0].key}`, `cw-resource:${result.resources[0].key}`,
    ])
    expect(result.resources.filter(resource => resource.mediaType === 'image/png')).toHaveLength(1)
  })

  it('keeps shared literals intact and rewrites each consuming context independently', () => {
    const script = vendor + app('shared', 'const shared="pic.png";', '{src:shared,dangerouslySetInnerHTML:{__html:shared}}')
    const result = extractHtmlResources({ html: `<script type="module">${script}</script>`, siblingFiles: new Map([['pic.png', Buffer.from(image.split(',')[1], 'base64')]]) })
    expect(validateHtmlImport(result)).toEqual([])
    const props = evaluateLesson(result.html).props.children[0].props
    expect(props.src).toBe(`cw-resource:${result.resources[0].key}`)
    expect(props.dangerouslySetInnerHTML.__html).toBe('pic.png')
  })

  it.each([
    '{src:D.a,style:{backgroundImage:"url("+chooseUrl()+")"}}',
    '{src:D.a,style:chooseStyle()}',
    '{src:D.a,style:{"--picture":chooseUrl()}}',
    '{src:D.a,dangerouslySetInnerHTML:{__html:chooseHtml()}}',
    '{src:D.a,dangerouslySetInnerHTML:chooseMarkup()}',
  ])('rejects unproven recursive React resource input: %s', props => {
    expect(errors(vendor + app('D.a', '', props))).toContain('unsupported-dynamic-url-sink')
  })

  it('rejects static remote resources nested in CSS and HTML', () => {
    expect(errors(vendor + app('D.a', '', '{src:D.a,style:{backgroundImage:"url(https://example.invalid/x.png)"}}'))).toContain('remote-resource')
    expect(errors(vendor + app('D.a', '', '{src:D.a,fill:"url(https://example.invalid/paint.svg)"}'))).toContain('remote-resource')
    expect(errors(vendor + app('D.a', '', `{src:D.a,dangerouslySetInnerHTML:{__html:${JSON.stringify('<img src="https://example.invalid/x.png">')}}}`))).toContain('remote-resource')
  })

  it('preserves legal static CSS and HTML while localizing nested relative resources', () => {
    const props = `{src:D.a,style:staticStyle,dangerouslySetInnerHTML:staticMarkup}`
    const extra = `const staticStyle={backgroundImage:"url(pic.png)",width:12,color:"red"};const staticMarkup={__html:${JSON.stringify('<section style="background-image:url(pic.png)"><img src="pic.png"><span>静态文字</span></section>')}};`
    const result = extractHtmlResources({ html: `<script type="module">${vendor + app('D.a', extra, props)}</script>`, siblingFiles: new Map([['pic.png', Buffer.from(image.split(',')[1], 'base64')]]) })
    expect(validateHtmlImport(result)).toEqual([])
    const rewritten = result.html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]
    expect(() => parse(rewritten, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
    expect(rewritten).toContain('静态文字')
    const renderedProps = evaluateLesson(result.html).props.children[0].props
    expect(renderedProps.style.backgroundImage).toContain('cw-resource:')
    expect(renderedProps.style.width).toBe(12)
    expect(renderedProps.style.color).toBe('red')
    expect(renderedProps.dangerouslySetInnerHTML.__html).not.toContain('pic.png')
    expect(rewritten.includes('backgroundImage:"url(pic.png)"')).toBe(true)
    expect(result.resources.filter(resource => resource.mediaType === 'image/png')).toHaveLength(1)
  })

  it.each([
    'img[p]=chooseUrl()',
    'img[p]="https://example.invalid/x.png"',
    'const p="src";img[p]=chooseUrl()',
    'img.src+=chooseUrl()',
    'img.setAttribute(p,chooseUrl())',
    'element.innerHTML=chooseHtml()',
    'element.style.backgroundImage=chooseStyle()',
    'element.style.setProperty("background-image",chooseStyle())',
    'element.insertAdjacentHTML("beforeend",chooseHtml())',
    'element.innerHTML+=chooseHtml()',
    'element.style.cssText+=chooseStyle()',
  ])('rejects unknown dynamic DOM sinks: %s', code => {
    expect(errors(code)).toContain('unsupported-dynamic-url-sink')
  })

  it.each([
    'const st=el.style;st.backgroundImage="url("+location.hash+")"',
    'let st;st=el.style;const next=st;next.backgroundImage=chooseUrl()',
    'const {style:st}=el;st.backgroundImage="url("+location.hash+")"',
    'const load=fetch;load(location.hash)',
    'const set=el.style.setProperty.bind(el.style);set("background-image",location.hash)',
    'Object.assign(el.style,{backgroundImage:location.hash})',
    'Object.defineProperty(el.style,"backgroundImage",{value:location.hash})',
    'function style(){return el.style}style().backgroundImage=location.hash',
    'function set(st){st.backgroundImage=location.hash}set(el.style)',
    'const put=el.insertAdjacentHTML;put("beforeend",location.hash)',
  ])('rejects unproven capability aliases and escapes: %s', code => {
    expect(errors(code)).toContain('unsupported-dynamic-url-sink')
    expect(errors(vendor + app('D.a', `function unsafe(){${code}}`))).toContain('unsupported-dynamic-url-sink')
  })

  it('preserves shared image captions and ordinary CSS-looking text', () => {
    const script = vendor + app('label', 'const label="pic.png";').replace('(0,T.jsx)("audio",{src:k})', '(0,T.jsx)("span",{children:label})')
    const result = extractHtmlResources({ html: `<script type="module">${script}</script>`, siblingFiles: new Map([['pic.png', Uint8Array.of(1,2,3)]]) })
    expect(validateHtmlImport(result)).toEqual([])
    const rendered = evaluateLesson(result.html)
    expect(rendered.props.children[0].props.src).toBe(`cw-resource:${result.resources[0].key}`)
    expect(rendered.props.children[1].props.children).toBe('pic.png')
    const caption = extractHtmlResources({ html: '<script>const caption="url(pic.png)";label.textContent=caption;</script>', siblingFiles: new Map([['pic.png', Uint8Array.of(1,2,3)]]) })
    expect(validateHtmlImport(caption)).toEqual([])
    expect(caption.resources).toEqual([])
    expect(caption.html).toContain('"url(pic.png)"')
  })

  it('localizes static style aliases without changing their original text', () => {
    const result = extractHtmlResources({ html: '<script>const css="url(pic.png)";const st=el.style;st.backgroundImage=css;label.textContent=css;</script>', siblingFiles: new Map([['pic.png', Uint8Array.of(1,2,3)]]) })
    expect(validateHtmlImport(result)).toEqual([])
    const el = { style: {} }, label = { textContent: '' }
    runInNewContext(result.html.match(/<script>([\s\S]*?)<\/script>/)![1], { el, label })
    expect(el.style).toEqual({ backgroundImage: `url(cw-resource:${result.resources[0].key})` })
    expect(label.textContent).toBe('url(pic.png)')
  })

  it('resolves static embedded HTML relative to its source script', () => {
    const script = `element.innerHTML=${JSON.stringify('<img src="../pic.png">')};`
    const result = extractHtmlResources({ html: '<script src="scripts/main.js"></script>', siblingFiles: new Map([
      ['scripts/main.js', Buffer.from(script)], ['pic.png', Buffer.from(image.split(',')[1], 'base64')],
    ]) })
    expect(validateHtmlImport(result)).toEqual([])
    expect(result.resources).toHaveLength(1)
    expect(result.html).not.toContain('../pic.png')
  })

  it('permits resolved computed property names and harmless numeric indices', () => {
    expect(errors(`const p="src";img[p]=${JSON.stringify(image)};const a=[];a[0]=1`)).toEqual([])
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
