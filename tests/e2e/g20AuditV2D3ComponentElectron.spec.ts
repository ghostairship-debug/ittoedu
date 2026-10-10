import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { componentPackageMeta } from '../../src/shared/componentPackageMeta'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { cardPackage, liveCourse } from './helpers/g20M15Harness'
import { openInWorkbench, root } from './helpers/g20M19Harness'
import { canvasReady } from './helpers/g20M21Harness'

const COURSE = 'D3 Component 真实宿主截断.h5lesson'

const SOURCE = `window.CoursewareComponent.define({id:'m15-card',runtimeApiVersion:4,create(context){
  var root=context.dom.root, tag=context.props.tag, list=document.createElement('div');
  list.setAttribute('data-d3-component-list',tag);
  list.style.cssText='position:absolute;inset:0;overflow:hidden;';
  function add(){var span=document.createElement('span'),n=list.children.length;
    span.textContent=tag+'自动目标 '+n;
    span.style.cssText='display:block;position:absolute;left:1px;top:'+n+'px;width:100px;height:1px;font:1px/1px sans-serif;white-space:nowrap;';
    list.appendChild(span)}
  for(var i=0;i<context.props.count;i++)add();
  var declared=document.createElement('span');declared.textContent=context.props.note;
  declared.setAttribute('data-courseware-edit-key','note');
  declared.setAttribute('data-courseware-edit-label',tag+'声明目标');
  declared.style.cssText='position:absolute;left:8px;top:450px;width:240px;height:28px;font:20px sans-serif;';
  var plus=document.createElement('button');plus.setAttribute('data-d3-component-add',tag);
  plus.setAttribute('aria-label','新增一个自动目标');
  plus.style.cssText='position:absolute;left:0;bottom:0;width:4px;height:4px;opacity:.01';
  plus.addEventListener('click',add);
  var minus=document.createElement('button');minus.setAttribute('data-d3-component-remove',tag);
  minus.setAttribute('aria-label','删除一个自动目标');
  minus.style.cssText='position:absolute;left:6px;bottom:0;width:4px;height:4px;opacity:.01';
  minus.addEventListener('click',function(){if(list.lastElementChild)list.lastElementChild.remove()});
  root.append(list,declared,plus,minus);return{destroy:function(){root.replaceChildren()}};
}});`

type Discovery = { targets: Array<{ text?: string; source?: string; kind?: string }>; truncated?: boolean; notice?: string }
type ListedTarget = { target: string; label: string; kind: ToolTarget['kind'] }

async function closeApp(app: ElectronApplication | undefined) {
  await app?.evaluate(({ app: electronApp, BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    electronApp.exit(0)
  }).catch(() => {})
  await app?.close().catch(() => {})
}

test('D3: real Electron Component instances preserve declared targets and publish metadata-only truncation', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(240_000)
  const base = join(root, 'output/g20/audit-v2/d3-component-electron')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const archived = openCourseProjectArchive(liveCourse('D3 Component 真实宿主截断'))
  const project = structuredClone(archived.project)
  const slide = project.surfaces.find(surface => surface.type === 'slide')
  if (slide?.type !== 'slide') throw new Error('缺少 Slide surface')
  const scene = slide.scenes[0]
  if (!scene) throw new Error('缺少 Slide scene')
  const primary = scene.layerItems.find(item => item.kind === 'component')
  if (!primary || primary.kind !== 'component') throw new Error('缺少 Component')
  primary.label = 'D3 当前组件实例'
  primary.order = 1
  primary.frame = { mode: 'absolute', x: 40, y: 100, width: 760, height: 520 }
  primary.props = { tag: '当前', count: 400, note: '当前声明文字' }
  const secondary = structuredClone(primary)
  secondary.layerItemId = 'd3-secondary-component'
  secondary.label = 'D3 其它组件实例'
  secondary.order = 2
  secondary.frame = { mode: 'absolute', x: 840, y: 100, width: 400, height: 520 }
  secondary.props = { tag: '其它', count: 1, note: '其它声明文字' }
  scene.layerItems = [primary, secondary]

  const original = cardPackage()
  const manifest = { ...original.manifest,
    defaultProps: { tag: '默认', count: 1, note: '默认声明文字' },
    editor: { properties: [{ key: 'note', label: '声明目标', type: 'text' as const }] },
  }
  const encode = (value: string) => new TextEncoder().encode(value)
  const files = { ...original.files, 'manifest.json': encode(JSON.stringify(manifest, null, 2)), 'runtime.js': encode(SOURCE) }
  const component = { manifest, runtimeSource: SOURCE, files, contentSha256: componentContentSha256(files) }
  project.componentPackages[manifest.id] = componentPackageMeta(component)
  writeFileSync(join(workspace, COURSE), createCourseProjectArchive({
    project: courseProjectDocumentSchema.parse(project), assetFiles: archived.assetFiles,
    componentFiles: { ...archived.componentFiles, [`${manifest.id}@${manifest.version}`]: files },
  }))

  let app: ElectronApplication | undefined
  let client: Client | undefined
  const evidence: Record<string, unknown> = { directory, sharedPackage: `${manifest.id}@${manifest.version}` }
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
    const currentList = page.locator('.published-authoring-host [data-d3-component-list="当前"]')
    const otherList = page.locator('.published-authoring-host [data-d3-component-list="其它"]')
    const overlay = page.getByTestId('runtime-authoring-targets')
    const currentDeclared = overlay.getByRole('button', { name: '当前声明目标，双击编辑组件文字', exact: true })
    const otherDeclared = overlay.getByRole('button', { name: '其它声明目标，双击编辑组件文字', exact: true })
    await expect(currentList.locator('span')).toHaveCount(400, { timeout: 60_000 })
    await expect(otherList.locator('span')).toHaveCount(1)
    await expect(currentDeclared).toBeVisible()
    await expect(otherDeclared).toBeVisible()

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
        documentId: document.documentId, documentRevision: document.revision, locationLabel: location.label }
    }, { folder: workspace, file: COURSE })

    client = new Client({ name: 'guoling-d3-component-audit-e2e', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)))
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
      const current = results.find(item => item.data.targets.some(target => target.text?.startsWith('当前自动目标')))
      const other = results.find(item => item.data.targets.some(target => target.text?.startsWith('其它自动目标')))
      if (!current || !other) throw new Error(`无法区分两个 Component 实例: ${JSON.stringify(results)}`)
      return { current, other }
    }
    // Component declared props use the existing authoring overlay. content.targets publishes their automatic hits.
    const values = (data: Discovery) => data.targets.map(({ kind, source, text }) => ({ kind, source, text }))
    let initial!: Awaited<ReturnType<typeof classify>>
    await expect.poll(async () => {
      try { initial = await classify(); return initial.current.data.targets.length === 400 && !initial.current.data.truncated && initial.other.data.targets.length === 1 && !initial.other.data.truncated } catch { return false }
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true)
    const initialValues = values(initial.current.data)
    const initialOther = values(initial.other.data)
    evidence.initial = { targetCount: initialValues.length, otherCount: initialOther.length, declaredOverlayCount: 2, documentRevision: connection.documentRevision }

    await page.locator('.published-authoring-host [data-d3-component-add="当前"]').dispatchEvent('click')
    await expect(currentList.locator('span')).toHaveCount(401)
    let over!: Awaited<ReturnType<typeof classify>>
    await expect.poll(async () => {
      try {
        over = await classify()
        return over.current.data.truncated === true && over.current.data.targets.length === 400 &&
          JSON.stringify(values(over.current.data)) === JSON.stringify(initialValues) &&
          JSON.stringify(values(over.other.data)) === JSON.stringify(initialOther) && !over.other.data.truncated
      } catch { return false }
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true)
    await expect(currentDeclared).toBeVisible()
    await expect(otherDeclared).toBeVisible()
    evidence.overflow = { targetCount: over.current.data.targets.length, notice: over.current.data.notice,
      metadataOnly: true, otherUnchanged: true, declaredOverlayCount: 2 }
    // The declared target still uses the formal in-place editor beyond the automatic 400-target limit.
    await currentDeclared.dispatchEvent('click')
    const editor = page.getByTestId('canvas-plain-text-editor').locator('input, textarea')
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue('当前声明文字')
    await editor.press('Escape')
    await expect(editor).toHaveCount(0)
    evidence.declaredEditableWhileTruncated = true

    await page.locator('.published-authoring-host [data-d3-component-remove="当前"]').dispatchEvent('click')
    await expect(currentList.locator('span')).toHaveCount(400)
    let cleared!: Awaited<ReturnType<typeof classify>>
    await expect.poll(async () => {
      try {
        cleared = await classify()
        return !cleared.current.data.truncated && !cleared.current.data.notice &&
          JSON.stringify(values(cleared.current.data)) === JSON.stringify(initialValues) &&
          JSON.stringify(values(cleared.other.data)) === JSON.stringify(initialOther) && !cleared.other.data.truncated && !cleared.other.data.notice
      } catch { return false }
    }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true)
    await expect(currentDeclared).toBeVisible()
    await expect(otherDeclared).toBeVisible()
    const revision = await page.evaluate(async file => {
      const document = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
      if (!document) throw new Error('正式课件已关闭')
      return document.revision
    }, COURSE)
    expect(revision).toBe(connection.documentRevision)
    evidence.cleared = { targetCount: cleared.current.data.targets.length, otherUnchanged: true, noticeCleared: true, documentRevision: revision }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    // An actual Component instance needs a truthful per-instance limit diagnostic.
    expect(over.current.data.notice).toMatch(/400.*Component.*按实例.*已声明目标/)
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await client?.close().catch(() => {})
    await closeApp(app)
  }
})
