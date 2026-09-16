import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const root = resolve(__dirname, '../..')
const evidenceRoot = join(root, 'output/r19-cross-page-observation')

test('r19 real Slide host retains the frozen page while one candidate commits Slide Flow Spatial and captures next observation', async () => {
  test.setTimeout(90_000)
  const run = join(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'))
  const profile = join(run, 'profile'), fixtureFile = join(run, 'mixed-v9-source.h5lesson')
  mkdirSync(run, { recursive: true })
  const fixture = listCourseProjectV9Fixtures().find(entry => entry.id === 'mixed')!
  writeFileSync(fixtureFile, createCourseProjectArchive({ project: fixture.data.project, assetFiles: fixture.data.assetFiles, componentFiles: fixture.data.componentFiles }))
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, hmr: false,
    watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Renderer server is unavailable')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env,
    VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    const lesson = await page.evaluate(async directory => {
      const made = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '跨页面观察课例' })
      if (!made.lesson || !made.conversation) throw new Error('Independent cross-page fixture lesson creation failed')
      return { identity: made.lesson.identity, conversationId: made.conversation.conversationId }
    }, run)
    const projectPath = join(lesson.identity.normalizedDirectory, 'mixed-v9.h5lesson')
    copyFileSync(fixtureFile, projectPath)
    await page.evaluate(async ({ lesson, projectPath, projectId }) => {
      await window.desktopAPI!.lesson!({ operation: 'bind-project', lesson: lesson.identity, conversationId: lesson.conversationId, projectId, projectPath, saveAs: false })
    }, { lesson, projectPath, projectId: fixture.data.project.id })
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [directory] })) as typeof dialog.showOpenDialog }, run)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await page.locator('button').filter({ hasText: '跨页面观察课例' }).last().click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await page.screenshot({ path: join(run, 'before-slide-authoring.png') })
    const mounted = await page.evaluate(async () => {
      const load = (path: string): Promise<any> => import(/* @vite-ignore */ path)
      const { selectActiveCourseProjectDocument, useEditorStore } = await load('/src/renderer/store/editorStore.ts')
      return { projectId: selectActiveCourseProjectDocument(useEditorStore.getState())?.id, projectPath: useEditorStore.getState().projectPath }
    })
    expect(mounted.projectId).toBe(fixture.data.project.id)
    if (!mounted.projectPath) throw new Error('Formal UI did not retain the saved V9 project path')

    const result = await page.evaluate(async ({ projectPath }) => {
      const load = (path: string): Promise<any> => import(/* @vite-ignore */ path)
      const { createCourseChatObservation } = await load('/src/renderer/ui/chat/courseChatObservation.ts')
      const { selectActiveCourseProjectDocument, selectEffectiveLayerProjection, selectSlideAuthoringBackend, useEditorStore } = await load('/src/renderer/store/editorStore.ts')
      const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
      if (!project) throw new Error('Saved mixed V9 fixture is not mounted')
      const owner = { projectId: project.id, projectPath }
      const bridge = createCourseChatObservation(window.desktopAPI!, owner)
      try {
        const beforeProjection = selectEffectiveLayerProjection(useEditorStore.getState())
        const priorHistory = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().history.past.length
        const request = await bridge.capture({ workspace: { version: 1, projectId: project.id, normalizedPath: projectPath.toLowerCase().replace(/\\/g, '/') },
          instruction: '批量更新三种页面后回到原演示页核对', scope: 'course', purpose: 'local-edit', intent: 'edit', applyPolicy: 'auto', expectedResult: 'auto' })
        const target = (id: string) => {
          const value = request.destinations.find((entry: any) => entry.kind === 'update' && entry.target.itemId === id)
          if (!value) throw new Error(`Frozen request missed ${id}`)
          return value
        }
        const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, {
          version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '跨 Surface 一次候选',
          afterCommit: { version: 1, action: 'observe', reason: '回到原演示页检查批量结果' },
          steps: [
            { id: 'slide', tool: 'native.content', carrier: 'native', destination: target('slide-title'), input: { operation: 'edit', text: '跨页 Slide 已更新' } },
            { id: 'flow', tool: 'flow.content', carrier: 'native', destination: target('flow-paragraph'), input: { operation: 'edit', content: { inlines: [{ type: 'text', text: '跨页 Flow 已更新' }] } } },
            { id: 'spatial', tool: 'native.content', carrier: 'native', destination: target('spatial-label'), input: { operation: 'edit', text: '跨页 Spatial 已更新' } },
          ],
        })
        const applied = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
        if (applied.status !== 'committed') throw new Error(`Candidate did not commit: ${applied.status}`)
        const atCommit = selectActiveCourseProjectDocument(useEditorStore.getState())!
        const projectionAtCommit = selectEffectiveLayerProjection(useEditorStore.getState())
        const historyAtCommit = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().history.past.length
        const next = await bridge.captureNext(request, applied.receipt)
        const after = selectActiveCourseProjectDocument(useEditorStore.getState())!
        return {
          beforeRevision: project.revision, afterRevision: after.revision, receipt: applied.receipt,
          beforeProjection, projectionAtCommit, projectionAfterCapture: selectEffectiveLayerProjection(useEditorStore.getState()),
          history: { priorHistory, historyAtCommit, historyAfterCapture: selectSlideAuthoringBackend(useEditorStore.getState())!.getSession().history.past.length },
          next: { revision: next.documentRevision, observation: next.observation, reference: next.context.reference },
          text: JSON.stringify(after), unchangedDuringCapture: JSON.stringify(atCommit) === JSON.stringify(after), current: bridge.isCurrent(next),
        }
      } finally { bridge.dispose() }
    }, { projectPath: mounted.projectPath })
    expect(result.receipt.status).toBe('committed')
    expect(result.afterRevision).toBe(result.beforeRevision + 1)
    expect(result.history.historyAtCommit).toBe(result.history.priorHistory + 1)
    expect(result.history.historyAfterCapture).toBe(result.history.historyAtCommit)
    expect(result.beforeProjection).toMatchObject({ locationId: 'location-slide' })
    expect(result.projectionAtCommit).toMatchObject({ locationId: 'location-slide' })
    expect(result.projectionAfterCapture).toMatchObject({ locationId: 'location-slide' })
    expect(result.next).toMatchObject({ revision: result.afterRevision, reference: 'course', observation: { locationId: 'location-slide', documentRevision: result.afterRevision } })
    expect(result.text).toContain('跨页 Slide 已更新')
    expect(result.text).toContain('跨页 Flow 已更新')
    expect(result.text).toContain('跨页 Spatial 已更新')
    expect(result.unchangedDuringCapture).toBe(true)
    expect(result.current).toBe(true)
    writeFileSync(join(run, 'cross-page-observation.json'), JSON.stringify(result, null, 2))
    await page.screenshot({ path: join(run, 'after-capture-original-slide.png') })
  } finally {
    // This disposable fixture deliberately leaves its successful commit dirty.
    // Teardown must not wait on the product's native save/discard confirmation.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {})
    await app.close().catch(() => {})
    await server.close()
  }
})
