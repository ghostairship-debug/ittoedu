import { test, expect } from '@playwright/test'
import { build } from 'esbuild'

test('controller directory stays clickable inside embedded, short and standalone playback bounds', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { TeacherControllerComponentHost } from './src/player/teacherControllerComponentHost';
      import { createDefaultTeacherControllerPackage } from './src/shared/defaultTeacherControllerComponent';
      window.mountController = (bounds) => {
        window.controller?.destroy();
        document.body.replaceChildren();
        const toolbar = document.createElement('header');
        Object.assign(toolbar.style, { position:'fixed', left:'0', top:'0', width:'100%', height:bounds.top+'px', zIndex:'100', background:'#ddd' });
        document.body.append(toolbar);
        const stage = document.createElement('div');
        Object.assign(stage.style, { position:'absolute', left:bounds.left+'px', top:bounds.top+'px', width:'1280px', height:'720px', transformOrigin:'0 0', transform:'scale('+bounds.width/1280+','+bounds.height/720+')' });
        document.body.append(stage);
        const node = { x:200, y:bounds.top ? 20 : 638, width:880, height:64, rotation:0 };
        const container = document.createElement('div');
        Object.assign(container.style, { position:'absolute', left:node.x+'px', top:node.y+'px', width:node.width+'px', height:node.height+'px' });
        stage.append(container);
        const pkg = createDefaultTeacherControllerPackage();
        let session = { collapsed:false, offset:{dx:0,dy:0} };
        window.controller = new TeacherControllerComponentHost({
          node, container, canvas:{width:1280,height:720}, getRenderedStageBounds:()=>stage.getBoundingClientRect(),
          scenes:Array.from({length:30}, (_,i)=>({id:'scene-'+i,name:'场景 '+i})),
          getCurrentSceneId:()=> 'scene-0', getStateLabel:()=>null,
          getStatus:()=>({muted:false,fullscreen:false}), getSession:()=>session,
          onSessionChange:next=>{session=next}, getInteractive:()=>true,
          onAction:action=>{window.lastAction=action;return true},
        }, { container, componentId:pkg.manifest.id, version:pkg.manifest.version,
          components:{[pkg.manifest.id]:pkg}, props:pkg.manifest.defaultProps,
          scope:'global', mode:'preview', interactive:true, width:node.width, height:node.height });
      };
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
  })
  await page.setViewportSize({ width: 1400, height: 1000 })
  await page.setContent('<body style="margin:0"></body>')
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
  for (const bounds of [
    { left: 180, top: 240, width: 800, height: 450 },
    { left: 100, top: 180, width: 500, height: 170 },
    { left: 0, top: 0, width: 1280, height: 720 },
  ]) {
    await page.evaluate(value => (window as unknown as { mountController(bounds: typeof value): void }).mountController(value), bounds)
    await page.getByRole('button', { name: '场景目录', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '场景目录', exact: true })
    await expect.poll(async () => {
      const box = await dialog.boundingBox()
      return !!box && box.x >= bounds.left + 7 && box.y >= bounds.top + 7
        && box.x + box.width <= bounds.left + bounds.width - 7
        && box.y + box.height <= bounds.top + bounds.height - 7
    }).toBe(true)
    const stable = await dialog.evaluate(async element => {
      const samples: string[] = []
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame)
        const rect = element.getBoundingClientRect()
        samples.push([rect.x, rect.y, rect.width, rect.height].map(value => value.toFixed(2)).join(','))
      }
      return new Set(samples).size
    })
    expect(stable).toBe(1)
    await dialog.getByRole('button', { name: '关闭面板', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: '场景目录', exact: true }).click()
    await dialog.getByRole('button', { name: '场景 29', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { lastAction: unknown }).lastAction))
      .toEqual({ type: 'scene.go', sceneId: 'scene-29' })
  }
  expect(errors).toEqual([])
})

test('Flow controller popup follows its real viewport after mounted surface resizing', async ({ page }) => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { FlowSurfaceHost } from './src/player/surfaces/flow/FlowSurfaceHost';
      import { createBlankCourseProject } from './src/core/course/createCourseProject';
      import { addCourseFlowPage } from '../../src/core/tools/courseLocations';
      import { buildPublishedCourseV2Payload } from './src/renderer/export/course/buildPublishedCourse';
      import { createDefaultTeacherControllerPackage } from './src/shared/defaultTeacherControllerComponent';
      window.mountFlow = async () => {
        let project=createBlankCourseProject();
        const result=addCourseFlowPage(project,{now:new Date().toISOString(),expectedRevision:project.revision});
        if(!result.ok) throw new Error(result.reason);
        project=result.project;
        const item=project.globalLayerItems[0].item;
        item.props.defaultCollapsed=false;
        item.frame={...item.frame,x:800,y:20,width:320,height:64};
        const pkg=createDefaultTeacherControllerPackage();
        const payload=buildPublishedCourseV2Payload({project,assetFiles:{},components:{[pkg.manifest.id]:pkg}});
        const flow=project.locations.find(location=>location.surfaceId.startsWith('flow')) || project.locations[project.locations.length-1];
        const container=document.getElementById('flow');
        window.flowHost=new FlowSurfaceHost(payload,{surfaceId:flow.surfaceId,locationId:flow.id,components:payload.components,
          courseProgressSource:{getLocations:()=>Array.from({length:30},(_,i)=>({id:'loc-'+i,name:'场景 '+i})),getCurrentLocationId:()=>flow.id,getStateLabel:()=>null},
          executeTeacherControllerAction:()=>true});
        await window.flowHost.mount(container);await window.flowHost.activate();
      };
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife',
  })
  await page.setViewportSize({ width: 1500, height: 1100 })
  await page.setContent('<body style="margin:0"><header style="position:fixed;z-index:100;top:0;left:0;width:100%;height:220px;background:#ccc"></header><div id="flow" style="position:absolute;left:100px;top:220px;width:360px;height:180px"></div></body>')
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
  await page.evaluate(() => (window as unknown as { mountFlow(): Promise<void> }).mountFlow())
  for (const size of [{ width: 900, height: 540 }, { width: 580, height: 300 }]) {
    await page.locator('#flow').evaluate((element, next) => {
      element.style.width = next.width + 'px'; element.style.height = next.height + 'px'
    }, size)
    await page.getByRole('button', { name: '场景目录', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '场景目录', exact: true })
    await expect.poll(async () => {
      const box = await dialog.boundingBox()
      return !!box && box.x >= 107 && box.y >= 227
        && box.x + box.width <= 100 + size.width - 7
        && box.y + box.height <= 220 + size.height - 7
    }).toBe(true)
    await dialog.getByRole('button', { name: '关闭面板', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
})
