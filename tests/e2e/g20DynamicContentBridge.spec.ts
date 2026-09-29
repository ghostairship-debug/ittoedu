import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { openInWorkbench, root } from './helpers/g20M19Harness'
import { canvasReady } from './helpers/g20M21Harness'
import { liveCourse, liveCourseState, QUESTIONS } from './helpers/g20M15Harness'

const COURSE = 'm15-dynamic-bridge.h5lesson'
type Discovered = { target: string; kind: 'text' | 'image'; source: 'declared' | 'host-observed'; text?: string }

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

    // The grant freezes the actual document identity and only these two canonical objects.
    const granted = await page.evaluate(async ({ folder, file }) => {
      const desktop = window.desktopAPI
      const workspaceId = (await desktop.execution!.workspace(folder)).workspace.workspaceId
      const conversation = await desktop.execution!.createConversation(workspaceId, '动态图文宿主桥接验证')
      const document = (await desktop.documents!.list()).find(entry => entry.binding.kind === 'file'
        && entry.binding.path.endsWith(file))
      if (!document || document.model.kind !== 'course-v9') throw new Error('正式课件未打开')
      const location = document.model.project.locations.find(entry => entry.kind === 'slide-scene')
      if (!location) throw new Error('缺少 Slide 位置')
      const result = await desktop.externalMcp!.grant({ workspaceId, conversationId: conversation.conversationId,
        expectedRevision: conversation.revision, instruction: '验证宿主观察到的图文目标，并修改小测验标题',
        documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision,
          writable: [{ kind: 'course-object', locationId: location.id, itemId: 'quiz' },
            { kind: 'course-object', locationId: location.id, itemId: 'card' }] }] })
      return { connection: result.connection, revision: document.revision }
    }, { folder: workspace, file: COURSE })
    evidence.documentRevision = granted.revision
    client = new Client({ name: 'guoling-m15-host-bridge-e2e', version: '1' })
    const transport = new StreamableHTTPClientTransport(new URL(granted.connection.endpoint),
      { requestInit: { headers: { Authorization: `Bearer ${granted.connection.bearer}` } } })
    await client.connect(transport)
    const resource = await client.readResource({ uri: 'guoling://task/context' })
    const body = resource.contents[0]
    if (!body || !('text' in body)) throw new Error('MCP 上下文不是文字资源')
    const context = JSON.parse(body.text) as { documents: Array<{ writable: Array<{ target: string }> }>;
      operationTickets: string[] }
    const [quizObject, cardObject] = context.documents[0]!.writable
    if (!quizObject?.target || !cardObject?.target || !context.operationTickets[0])
      throw new Error('外部 MCP 未发放对象句柄或操作票据')
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
      ticket: context.operationTickets[0], arguments: { target: quizText.target, text: changedText },
    } })
    const receipt = (applied.structuredContent as { result: ToolResult }).result
    expect(receipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await expect.poll(async () => (await liveCourseState(page, COURSE)).quiz.overrides).toEqual([
      { original: QUESTIONS[0], region: 'div>h2', text: changedText },
    ])
    const state = await liveCourseState(page, COURSE)
    expect(state.revision).toBe(granted.revision + 1)
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
