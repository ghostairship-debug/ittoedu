import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

const inspect = (filename: string) => {
  const data = inspectOfficeContent(readFileSync(filename), 'pptx')
  if (data.format !== 'pptx') throw new Error('PPT expected')
  return data
}
test('PPT toolbox edits multiple objects, native clipboard, text and tables with shared undo and cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32'); test.setTimeout(240000)
  const base = resolve('output/office-coedit-20261103/ppt-toolbox'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }, name = 'PPT高频工具.pptx', filename = join(workspace, name)
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  slide.addText('工具验收', { x: 1, y: .5, w: 8, h: 1, fontSize: 28, objectName: 'source-a' })
  slide.addShape(ppt.ShapeType.rect, { x: 1, y: 2, w: 2, h: 1, fill: { color: '668ABD' }, objectName: 'source-b' })
  slide.addShape(ppt.ShapeType.ellipse, { x: 5, y: 3, w: 2, h: 1, fill: { color: 'E6A65A' }, objectName: 'source-c' })
  ppt.addSlide().addText('范围外保持', { x: 1, y: 1, w: 9, h: 1 })
  const bytes = await ppt.write({ outputType: 'uint8array' }); if (!(bytes instanceof Uint8Array)) throw new Error('fixture expected')
  writeFileSync(filename, bytes)
  const facts: Record<string, unknown> = { directory, status: 'running', phase: 'open', boundary: 'Real Electron tools, native clipboard and OOXML shared history; no model or PowerPoint claim.' }, errors: string[] = []
  let { app, page } = await launchM20(fixture, { visible: true })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    const editor = page.locator('.pptx-editor'), stage = editor.getByTestId('pptx-edit-surface')
    await expect(stage).toContainText('工具验收', { timeout: 45000 })
    const save = async () => { await editor.getByRole('button', { name: '保存', exact: true }).click() }
    const openMore = async () => {
      const more = page.getByRole('button', { name: '更多对象与文字操作', exact: true })
      if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
    }
    facts.phase = 'shift-select-and-handles'
    await stage.evaluate(root => {
      const host=root.closest('.office-file-view')!,viewport=root.parentElement!,toolbar=host.querySelector('.pptx-editor__toolbar')!
      const rect=(element:Element|null)=>{if(!element)return null;const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
      const samples:unknown[]=[]
      const record=(reason:string,event?:PointerEvent)=>{
        if(samples.length>=160)return
        samples.push({at:performance.now(),reason,pointer:event?{x:event.clientX,y:event.clientY,type:event.type}:undefined,
          surface:rect(root),viewport:rect(viewport),toolbar:rect(toolbar),
          status:[...host.querySelectorAll(':scope > .office-file-view__message')].map(element=>({role:element.getAttribute('role'),text:element.textContent,rect:rect(element)})),
          selection:rect(root.querySelector('[data-edit-selection-frame]')),rotation:rect(root.querySelector('[data-edit-rotation-handle]'))})
      }
      const pointer=(event:Event)=>record('pointer',event as PointerEvent)
      ;['pointerdown','pointermove','pointerup','dblclick'].forEach(type=>root.addEventListener(type,pointer,true))
      const resize=new ResizeObserver(()=>record('resize-observer'));[root,viewport,toolbar,host].forEach(element=>resize.observe(element))
      const changes=new MutationObserver(()=>record('host-status-mutation'));changes.observe(host,{childList:true})
      record('initial')
      ;(window as any).__pptHandleGeometry={finish:()=>{record('final');resize.disconnect();changes.disconnect();['pointerdown','pointermove','pointerup','dblclick'].forEach(type=>root.removeEventListener(type,pointer,true));return samples}}
    })
    const sourceShape = inspect(filename).slides[0].shapes.find(shape => shape.name === 'source-b')!
    const sourceId = sourceShape.shapeId, before = sourceShape.frame!
    const originalObjects = stage.locator('[data-edit-id]')
    await expect(originalObjects).toHaveCount(3)
    await originalObjects.nth(1).click()
    await originalObjects.nth(2).click({ modifiers: ['Shift'] })
    await expect(editor.locator('.pptx-editor__footer')).toContainText('已选 2 个对象')
    await originalObjects.nth(2).click({ modifiers: ['Shift'] })
    await expect(editor.locator('.pptx-editor__footer')).toContainText('已选 1 个对象')
    const frame = () => inspect(filename).slides[0].shapes.find(shape => shape.shapeId === sourceId)!.frame!
    const resize = await stage.locator('[data-edit-resize-handle="se"]').boundingBox(), canvasBox = await stage.boundingBox()
    if (!resize || !canvasBox) throw new Error('Native resize handle was not rendered')
    const resizeX = resize.x + resize.width / 2, resizeY = resize.y + resize.height / 2, dx = 52, dy = 28
    facts.resizeRequest={resize,canvasBox,resizeX,resizeY,dx,dy}
    await page.mouse.move(resizeX, resizeY); await page.mouse.down()
    await page.mouse.move(resizeX + dx, resizeY + dy, { steps: 8 }); await page.mouse.up(); await save()
    await expect.poll(() => frame().width).toBeGreaterThan(before.width + 5)
    const resized = frame(), pointsPerPixel = 960 / canvasBox.width // The fixture's 13 1/3-inch slide is 960 pt wide.
    expect(Math.abs(resized.width - before.width - dx * pointsPerPixel)).toBeLessThan(2)
    expect(Math.abs(resized.height - before.height - dy * pointsPerPixel)).toBeLessThan(2)
    expect(resized.x).toBeCloseTo(before.x, 1); expect(resized.y).toBeCloseTo(before.y, 1)
    const rotation = await stage.locator('[data-edit-rotation-handle]').boundingBox()
    const selectionFrame = await stage.locator('[data-edit-selection-frame]').boundingBox()
    if (!rotation || !selectionFrame) throw new Error('Native rotation handle was not rendered')
    const center = { x: selectionFrame.x + selectionFrame.width / 2, y: selectionFrame.y + selectionFrame.height / 2 }
    const from = { x: rotation.x + rotation.width / 2, y: rotation.y + rotation.height / 2 }
    const radius = Math.hypot(from.x - center.x, from.y - center.y)
    facts.rotationRequest={rotation,selectionFrame,center,from,radius,target:{x:center.x+radius/Math.sqrt(2),y:center.y-radius/Math.sqrt(2)}}
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(center.x + radius / Math.sqrt(2), center.y - radius / Math.sqrt(2), { steps: 10 })
    await page.mouse.up(); await save()
    await expect.poll(() => frame().rotation).toBeGreaterThan(40)
    const rotated = frame()
    facts.canvasGeometry=await page.evaluate(()=>(window as any).__pptHandleGeometry?.finish())
    facts.canvasHandles = { shiftMultiSelection: 2, shapeId: sourceId, before, resized, rotated }
    const samples=facts.canvasGeometry as Array<{at:number;surface:{x:number;y:number;width:number;height:number};pointer?:{type:string;x:number;y:number};selection:{x:number;y:number;width:number;height:number}|null}>
    for(const sample of samples)for(const key of ['x','y','width','height'] as const)
      expect(Math.abs(sample.surface[key]-samples[0].surface[key]),'canvas '+key+' at '+sample.at).toBeLessThan(.5)
    const rotationStart=samples.findIndex(sample=>sample.pointer?.type==='pointerdown'&&Math.hypot(sample.pointer.x-from.x,sample.pointer.y-from.y)<1)
    const rotationEnd=samples.findIndex((sample,at)=>at>rotationStart&&sample.pointer?.type==='pointerup')
    expect(rotationStart).toBeGreaterThanOrEqual(0);expect(rotationEnd).toBeGreaterThan(rotationStart)
    for(const sample of samples.slice(rotationStart,rotationEnd+1))if(sample.selection){
      expect(Math.abs(sample.selection.x+sample.selection.width/2-center.x)).toBeLessThan(.5)
      expect(Math.abs(sample.selection.y+sample.selection.height/2-center.y)).toBeLessThan(.5)
    }
    expect(Math.abs(rotated.rotation - 45)).toBeLessThan(1)
    expect(rotated.width).toBeCloseTo(resized.width, 1); expect(rotated.height).toBeCloseTo(resized.height, 1)
    expect(rotated.x + rotated.width / 2).toBeCloseTo(resized.x + resized.width / 2, 1)
    expect(rotated.y + rotated.height / 2).toBeCloseTo(resized.y + resized.height / 2, 1)
    await page.screenshot({ path: join(directory, '00-canvas-handles.png'), fullPage: true })
    facts.phase = 'group-and-clipboard'
    await editor.getByRole('button', { name: '页面操作', exact: true }).click()
    await editor.getByRole('button', { name: '全选本页对象（Ctrl+A）', exact: true }).click()
    await openMore()
    await page.getByRole('button', { name: '组合选中对象', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'group').length).toBe(1)
    await openMore()
    await page.getByRole('button', { name: '解组', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'group').length).toBe(0)
    await page.getByRole('button', { name: '创建对象副本（Ctrl+D）', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.length).toBe(6)
    await stage.locator('[data-web-ppt-editor]').first().focus()
    await page.keyboard.press('Control+C'); await page.keyboard.press('Control+V'); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.length).toBe(9)
    await openMore()
    await page.getByRole('combobox', { name: '排列对象', exact: true }).selectOption('left'); await save()
    await editor.getByRole('button', { name: '对象选择窗格', exact: true }).click()
    await expect(editor.locator('.pptx-editor__object-list')).toContainText('source-a')
    facts.phase = 'text-and-table'
    await editor.getByRole('button', { name: '插入文本框', exact: true }).click()
    await openMore()
    await page.getByRole('combobox', { name: '字号', exact: true }).selectOption('40')
    await page.getByRole('button', { name: '加粗', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(shape => shape.text === '双击编辑文字')?.runs[0]?.[0]?.style.fontSize).toBe(40)
    expect(inspect(filename).slides[0].shapes.find(shape => shape.text === '双击编辑文字')?.runs[0]?.[0]?.style.bold).toBe(true)
    expect(inspect(filename).slides[0].shapes.find(shape => shape.text === '双击编辑文字')?.runs[0]?.[0]?.style.color).toBe('202124')
    await editor.getByRole('button', { name: '插入对象', exact: true }).click()
    await editor.getByRole('button', { name: '插入表格', exact: true }).click()
    await openMore()
    await page.getByRole('button', { name: '表格添加行', exact: true }).click()
    await openMore()
    await page.getByRole('button', { name: '表格添加列', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(shape => shape.kind === 'table')?.cells?.length).toBe(4)
    expect(inspect(filename).slides[0].shapes.find(shape => shape.kind === 'table')?.cells?.[0]).toHaveLength(4)
    await stage.locator('[data-edit-id]').last().click({ button: 'right' })
    await page.getByRole('menu', { name: '对象快捷操作' }).getByRole('menuitem', { name: '创建副本', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table').length).toBe(2)
    await page.screenshot({ path: join(directory, '01-toolbox.png'), fullPage: true })
    facts.phase = 'shared-history'
    await editor.getByRole('button', { name: '撤销', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table').length).toBe(1)
    await editor.getByRole('button', { name: '重做', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table').length).toBe(2)
    expect(inspect(filename).slides[1].shapes[0].text).toBe('范围外保持')
    facts.phase = 'cold-reopen'; await closeM20(app); ({ app, page } = await launchM20(fixture, { visible: true }))
    page.on('pageerror', error => errors.push(error.message))
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    await expect(page.getByTestId('pptx-edit-surface')).toContainText('双击编辑文字', { timeout: 45000 })
    expect(inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table')).toHaveLength(2)
    for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) expect(frame()[key]).toBeCloseTo(rotated[key], 2)
    expect(errors).toEqual([]); facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await m20Evidence(info, fixture, page, facts)
  } catch (error) { facts.errors = errors; facts.canvasGeometry ??= await page.evaluate(()=>(window as any).__pptHandleGeometry?.finish()).catch(()=>undefined); await m20Evidence(info, fixture, page, facts, error); throw error }
  finally { await closeM20(app) }
})

test('PPT selection geometry stays fixed for shapes, text, images, tables and cleared selection', async ({}, info) => {
  test.skip(process.platform !== 'win32');test.setTimeout(90000)
  const base=resolve('output/office-coedit-20261103/ppt-selection-geometry');mkdirSync(base,{recursive:true})
  const directory=mkdtempSync(join(base,'run-')),workspace=join(directory,'workspace');mkdirSync(workspace)
  const fixture={directory,workspace,profile:join(directory,'profile')},name='选区位置稳定.pptx',filename=join(workspace,name)
  const ppt=new PptxGenJS();ppt.layout='LAYOUT_WIDE';const slide=ppt.addSlide()
  // PptxGenJS allocates its first table spid=2; author it first so later shapes receive unique IDs.
  slide.addTable([[{text:'甲'},{text:'乙'}],[{text:'丙'},{text:'丁'}]],{x:7,y:2,w:3,h:1.5})
  slide.addText('固定文字',{x:1,y:.5,w:5,h:1,fontSize:28,objectName:'text'})
  slide.addShape(ppt.ShapeType.rect,{x:1,y:2,w:2,h:1,fill:{color:'668ABD'},objectName:'shape'})
  slide.addImage({data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=',x:4,y:2,w:2,h:1,objectName:'image'})
  const bytes=await ppt.write({outputType:'uint8array'});if(!(bytes instanceof Uint8Array))throw Error('PPT fixture expected');writeFileSync(filename,bytes)
  const authored=inspect(filename).slides[0].shapes
  expect(new Set(authored.map(shape=>shape.shapeId)).size,'Fixture object IDs must be unambiguous').toBe(authored.length)
  const {openEditor}=await import('@web-ppt/editor'),source=await openEditor(bytes,{historyLimit:0})
  try{expect(Object.values(source.editor.doc.elements).map(element=>element.meta.editable)).toEqual(['full','full','full','full'])}finally{source.dispose()}
  const facts:Record<string,unknown>={directory,status:'running',phase:'open',boundary:'Real pointer selection geometry; no editor content mutation'},transitions:unknown[]=[]
  const {app,page}=await launchM20(fixture,{visible:true})
  try{
    await chooseM20Workspace(app,page,workspace);await m20Row(page,name).dblclick()
    const editor=page.locator('.pptx-editor'),stage=editor.getByTestId('pptx-edit-surface')
    await expect(stage).toContainText('固定文字',{timeout:45000})
    const initial=await stage.boundingBox();if(!initial)throw Error('Canvas geometry missing')
    facts.initial=initial;facts.transitions=transitions
    const check=async(kind:string)=>{const frame=await stage.boundingBox();transitions.push({kind,frame});expect(frame).not.toBeNull();for(const key of ['x','y','width','height'] as const)expect(Math.abs(frame![key]-initial[key]),kind+' canvas '+key).toBeLessThan(.5)}
    const objects=stage.locator('[data-edit-id]');await expect(objects).toHaveCount(4)
    const object=(kind:'shape'|'image'|'table')=>objects.nth(authored.findIndex(shape=>kind==='table'?shape.kind==='table':shape.name===kind))
    const showGroup = async (kind: string) => {
      await page.getByRole('button',{name:'更多对象与文字操作',exact:true}).click()
      const group=page.getByRole('group',{name:kind,exact:true})
      await expect(group).toBeVisible()
      return group
    }
    facts.phase='shape';await object('shape').click();await showGroup('形状工具');await check('shape');await page.keyboard.press('Escape')
    await stage.evaluate(root=>{
      const rect=(value:Element)=>{const r=value.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}
      const brief=(value:EventTarget|null)=>value instanceof Element?{tag:value.tagName,cls:value.getAttribute('class'),editId:value.getAttribute('data-edit-id'),owner:value.closest('[data-edit-id]')?.getAttribute('data-edit-id'),text:value.textContent?.slice(0,60),rect:rect(value)}:String(value)
      const state=()=>({at:performance.now(),surface:rect(root),active:brief(document.activeElement),focus:document.hasFocus(),editable:root.querySelectorAll('[contenteditable="true"]').length,roots:[...root.children].map(brief),objects:[...root.querySelectorAll('[data-edit-id]')].map(brief)})
      const events:unknown[]=[],names=['pointerdown','pointerup','click','dblclick','focus','blur','focusin','focusout']
      const receive=(event:Event)=>{if(events.length>=80)return;const mouse=event as MouseEvent;events.push({type:event.type,at:performance.now(),trusted:event.isTrusted,detail:mouse.detail,x:mouse.clientX,y:mouse.clientY,target:brief(event.target),path:event.composedPath().slice(0,7).map(brief),hits:Number.isFinite(mouse.clientX)?document.elementsFromPoint(mouse.clientX,mouse.clientY).slice(0,10).map(brief):[],state:state()})}
      names.forEach(name=>window.addEventListener(name,receive,true));const initial=state()
      ;(window as any).__pptSelectionGeometry={finish:()=>{names.forEach(name=>window.removeEventListener(name,receive,true));return{initial,events,final:state()}}}
    })
    facts.phase='text'
    facts.titleBefore=await stage.getByText('固定文字',{exact:true}).first().evaluate(element=>{
      const rect=(r:DOMRect)=>({x:r.x,y:r.y,width:r.width,height:r.height}),range=document.createRange();range.selectNodeContents(element)
      return{html:element.outerHTML,rect:rect(element.getBoundingClientRect()),range:rect(range.getBoundingClientRect())}
    })
    await stage.getByText('固定文字',{exact:true}).first().dblclick()
    await expect(stage.locator('[contenteditable="true"]').filter({visible:true}).first()).toBeVisible();await check('text');await page.keyboard.press('Escape');await check('text-exit')
    facts.phase='image';await object('image').click();await showGroup('图片工具');await check('image');await page.keyboard.press('Escape')
    facts.phase='table';await object('table').click();await showGroup('表格工具');await check('table');await page.keyboard.press('Escape')
    facts.phase='none';await page.mouse.click(initial.x+initial.width*.96,initial.y+initial.height*.95)
    await expect(editor.locator('.pptx-editor__footer')).not.toContainText('已选');await check('none')
    facts.selectionTrace=await page.evaluate(()=>(window as any).__pptSelectionGeometry?.finish())
    facts.phase='narrow-context-controls'
    const browserWindow=await app.browserWindow(page);await browserWindow.evaluate(window=>window.setContentSize(900,900))
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(950)
    facts.narrowWindowWidth=await page.evaluate(()=>innerWidth)
    const narrow:unknown[]=[];facts.narrow=narrow
    for(const kind of ['table','image'] as const){
      await object(kind).click();const before=await stage.boundingBox()
      const group=await showGroup(kind==='table'?'表格工具':'图片工具')
      await group.getByRole('button').last().scrollIntoViewIfNeeded()
      await expect(group.getByRole('button').last()).toBeInViewport()
      expect(await stage.boundingBox()).toEqual(before)
      narrow.push({kind,viewport:before});await page.screenshot({path:join(directory,'narrow-'+kind+'.png'),fullPage:true})
      await page.keyboard.press('Escape')
    }
    expect(readFileSync(filename)).toEqual(Buffer.from(bytes));facts.status='passed';facts.phase='complete'
    await m20Evidence(info,fixture,page,facts)
  }catch(error){facts.selectionTrace=await page.evaluate(()=>(window as any).__pptSelectionGeometry?.finish()).catch(()=>undefined);await m20Evidence(info,fixture,page,facts,error);throw error}
  finally{await closeM20(app)}
})
