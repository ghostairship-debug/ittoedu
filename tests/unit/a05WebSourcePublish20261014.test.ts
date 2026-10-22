// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep, isAbsolute } from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { resolveWebResourceBindings } from '../../src/components/web/resources'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library/insert'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'

const candidate=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),workspace=process.cwd()
const candidatePlugin={name:'a05-publish-candidate',setup(plugin:any){plugin.onResolve({filter:/^\./},(args:any)=>{
 const path=resolve(args.resolveDir,args.path),inside=(base:string,value:string)=>{const rest=relative(base,value);return rest===''||!rest.startsWith(`..${sep}`)&&rest!=='..'&&!isAbsolute(rest)}
 const original=inside(candidate,path)?resolve(workspace,relative(candidate,path)):path
 if(!inside(workspace,original)||relative(workspace,original).split(sep).includes('node_modules'))return
 const find=(base:string)=>['','.ts','.tsx','.js','.json','/index.ts'].map(ext=>base+ext).find(value=>existsSync(value)&&statSync(value).isFile())
 const selected=find(resolve(candidate,relative(workspace,original)))??find(original)
 return selected?{path:selected}:undefined
})}}

it('prepares real Source HTML/module/resource data and retains it through compiled publication', async () => {
  const [mature,player]=await Promise.all([
    build({stdin:{contents:"export {default} from './src/components/builtin-source/web'",resolveDir:candidate,loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',plugins:[candidatePlugin]}),
    build({stdin:{contents:"export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'",resolveDir:candidate,loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',globalName:'A05Published',plugins:[candidatePlugin]}),
  ])
  const project = createBlankCourseProjectV10('Source Web publication')
  project.definitions.implementation = { id:'implementation',role:'mixed',implementation:{kind:'source',language:'javascript',source:mature.outputFiles[0].text} }
  project.definitions.web = {id:'web',role:'mixed',professionalBuiltinKey:'guoling.web',implementation:{kind:'source',language:'javascript',moduleBindings:{'./implementation':'implementation'},source:`import implementation from './implementation';let count=0;export default {...implementation,async mount(context){const mounted=await implementation.mount(context);const button=document.createElement('button');button.id='business';button.textContent='business:0';button.onclick=()=>button.textContent='business:'+ ++count;context.root.append(button);return mounted}}`}}
  const child='<script type="module" src="./child.js"></script><p id="child">child</p>'
  const html=`<!doctype html><html><head><script type="module" src="./main.js"></script></head><body><img src="cw-resource:photo"><iframe srcdoc="${child.replaceAll('"','&quot;')}"></iframe></body></html>`
  project.instances.web={id:'web',definitionId:'web',data:{html,business:{count:7},resourceBindings:{'cw-resource:photo':'photo'},modules:{'main.js':`import {value} from './shared.js';document.body.dataset.module=String(value)`,'shared.js':'export const value=42','child.js':`document.body.dataset.child='ready'`}},frame:{width:640,height:360,transform:[1,0,0,1,0,0]}}
  project.definitions.custom={id:'custom',role:'mixed',implementation:{kind:'source',language:'javascript',source:`export default {mount(context){let count=0;const button=document.createElement('button');button.id='custom';button.textContent='custom:0';button.onclick=()=>button.textContent='custom:'+ ++count;context.root.append(button);return {update(next){button.dataset.state=next.data.state},dispose(){button.remove()}}}}`}}
  project.instances.custom={id:'custom',definitionId:'custom',data:{html:'<script>throw new Error("must not execute")</script>',state:'base'},frame:{width:260,height:160,transform:[1,0,0,1,650,0]}}
  testContainerInstance(project, 0).childIds=['web','custom']
  testContainerInstance(project, 0).container.presentation={initialStateId:'base',states:[{id:'base',title:'base',overrides:{}},{id:'next',title:'next',overrides:{web:{data:{...project.instances.web.data as object,html:html.replace('child</p>','next</p>')}},custom:{data:{html:'<script>throw new Error("must still not execute")</script>',state:'next'}}}}]}
  const image=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>')
  project.assets.photo={id:'photo',path:'assets/photo.svg',mimeType:'image/svg+xml',byteLength:image.length,filename:'photo.svg'}
  const before=structuredClone(project), compilation=new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published=await buildPublishedCourseV3({project,assetBytes:{photo:image}},{compilation})
  expect(published.diagnostics).toEqual([])
  const data=published.payload.instances.web.data as any
  expect(data.html).toBe(html);expect(data.business).toEqual({count:7})
  expect(data.moduleGraph.entries).toMatchObject({'0':'main.js','0:0':'child.js'})
  expect(data.publishedModuleBundle).toContain('42');expect(data.publishedDocumentBundles['0']).toContain('ready')
  const next=componentSurfaces(published.payload)[0].presentation!.states[1].overrides.web.data as any
  expect(next.html).toContain('next</p>');expect(next.publishedDocumentBundles['0']).toBeTruthy()
  expect(published.payload.assets.photo.url).toMatch(/^data:image\/svg\+xml/)
  const resolved=resolveWebResourceBindings(published.payload.instances.web,id=>published.payload.assets[id]?.url).data as any
  expect(resolved.business).toEqual({count:7});expect(resolved.html).toContain('data:image/svg+xml')
  const dom=new JSDOM('<!doctype html>')
  try{
    const artifact=await compileCoursePlayback(published.payload,{document:dom.window.document,renderBuiltin:async()=>''})
    expect(artifact.webPrograms).toEqual({});expect(artifact.sourceFactories['definition:web']).toBeUndefined()
    expect(artifact.nativeSources?.['definition:web'].code).toContain('document: "web"')
    expect((artifact.course.instances.web.data as any).html).toBe(html)
    expect((artifact.course.instances.web.data as any).moduleGraph.entries).toMatchObject({'0':'main.js','0:0':'child.js'})
    expect(project).toEqual(before)
    const browser=await chromium.launch({headless:true})
    try{
      const page=await browser.newPage({viewport:{width:900,height:650}}),errors:string[]=[]
      page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message))
      await page.setContent('<!doctype html><main id="root" style="width:900px;height:650px"></main>')
      await page.addScriptTag({content:player.outputFiles[0].text})
      await page.evaluate<void, unknown>(async payload=>{(window as any).player=await(window as any).A05Published.mountCompiledCourse(payload,document.getElementById('root'),{report:(message:string)=>((window as any).reports??=[]).push(message)})},artifact)
      const frame=page.frameLocator('[data-compiled-runtime-root="web"] iframe')
      await expect.poll(()=>frame.locator('body').getAttribute('data-module')).toBe('42')
      await expect.poll(()=>frame.frameLocator('iframe').locator('body').getAttribute('data-child')).toBe('ready')
      const custom=page.frameLocator('[data-compiled-runtime-root="custom"] iframe')
      await custom.locator('#custom').click();expect(await custom.locator('#custom').textContent()).toBe('custom:1')
      await frame.locator('#business').click();expect(await frame.locator('#business').textContent()).toBe('business:1')
      expect(await frame.locator('img').getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
      await expect.poll(()=>frame.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(2)
      await page.evaluate(surface=>(window as any).player.go(surface,'next'),componentSurfaces(project)[0].id)
      await expect.poll(()=>frame.frameLocator('iframe').locator('#child').textContent()).toBe('next')
      expect(await frame.locator('#business').textContent()).toBe('business:0')
      expect(await custom.locator('#custom').textContent()).toBe('custom:1')
      expect(await custom.locator('#custom').getAttribute('data-state')).toBe('next')
      expect(errors).toEqual([]);expect(await page.evaluate(()=>(window as any).reports??[])).toEqual([])
      await page.evaluate(()=>(window as any).player.dispose())
    }finally{await browser.close()}
  }finally{dom.window.close()}
}, 20000)

it('routes explicit Web declarations and keeps plain Source direct, including unlabelled Source library resource namespaces', async () => {
  const project = createBlankCourseProjectV10('Source document declarations')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'source', language: 'typescript',
    source: "export default {document:'web' as const,mount(){return {update(){},dispose(){}}}}" } }
  project.definitions.plain = { id: 'plain', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: "export default {mount(context){context.root.textContent='plain';return {update(){},dispose(){}}}}" } }
  project.instances.web = { id: 'web', definitionId: 'web', data: { html: '<!doctype html><img src="cw-resource:photo">', resourceBindings: { 'cw-resource:photo': 'photo' } } }
  project.instances.plain = { id: 'plain', definitionId: 'plain', data: { html: '<p>unused business field</p>' } }
  testContainerInstance(project, 0).childIds = ['web', 'plain']
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>')
  project.assets.photo = { id: 'photo', path: 'assets/photo.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  const resources = { assets: { photo: bytes }, components: {} }, compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published = await buildPublishedCourseV3({ project, assetBytes: resources.assets }, { compilation })
  expect(published.payload.assets.photo.url).toMatch(/^data:image\/svg\+xml/)
  const dom = new JSDOM('<!doctype html>')
  try {
    const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => '' })
    expect(artifact.nativeSources?.['definition:web']).toBeDefined()
    expect(artifact.sourceFactories['definition:plain']).toBeDefined()
    expect(artifact.nativeSources?.['definition:plain']).toBeUndefined()
  } finally { dom.window.close() }
  const entry = extractComponentLibraryEntry(project, resources, { id: 'saved', title: 'Web source', rootIds: ['web'] }).entry
  const destination = createBlankCourseProjectV10('Destination'), driver = new CourseV10Driver()
  const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: componentSurfaces(destination)[0].id }, index: 0 })
  const inserted = driver.apply({ kind: 'course-v10', project: destination, resources: { assets: {}, components: {} } }, insertion.command)
  if (inserted.kind !== 'course-v10') throw new Error('Expected V10')
  const instance = inserted.project.instances[insertion.rootIds[0]], implementation = inserted.project.definitions[instance.definitionId].implementation
  if (implementation.kind !== 'source') throw new Error('Expected retained source')
  const photoId = insertion.identities.assets.get('photo')!
  expect(photoId).not.toBe('photo')
  expect(implementation.resourceBindings?.photo).toBe(photoId)
  const projected = resolveWebResourceBindings(instance, id => id === photoId ? 'data:image/svg+xml;base64,PHN2Zy8+' : undefined, undefined, implementation.resourceBindings)
  expect(projected.data).toMatchObject({ html: expect.stringContaining('data:image/svg+xml;base64,PHN2Zy8+'), resourceBindings: { 'cw-resource:photo': photoId } })
  expect(instance.data).toEqual(project.instances.web.data)
})
