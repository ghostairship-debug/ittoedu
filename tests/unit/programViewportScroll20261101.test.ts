// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

it('lets the program document own scrolling without an inline iframe baseline creating a second scrollbar', async () => {
  await loadBuiltinComponentSource('guoling.html-program')
  const project=createBlankProgramProject('Program scrolling'),id=project.rootIds[0]
  project.instances[id].data={html:'<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{height:1200px}button{margin-top:1100px}</style></head><body><main><button id="end" onclick="this.textContent=\'reached\'">End of document</button></main></body></html>'}
  const published=await buildPublishedCourseV4({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
  const bundle=await build({stdin:{contents:"export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ScrollTest',platform:'browser',target:'es2022'})
  const browser=await chromium.launch({headless:true})
  try{
    const page=await browser.newPage({viewport:{width:1000,height:750}})
    await page.setContent('<!doctype html><style>body{margin:0}</style><main id="root" style="width:900px;height:650px;position:relative;overflow:hidden"></main>')
    await page.addScriptTag({content:bundle.outputFiles[0].text})
    await page.evaluate<void,unknown>(async payload=>{(window as any).player=await (window as any).ScrollTest.mountPublishedCourseV4(payload,document.getElementById('root'))},published.payload)
    const owner=page.locator('[data-component-program-root]'),frame=owner.locator('iframe')
    await expect.poll(()=>frame.count()).toBe(1)
    const end=frame.contentFrame().locator('#end')
    await end.waitFor()
    const geometry=await owner.evaluate(element=>({width:element.clientWidth,height:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,frameWidth:element.querySelector('iframe')!.getBoundingClientRect().width}))
    expect(geometry).toEqual({width:900,height:650,scrollWidth:900,scrollHeight:650,frameWidth:900})
    await end.click();await expect.poll(()=>end.textContent()).toBe('reached')
    expect(await frame.contentFrame().locator('body').evaluate(()=>document.scrollingElement!.scrollTop)).toBeGreaterThan(0)
    expect(await owner.evaluate(element=>element.scrollTop)).toBe(0)
    await page.evaluate(()=>(window as any).player.dispose())
  }finally{await browser.close()}
},30000)

