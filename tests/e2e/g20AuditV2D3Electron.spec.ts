import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { liveCourse } from './helpers/g20M15Harness'
import { openInWorkbench, root } from './helpers/g20M19Harness'
import { canvasReady } from './helpers/g20M21Harness'

const COURSE = 'D3 真实宿主截断.h5lesson'

function overflowSource(count: number): string {
  return `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
    var root=ctx.dom.root, list=document.createElement('div');
    list.style.cssText='position:absolute;inset:0;overflow:hidden;';
    function add(){var s=document.createElement('span');var n=list.children.length;s.textContent='自动目标 '+n;s.style.cssText='display:block;position:absolute;left:1px;top:'+n+'px;width:80px;height:1px;font:1px/1px sans-serif;white-space:nowrap;';list.appendChild(s)}
    for(var i=0;i<${count};i++)add();
    var plus=document.createElement('button');plus.setAttribute('data-d3-add','');plus.setAttribute('aria-label','新增一个自动目标');plus.style.cssText='position:absolute;left:0;bottom:0;width:4px;height:4px;opacity:.01';
    plus.addEventListener('click',add);
    var minus=document.createElement('button');minus.setAttribute('data-d3-remove','');minus.setAttribute('aria-label','删除一个自动目标');minus.style.cssText='position:absolute;left:6px;bottom:0;width:4px;height:4px;opacity:.01';
    minus.addEventListener('click',function(){if(list.lastElementChild)list.lastElementChild.remove()});
    root.append(list,plus,minus);return{destroy:function(){root.replaceChildren()}};
  }});`
}

const smallSource = `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){var p=document.createElement('p');p.textContent='另一个对象';p.style.cssText='position:absolute;left:8px;top:8px;font:16px sans-serif;';ctx.dom.root.appendChild(p);return{destroy:function(){p.remove()}}}});`

type Discovery = { targets: Array<{ text?: string; source?: string; kind?: string }>; truncated?: boolean; notice?: string }
type ListedTarget = { target: string; label: string; kind: ToolTarget['kind'] }

async function closeApp(app: ElectronApplication | undefined) {
  await app?.evaluate(({ app: electronApp, BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    electronApp.exit(0)
  }).catch(() => {})
  await app?.close().catch(() => {})
}

test('D3: real Electron MCP observes Runtime auto-target truncation across add/delete', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(240_000)
  const base = join(root, 'output/g20/audit-v2/d3-electron')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const archived = openCourseProjectArchive(liveCourse('D3 真实宿主截断'))
  const project = structuredClone(archived.project)
  const slide = project.surfaces.find(surface => surface.type === 'slide')
  if (slide?.type !== 'slide') throw new Error('缺少 Slide surface')
  const scene = slide.scenes[0]
  if (!scene) throw new Error('缺少 Slide scene')
  const primary = scene.layerItems.find(item => item.kind === 'runtime')
  if (!primary || primary.kind !== 'runtime') throw new Error('缺少 Runtime')
  primary.label = 'D3 当前对象'
  primary.runtime.source = overflowSource(400)
  const secondary = structuredClone(primary)
  secondary.layerItemId = 'd3-secondary-runtime'
  secondary.label = 'D3 其它对象'
  secondary.order = 4
  secondary.frame = { ...secondary.frame, x: 820, width: 380 }
  secondary.runtime.source = smallSource
  scene.layerItems = [...scene.layerItems, secondary] as never
  writeFileSync(join(workspace, COURSE), createCourseProjectArchive({
    project: courseProjectDocumentSchema.parse(project), assetFiles: archived.assetFiles, componentFiles: archived.componentFiles,
  }))

  let app: ElectronApplication | undefined
  let client: Client | undefined
  const evidence: Record<string, unknown> = { directory }
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await openInWorkbench(page, COURSE)
    await canvasReady(page)
    await expect(page.locator('.published-authoring-host [data-d3-add]')).toBeVisible({ timeout: 60_000 })

    const connection = await page.evaluate(async ({ folder, file }) => {
      const desktop = window.desktopAPI
      const workspaceId = (await desktop.execution!.workspace(folder)).workspace.workspaceId
      const document = (await desktop.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
      if (!document || document.model.kind !== 'course-v9') throw new Error('正式课件未打开')
      const location = document.model.project.locations.find(entry => entry.kind === 'slide-scene')
      if (!location) throw new Error('缺少 Slide 位置')
      const status = await desktop.externalMcp!.configure({ enabled: true })
      if (status.state !== 'running') throw new Error(`Resident MCP 未运行：${status.message ?? status.state}`)
      return { endpoint: status.endpoint, workspaceId,
        documentId: document.documentId, locationLabel: location.label }
    }, { folder: workspace, file: COURSE })

    client = new Client({ name: 'guoling-d3-audit-e2e', version: '1' })
    const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint))
    await client.connect(transport)
    const readTool = async <T,>(name: string, input: Record<string, unknown>): Promise<T> => {
      const response = await client!.callTool({ name, arguments: { arguments: input } })
      const result = (response.structuredContent as { result: ToolResult }).result
      if (result.kind !== 'read') throw new Error(`${name}: ${JSON.stringify(result)}`)
      return result.data as T
    }
    await readTool('workspace.switch', { workspaceId: connection.workspaceId })
    const opened = await readTool<{ target: string; documentId: string }>('file.open', { path: COURSE })
    expect(opened.documentId).toBe(connection.documentId)
    await readTool('tools.load', { families: ['content'] })
    const locations = await readTool<ListedTarget[]>('listChildren', { target: opened.target })
    const location = locations.find(entry => entry.kind === 'course-location' && entry.label === connection.locationLabel)
    if (!location) throw new Error('MCP 未返回 Slide 页面句柄')
    const nodes = await readTool<ListedTarget[]>('listChildren', { target: location.target })
    const handles = [primary.label, secondary.label].map(label => {
      const matches = nodes.filter(entry => entry.kind === 'course-object' && entry.label === label)
      expect(matches).toHaveLength(1)
      return matches[0]!.target
    })
    expect(handles).toHaveLength(2)
    expect(new Set(handles).size).toBe(2)
    const discover = async (target: string): Promise<Discovery> => {
      const response = await client!.callTool({ name: 'content.targets', arguments: { arguments: { target } } })
      const result = (response.structuredContent as { result: ToolResult }).result
      if (result.kind !== 'read') throw new Error(`content.targets: ${JSON.stringify(result)}`)
      return result.data as Discovery
    }
    const classify = async () => {
      const results = await Promise.all(handles.map(async target => ({ target, data: await discover(target) })))
      evidence.lastResults = results
      const overflow = results.find(item => item.data.targets.some(target => target.text?.startsWith('自动目标')))
      const other = results.find(item => item !== overflow)
      if (!overflow || !other) throw new Error(`无法区分两个 Runtime: ${JSON.stringify(results)}`)
      return { overflow, other }
    }
    let initial!: Awaited<ReturnType<typeof classify>>
    await expect.poll(async () => {
      try { initial = await classify(); return initial.overflow.data.targets.length === 401 && !initial.overflow.data.truncated && !initial.other.data.truncated } catch { return false }
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true)
    const initialTexts = initial.overflow.data.targets.map(target => target.text)
    evidence.initial = { targetCount: initial.overflow.data.targets.length, otherCount: initial.other.data.targets.length }

    await page.locator('.published-authoring-host [data-d3-add]').dispatchEvent('click')
    let over!: Awaited<ReturnType<typeof classify>>
    await expect.poll(async () => {
      try {
        over = await classify()
        return over.overflow.data.truncated === true && over.overflow.data.targets.length === 401 &&
          JSON.stringify(over.overflow.data.targets.map(target => target.text)) === JSON.stringify(initialTexts) &&
          /400.*按层.*已声明目标/.test(over.overflow.data.notice ?? '') && !over.other.data.truncated
      } catch { return false }
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true)
    evidence.overflow = { targetCount: over.overflow.data.targets.length, notice: over.overflow.data.notice, otherTruncated: over.other.data.truncated }

    await page.locator('.published-authoring-host [data-d3-remove]').dispatchEvent('click')
    let cleared!: Awaited<ReturnType<typeof classify>>
    await expect.poll(async () => {
      try {
        cleared = await classify()
        return !cleared.overflow.data.truncated && cleared.overflow.data.targets.length === 401 && !cleared.other.data.truncated
      } catch { return false }
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true)
    evidence.cleared = { targetCount: cleared.overflow.data.targets.length, otherTruncated: cleared.other.data.truncated }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await client?.close().catch(() => {})
    await closeApp(app)
  }
})
