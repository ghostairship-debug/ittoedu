import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument, CourseRuntimeDefinition, FlowSurfaceDocument, NativeLayerItem, RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { sampleFlowD5 } from './helpers/flowD5Sampling'

const root = resolve(__dirname, '../..')
const runtimeId = 'm16-flow-long-runtime'
const nativeId = 'm16-flow-paper-annotation'
const runtimeSource = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
  var expanded=false, extra=0, root=document.createElement('section'); root.dataset.m16FlowRuntime='true';
  root.style.cssText='box-sizing:border-box;width:100%;padding:12px;background:#e0f2fe;border:2px solid #0369a1';
  var button=document.createElement('button'); button.type='button'; button.dataset.m16FlowRuntimeToggle='true';
  button.textContent='展开 Runtime 内容';
  var grow=document.createElement('button'); grow.textContent='增长文字'; grow.dataset.d5Grow='true';
  var content=document.createElement('div'); content.dataset.m16FlowRuntimeContent='true';
  function render(){
    button.textContent=expanded?'收起 Runtime 内容':'展开 Runtime 内容';
    content.replaceChildren();
    var count=(expanded?14:2)+extra;
    for(var i=0;i<count;i++){var p=document.createElement('p');p.textContent='动态排版内容 '+(i+1)+'：文字增长后随可用宽度重新换行。'.repeat(4);p.style.cssText='margin:8px 0;line-height:24px';content.appendChild(p)}
  }
  button.addEventListener('click',function(){expanded=!expanded;render()});
  grow.addEventListener('click',function(){extra+=4;render()});
  root.append(button,grow,content); ctx.dom.root.appendChild(root); render();
  return {destroy(){button.remove();root.remove()}};
}});`

function runtime(): CourseRuntimeDefinition {
  return { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: runtimeSource,
    content: { values: {} }, assets: {} }
}

function fixture(): Uint8Array {
  let project = createBlankCourseProject({ title: 'M16 Flow Runtime 长内容', now: '2026-09-27T00:00:00.000Z', includeDefaultController: false, controls: 'none' })
  const added = addCourseFlowPage(project, { title: 'Runtime 长页面', expectedRevision: project.revision })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  const flow = project.surfaces.find((surface): surface is FlowSurfaceDocument => surface.type === 'flow')
  if (!flow) throw new Error('Flow page was not created')
  const heading = flow.blocks[0]
  const anchor = flow.blocks[1]
  if (heading?.type !== 'heading' || anchor?.type !== 'paragraph') throw new Error('Flow fixture blocks are incomplete')
  heading.content.inlines = [{ type: 'text', text: 'Runtime 前置正文' }]
  anchor.content.inlines = [{ type: 'text', text: 'Runtime 后续正文' }]
  flow.blocks.push({ id: 'm16-flow-tail', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Runtime 页面尾部正文' }] } })

  const runtimeItem: RuntimeLayerItem = {
    layerItemId: runtimeId, label: '长内容 DOM Runtime', kind: 'runtime',
    frame: { mode: 'absolute', x: 44, y: 260, width: 760, height: 150 }, order: 10,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper', runtime: runtime(),
  }
  flow.surfaceLayerItems.push({ item: runtimeItem, visibility: { mode: 'all', locationIds: [] },
    paragraphAnchor: { blockId: anchor.id, offsetY: 0, xRatio: 0 }, bodyPlane: 'overlay' })

  const native = sceneNodeToCourseLayerItem(createTextNode({ id: nativeId, name: '纸面原生标注', text: 'Native 纸面标注', x: 110, y: 360,
    width: 320, height: 76, style: { fontSize: 28, bold: true, color: '#7c2d12', backgroundColor: '#ffedd5' } })) as NativeLayerItem
  native.paperSpace = 'paper'
  native.order = 20
  flow.surfaceLayerItems.push({ item: native, visibility: { mode: 'all', locationIds: [] },
    paragraphAnchor: { blockId: anchor.id, offsetY: 80, xRatio: 0 }, bodyPlane: 'overlay' })
  project.startLocationId = project.locations.find(location => location.kind === 'flow-block' && location.surfaceId === flow.id)!.id
  const parsed: CourseProjectDocument = courseProjectDocumentSchema.parse(project)
  return createCourseProjectArchive({ project: parsed, assetFiles: {}, componentFiles: {} })
}

test('D5 real Flow Runtime content changes, continuous width changes and narrow viewport settle and cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'This sample exercises the Windows Electron workbench.')
  test.setTimeout(180_000)
  const directory = info.outputPath('flow-d5-dynamic')
  mkdirSync(directory, { recursive: true })
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const name = 'D5 Runtime 长内容.h5lesson', coursePath = join(workspace, name)
  writeFileSync(coursePath, fixture())
  const facts: Record<string, unknown> = { started: new Date().toISOString(), fixture: 'V9 Flow paper-anchored DOM Runtime; not an iframe or V10 side-wrap', samples: [] }
  const samples = facts.samples as unknown[]
  const errors: string[] = []
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Course editor did not bind a DocumentSession')
    const selectors = { runtime: '[data-m16-flow-runtime="true"]', tail: '[data-flow-block-id="m16-flow-tail"]', paper: '[data-testid="flow-paper"]' }
    const runtime = page.locator(selectors.runtime), toggle = page.locator('[data-m16-flow-runtime-toggle="true"]')
    await expect(runtime).toBeVisible()
    await expect(runtime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(2)
    const history = async () => page.evaluate(async id => {
      const snapshot = await window.desktopAPI!.documents!.read(id)
      return { revision: snapshot.revision, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth }
    }, documentId)
    const one = async (label: string, act: () => Promise<void>) => {
      try {
        const beforeBox = await runtime.boundingBox()
        const result = await sampleFlowD5(page, label, selectors, act, history)
        const afterBox = await runtime.boundingBox()
        if (!beforeBox || !afterBox) result.issues.push('runtime bounds missing')
        else if (label.includes('width') || label.includes('narrow')) {
          if (Math.abs(beforeBox.width - afterBox.width) <= 0.5) result.issues.push('runtime allocated width did not change; this does not exercise width-dependent layout')
        } else if (Math.abs(beforeBox.height - afterBox.height) <= 0.5) result.issues.push('runtime content height did not change')
        result.passed = result.issues.length === 0
        samples.push({ ...result, beforeBox, afterBox })
      } catch (error) { samples.push({ name: label, passed: false, failure: String(error) }) }
      await page.screenshot({ path: join(directory, `${label}.png`) }).catch(() => {})
      writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    }
    await one('01-text-growth', async () => { await page.locator('[data-d5-grow="true"]').click() })
    await expect(runtime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(6)
    await one('02-expand', async () => { await toggle.click() })
    await expect(runtime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(18)
    await one('03-collapse', async () => { await toggle.click() })
    await expect(runtime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(6)
    await one('04-continuous-width', async () => {
      for (const width of [1450, 1300, 1150, 1000, 1200]) await app!.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 900), width)
    })
    await one('05-narrow', async () => { await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(700, 900)) })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900))
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const saved = await page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)
    expect(saved.dirty).toBe(false)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(archive.project.surfaces.find(surface => surface.type === 'flow')).toMatchObject({ surfaceLayerItems: expect.arrayContaining([
      expect.objectContaining({ item: expect.objectContaining({ layerItemId: runtimeId, runtime: expect.objectContaining({ source: runtimeSource }) }) }),
    ]) })
    await page.locator('.workspace-document-tabs').getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const reopenedId = await frame.getAttribute('data-document-id')
    expect(reopenedId).toBeTruthy(); expect(reopenedId).not.toBe(documentId)
    await expect(runtime).toBeVisible()
    await expect(runtime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(2)
    await page.screenshot({ path: join(directory, '06-reopened.png') })
    facts.reopenedId = reopenedId; facts.savedSourcePreserved = true
    facts.pageErrors = errors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    expect(errors).toEqual([])
    expect(samples).toHaveLength(5)
    expect(samples.filter((sample: any) => !sample.passed)).toEqual([])
  } catch (error) {
    facts.failure = String(error); facts.pageErrors = errors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2))
    throw error
  } finally {
    if (app) { await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined); await app.close().catch(() => undefined) }
  }
})
