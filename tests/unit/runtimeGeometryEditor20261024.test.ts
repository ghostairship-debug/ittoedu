// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

it('binds the actual editor Flow container basis and releases it across close and reopen', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import { mountCurrentCourseBrowserHarness } from './tests/helpers/currentFlowBrowserHarness'
    import { createV10StoreHost } from './tests/helpers/courseV10StoreHost'
    import { createCourseProjectContent } from './src/renderer/store/slices/courseLifecycleSlice'
    import { createChartData } from './src/components/chart/data'
    import { ComponentRuntimeHost } from './src/player/components/runtime/ComponentRuntimeHost'
    import { useEditorStore } from './src/renderer/store/editorStore'
    import { TEXT_DEFINITION } from './src/components/text/adapters'
    import { createTextComponentData } from './src/components/text/data'
    import './src/renderer/styles/variables.css'
    import './src/renderer/styles/globals.css'
    async function main(){
      const scopes=new Map(), sync=ComponentRuntimeHost.prototype.sync;
      ComponentRuntimeHost.prototype.sync=function(request){return sync.call(this,request).then(handle=>{if(handle)scopes.set(request.instance.id,handle.scope);return handle})};
      const {project,resources}=createCourseProjectContent('flow'),flowId=project.rootIds[0];project.global={underlay:[],overlay:[]};
      project.definitions.chart={id:'chart',role:'content',implementation:{kind:'builtin',key:'guoling.chart'}};
      project.definitions[TEXT_DEFINITION.id]=TEXT_DEFINITION;
      for(const id of ['first','second'])project.instances[id]={id,definitionId:'chart',data:JSON.parse(JSON.stringify(createChartData())),frame:{width:600,height:300,transform:[1,0,0,1,0,0]}};
      project.instances.spacer={id:'spacer',definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData('Paragraph for Flow geometry. '.repeat(160))))};
      project.instances[flowId].childIds=['first','spacer','second'];
      const transport=await createV10StoreHost(project,resources,false),host=document.createElement('main');
      host.style.cssText='width:100%;height:680px;position:relative;display:flex';document.body.append(host);
      const mounted=await mountCurrentCourseBrowserHarness(host,transport.api);
      window.editorGeometry={flowId,scopes,reports:mounted.errors,
        sample:()=>scopes.get('first').measure([{kind:'instance',instanceId:'first'},{kind:'instance',instanceId:'second'}]),
        close:async()=>{const bridge=useEditorStore.getState().courseBridge,id=bridge.read().activeDocumentId;window.retiredGeometryScope=scopes.get('first');await transport.api.save(id,'geometry.glx');return bridge.close(id)},
        reopen:()=>useEditorStore.getState().courseBridge.open('geometry.glx'),dispose:()=>mounted.dispose()};
    }
    main().catch(error=>window.editorGeometryFailure=String(error.stack||error));
  ` }, bundle: true, write: false, outfile: 'editor-geometry.js', format: 'iife', platform: 'browser',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors: string[] = []
  const evidence: Record<string, unknown> = {}, output = resolve('output/resource-runtime-repair-20261024/geometry')
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://localhost/editor-geometry', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0;width:100%;height:100%}</style><body></body>' }))
    await page.goto('http://localhost/editor-geometry')
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.waitForFunction(() => (window as any).editorGeometry || (window as any).editorGeometryFailure)
    expect(await page.evaluate(() => (window as any).editorGeometryFailure)).toBeUndefined()
    await page.locator('[data-component-runtime-root="first"] svg').first().waitFor()
    await page.waitForFunction(() => (window as any).editorGeometry.scopes.has('first'))
    const sample = () => page.evaluate(() => (window as any).editorGeometry.sample())
    const before = await sample()
    expect(before.targets.map((target: any) => target.flow?.containerId)).toEqual([before.targets[0].flow.containerId, before.targets[0].flow.containerId])
    expect(before.targets[1].viewportFrame.transform[5]).toBeGreaterThan(680)
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!.scrollTop = 200 })
    const after = await sample()
    expect(after.targets.map((target: any) => target.flow.contentFrame)).toEqual(before.targets.map((target: any) => target.flow.contentFrame))
    expect(after.targets[0].flow.viewport.y).toBe(200)
    evidence.desktop = { before, after }
    expect(await page.evaluate(() => (window as any).editorGeometry.close())).toBe(true)
    expect(await page.evaluate(() => (window as any).retiredGeometryScope.measure([]))).toBeNull()
    await page.evaluate(() => (window as any).editorGeometry.reopen())
    await page.locator('[data-component-runtime-root="first"] svg').first().waitFor()
    const reopened = await sample()
    expect(reopened.targets[0].flow?.containerId).toBe(before.targets[0].flow.containerId)
    evidence.reopened = reopened
    await page.setViewportSize({ width: 390, height: 800 })
    await expect.poll(async () => (await sample()).targets[0].flow.viewport.width).toBeLessThan(before.targets[0].flow.viewport.width)
    evidence.narrow = await sample()
    expect(await page.evaluate(() => (window as any).editorGeometry.reports)).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'editor-measurements.json'), JSON.stringify({ evidence, errors }, null, 2))
    await page.evaluate(() => (window as any).editorGeometry?.dispose()).catch(() => {})
    await browser.close()
  }
}, 30_000)
