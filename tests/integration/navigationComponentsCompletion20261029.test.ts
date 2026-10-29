// @vitest-environment node
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {createBlankCourseProjectV10} from '../../src/core/course/createCourseProjectV10'
import {prepareCourseTeacherControllerEdits} from '../../src/core/course/courseElementInsertion'
import {captureComponentOperation,applyComponentOperation} from '../../src/core/drivers/courseV10Operations'
import {buildPublishedCourseV3} from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import {createTextComponentData} from '../../src/components/text/data'
import {TEXT_DEFINITION} from '../../src/components/text/adapters'
import {setRootContainers} from '../helpers/glxWorkFixture'
import {CourseV10Driver} from '../../src/core/drivers/CourseV10Driver'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
let browser:Awaited<ReturnType<typeof chromium.launch>>,bundle:string
beforeAll(async()=>{browser=await chromium.launch({headless:true});const built=await build({stdin:{contents:'export {mountPublishedCourseV4} from "./src/player/componentPlatform/publishedPlayer";export {compileCoursePlayback} from "./src/core/publish/componentPlatform/compileCoursePlayback";export {mountCompiledCourse} from "./src/player/componentPlatform/compiledPlayer";export {renderCompiledBuiltin} from "./src/renderer/export/componentPlatform/renderCompiledBuiltin";',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'NavigationComponents',platform:'browser',logLevel:'silent'});bundle=built.outputFiles[0].text},30000)
afterAll(()=>browser?.close())
it.each(['model','compiled'] as const)('%s content directory follows the same reading position, navigates real headings and suppresses duplicate host directory',async mode=>{
 const directory=resolve('output/creation-editing-completion-20261029/navigation-components');await mkdir(directory,{recursive:true})
 let p=createBlankCourseProjectV10('内容导航');p.definitions[TEXT_DEFINITION.id]=TEXT_DEFINITION;p.definitions.block={id:'block',role:'content',implementation:{kind:'builtin',key:'guoling.document-block'}}
 const ids:string[]=[]
 for(let i=0;i<5;i++){const id='heading-'+i;p.instances[id]={id,definitionId:'block',data:{type:'heading',level:2,content:{inlines:[{type:'text',text:'第'+(i+1)+'章 · 共同当前位置'}]}}};ids.push(id);const body='copy-'+i;p.instances[body]={id:body,definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('内容导航、正文目录与全局控制台共享当前位置，章节跳转由正式服务执行。'.repeat(16))))};ids.push(body)}
 setRootContainers(p,[{id:'flow',kind:'flow',title:'阅读作品',childIds:ids,flow:{layout:{readingWidth:800,wideContentWidth:1000,widthMode:'reading'}}}])
 const insertion=prepareCourseTeacherControllerEdits(p,'flow',undefined,null,{placement:'content',presentation:'directory'})
 p=applyComponentOperation(p,captureComponentOperation(p,insertion.edits),{assets:{},components:{}})
 const inserted=insertion.instanceIds[0];expect(p.global.overlay).not.toContain(inserted);expect(p.instances.flow.childIds?.[0]).toBe(inserted)
 const global=prepareCourseTeacherControllerEdits(p,'flow');expect(global.instanceIds).not.toEqual(insertion.instanceIds)
 const saved={kind:'course-v10' as const,project:p,resources:{assets:{},components:{}}};const driver=new CourseV10Driver();const cold=driver.load(driver.serialize(saved));expect(cold).toMatchObject({project:{instances:{[inserted]:{data:{presentation:'directory'}}}}})
 const published=await buildPublishedCourseV3({project:p,assetBytes:{}}),page=await browser.newPage({viewport:{width:1200,height:850},offline:true}),errors:string[]=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message))
 try{
  await page.setContent('<style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>');await page.addScriptTag({content:bundle})
  await page.evaluate(async({mode,payloadText})=>{const payload=JSON.parse(payloadText);const api=(window as any).NavigationComponents,input=mode==='compiled'?await api.compileCoursePlayback(payload,{document,renderBuiltin:(instance:any,key:string,project:any)=>api.renderCompiledBuiltin(instance,key,project,document)}):payload;(window as any).navPlayer=await(mode==='compiled'?api.mountCompiledCourse:api.mountPublishedCourseV4)(input,document.getElementById('root'))},{mode,payloadText:JSON.stringify(published.payload)})
  const entries=page.locator('[data-navigation-target]');await expect.poll(()=>entries.count()).toBe(5)
  await expect.poll(()=>page.evaluate(()=>(window as any).navPlayer.navigation.readControls().actions.length)).toBeGreaterThanOrEqual(5)
  await page.waitForTimeout(2200);expect(await page.getByTestId('flow-runtime-toc-toggle').isVisible().catch(()=>false)).toBe(false)
  const readingGeometry = async () => {
    const scroll = page.locator('[data-flow-paper-scroll]')
    const paper = page.locator(mode === 'model'
      ? '[data-flow-paper-scroll] > article'
      : '[data-flow-paper-scroll] > [data-compiled-flow-paper]')
    const firstHeading = paper.getByRole('heading', { name: '第1章 · 共同当前位置', exact: true })
    const paperRect = await paper.boundingBox(), headingRect = await firstHeading.boundingBox()
    expect(paperRect).not.toBeNull()
    expect(headingRect).not.toBeNull()
    return { scroll: await scroll.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollTop: element.scrollTop }
    }), paper: paperRect, firstHeading: headingRect }
  }
  const beforeFallback = await readingGeometry()
  const authorTarget = page.locator('[data-navigation-target="heading-3"]')
  const authoredVisibility = await authorTarget.evaluate(element => {
    const previous = element.style.visibility
    element.style.visibility = 'hidden'
    return previous
  })
  await expect.poll(() => page.getByTestId('flow-runtime-toc-toggle').isVisible(), { timeout: 5000 }).toBe(true)
  expect(await readingGeometry()).toEqual(beforeFallback)
  await page.screenshot({ path: join(directory, mode + '-partial-directory-fallback.png') })
  await authorTarget.evaluate((element, visibility) => { element.style.visibility = visibility }, authoredVisibility)
  await expect.poll(() => page.getByTestId('flow-runtime-toc-toggle').isVisible(), { timeout: 5000 }).toBe(false)
  expect(await readingGeometry()).toEqual(beforeFallback)
  await page.evaluate(() => {
    ;(window as any).unexpectedHostTocFrame = false
    const inspect = () => {
      const toggle = document.querySelector<HTMLElement>('[data-testid="flow-runtime-toc-toggle"]')
      if (toggle && !toggle.hidden && getComputedStyle(toggle).display !== 'none') (window as any).unexpectedHostTocFrame = true
      ;(window as any).navigationFrame = requestAnimationFrame(inspect)
    }
    inspect()
  })
  await page.locator('[data-navigation-target="heading-3"]').click()
  await expect.poll(()=>page.evaluate(()=>(window as any).navPlayer.navigation.read().reading?.activeInstanceId)).toBe('heading-3')
  await expect.poll(()=>page.locator('[data-navigation-target="heading-3"]').getAttribute('aria-current')).toBe('location')
  await expect.poll(() => page.evaluate(() => (window as any).navPlayer.navigation.read().flowMotion?.status), { timeout: 5000 }).not.toBe('running')
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    cancelAnimationFrame((window as any).navigationFrame); resolve()
  }))))
  expect(await page.evaluate(() => (window as any).unexpectedHostTocFrame)).toBe(false)
  await page.screenshot({path:join(directory,mode+'-directory.png')});expect(errors).toEqual([])
 }finally{await Promise.race([page.evaluate(()=>(window as any).navPlayer?.dispose()).catch(()=>{}),new Promise(r=>setTimeout(r,1500))]);await page.close()}
},45000)
it('top, side and progress use the same component identity and author transaction, with no copies of navigation state',()=>{
 const p=createBlankCourseProjectV10('多种呈现'),surfaceId=p.rootIds[0]
 for(const presentation of ['top','side','progress'] as const){const prepared=prepareCourseTeacherControllerEdits(p,surfaceId,undefined,null,{placement:'content',presentation});const result=applyComponentOperation(p,captureComponentOperation(p,prepared.edits),{assets:{},components:{}});const instance=result.instances[prepared.instanceIds[0]];expect(instance.data).toMatchObject({presentation,collapsible:false});expect(result.definitions[instance.definitionId].implementation).toEqual({kind:'builtin',key:'guoling.navigation'});expect(instance.data).not.toHaveProperty('currentChapter')}
})

it.each(['model', 'compiled'] as const)('%s host Flow directory retains real heading levels through the formal navigation service', async mode => {
  const project = createBlankCourseProjectV10('标题语义回归')
  project.definitions.block = { id: 'block', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } }
  const ids = [1, 2, 3].map(level => {
    const id = 'semantic-heading-' + level
    project.instances[id] = { id, definitionId: 'block', data: { type: 'heading', level,
      content: { inlines: [{ type: 'text', text: '原生标题 ' + level }] } } }
    return id
  })
  setRootContainers(project, [{ id: 'flow', kind: 'flow', title: '标题语义', childIds: ids,
    flow: { layout: { readingWidth: 800, wideContentWidth: 1000, widthMode: 'reading', toc: 'auto' } } }])
  const published = await buildPublishedCourseV3({ project, assetBytes: {} })
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, offline: true })
  const errors: string[] = []
  page.setDefaultTimeout(8000)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setContent('<style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async ({ mode, payloadText }) => {
      const payload = JSON.parse(payloadText), api = (window as any).NavigationComponents
      const input = mode === 'compiled'
        ? await api.compileCoursePlayback(payload, { document, renderBuiltin: (instance: any, key: string, project: any) => api.renderCompiledBuiltin(instance, key, project, document) })
        : payload
      ;(window as any).navPlayer = await (mode === 'compiled' ? api.mountCompiledCourse : api.mountPublishedCourseV4)(input, document.getElementById('root'))
    }, { mode, payloadText: JSON.stringify(published.payload) })
    // Flow fallback becomes eligible after its 2-second mount grace; Vitest polling needs a matching deadline.
    await expect.poll(() => page.getByTestId('flow-runtime-toc-toggle').isVisible(), { timeout: 5000 }).toBe(true)
    expect(await page.evaluate(() => (window as any).navPlayer.navigation.read().scenes[0].targets
      .map((target: any) => ({ depth: target.depth, headingLevel: target.headingLevel })))).toEqual([
      { depth: 0, headingLevel: 1 }, { depth: 0, headingLevel: 2 }, { depth: 0, headingLevel: 3 },
    ])
    await page.getByTestId('flow-runtime-toc-toggle').click()
    const items = page.locator('[data-flow-runtime-toc-item]')
    expect(await items.count()).toBe(3)
    expect(await items.evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual([
      '跳转到标题 1：原生标题 1', '跳转到标题 2：原生标题 2', '跳转到标题 3：原生标题 3',
    ])
    expect(errors).toEqual([])
  } finally {
    await Promise.race([page.evaluate(() => (window as any).navPlayer?.dispose()).catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))])
    await page.close()
  }
}, 45000)
