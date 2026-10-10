import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { openInWorkbench, root } from './helpers/g20M19Harness'
import { canvasReady } from './helpers/g20M21Harness'
import { liveCourse, liveCourseState, QUESTIONS } from './helpers/g20M15Harness'

const COURSE = 'm15-dynamic-bridge.h5lesson'
type Discovered = { target: string; kind: 'text' | 'image'; source: 'declared' | 'host-observed'; text?: string }
type ListedTarget = { target: string; label: string; kind: ToolTarget['kind'] }

test('M27-T03: real M15 host hits publish through Main and external MCP commits a Runtime text edit', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(180_000)
  const base = join(root, 'output/g20/b21/dynamic-content-bridge-electron')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, COURSE), liveCourse())
  const evidence: Record<string, unknown> = { directory }
  const pageErrors: string[] = []
  let app: ElectronApplication | undefined
  let client: Client | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await openInWorkbench(page, COURSE)
    await canvasReady(page)
    await expect(page.getByTestId('runtime-authoring-targets')
      .getByRole('button', { name: new RegExp(`^${QUESTIONS[0]}`) })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.published-authoring-host [data-m15-card-picture]')).toBeVisible()

    // The resident session opens this workspace file and discovers its two canonical objects.
    const connection = await page.evaluate(async ({ folder, file }) => {
      const desktop = window.desktopAPI
      const workspaceId = (await desktop.execution!.workspace(folder)).workspace.workspaceId
      const document = (await desktop.documents!.list()).find(entry => entry.binding.kind === 'file'
        && entry.binding.path.endsWith(file))
      if (!document || document.model.kind !== 'course-v9') throw new Error('正式课件未打开')
      const location = document.model.project.locations.find(entry => entry.kind === 'slide-scene')
      if (!location) throw new Error('缺少 Slide 位置')
      const status = await desktop.externalMcp!.configure({ enabled: true })
      if (status.state !== 'running') throw new Error(`Resident MCP 未运行：${status.message ?? status.state}`)
      return { endpoint: status.endpoint, workspaceId,
        documentId: document.documentId, revision: document.revision, locationLabel: location.label }
    }, { folder: workspace, file: COURSE })
    evidence.documentRevision = connection.revision
    client = new Client({ name: 'guoling-m15-host-bridge-e2e', version: '1' })
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
    const [quizObject, cardObject] = ['小测验', '词语卡片'].map(label => {
      const matches = nodes.filter(entry => entry.kind === 'course-object' && entry.label === label)
      expect(matches).toHaveLength(1)
      return matches[0]!
    })
    if (!quizObject || !cardObject) throw new Error('MCP 未返回两个对象句柄')
    expect(quizObject.target).not.toBe(cardObject.target)
    const discover = async (objectTarget: string): Promise<Discovered[]> => {
      const response = await client!.callTool({ name: 'content.targets', arguments: { arguments: { target: objectTarget } } })
      const result = (response.structuredContent as { result: ToolResult }).result
      if (result.kind !== 'read') throw new Error(`content.targets: ${JSON.stringify(result)}`)
      return (result.data as { targets: Discovered[] }).targets
    }
    let quizTargets: Discovered[] = [], cardTargets: Discovered[] = []
    await expect.poll(async () => {
      quizTargets = await discover(quizObject.target)
      cardTargets = await discover(cardObject.target)
      return quizTargets.some(hit => hit.source === 'host-observed' && hit.kind === 'text' && hit.text === QUESTIONS[0])
        && cardTargets.some(hit => hit.source === 'host-observed' && hit.kind === 'image')
    }, { timeout: 60_000, intervals: [200, 500, 1000] }).toBe(true)
    const quizText = quizTargets.find(hit => hit.source === 'host-observed'
      && hit.kind === 'text' && hit.text === QUESTIONS[0])!
    const cardImage = cardTargets.find(hit => hit.source === 'host-observed' && hit.kind === 'image')!
    evidence.discovered = { quizText: { kind: quizText.kind, source: quizText.source, text: quizText.text },
      cardImage: { kind: cardImage.kind, source: cardImage.source },
      declaredRuntimeImage: quizTargets.some(hit => hit.source === 'declared' && hit.kind === 'image') }

    const changedText = '桥接验证：选出正确图片'
    const applied = await client.callTool({ name: 'content.update', arguments: {
      arguments: { target: quizText.target, text: changedText },
    } })
    const receipt = (applied.structuredContent as { result: ToolResult }).result
    expect(receipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await expect.poll(async () => (await liveCourseState(page, COURSE)).quiz.overrides).toEqual([
      { original: QUESTIONS[0], region: 'div>h2', text: changedText },
    ])
    const state = await liveCourseState(page, COURSE)
    expect(state.revision).toBe(connection.revision + 1)
    await expect(page.locator('.published-authoring-host [data-m15-question]')).toHaveText(changedText, { timeout: 60_000 })
    evidence.receipt = receipt
    evidence.final = { revision: state.revision, overrides: state.quiz.overrides }
    expect(pageErrors).toEqual([])
  } finally {
    evidence.pageErrors = pageErrors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await client?.close().catch(() => {})
    await app?.evaluate(({ app: electronApp, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
      electronApp.exit(0)
    }).catch(() => {})
  }
})
