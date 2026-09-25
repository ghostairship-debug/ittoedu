import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const root = resolve(__dirname, '../..')
const evidenceRoot = join(root, 'output/r19-cross-page-observation')

test('r19 real Slide host retains the frozen page while one canonical commit updates Slide Flow Spatial and a read preserves History', async () => {
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
      if (!made.lesson) throw new Error('Independent cross-page fixture lesson creation failed')
      return made.lesson
    }, run)
    const projectPath = join(lesson.identity.normalizedDirectory, 'mixed-v9.h5lesson')
    copyFileSync(fixtureFile, projectPath)
    writeFileSync(join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json'), JSON.stringify({ ...lesson.manifest, coursePath: 'mixed-v9.h5lesson' }))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [directory] })) as typeof dialog.showOpenDialog }, run)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '跨页面观察课例', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'mixed-v9.h5lesson', exact: true }).click()
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
      const { selectEffectiveLayerProjection, useEditorStore } = await load('/src/renderer/store/editorStore.ts')
      const api = window.desktopAPI!.documents!, before = await api.open(projectPath)
      if (before.model.kind !== 'course-v9') throw new Error('Course expected')
      const project = structuredClone(before.model.project)
      for (const surface of project.surfaces) {
        if (surface.type === 'flow') {
          const block = surface.blocks.find(value => value.id === 'flow-paragraph')
          if (!block || block.type !== 'paragraph') throw new Error('Flow paragraph missing')
          block.content = { inlines: [{ type: 'text', text: '跨页 Flow 已更新' }] }
        } else {
          const items = surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : surface.world.layerItems
          const id = surface.type === 'slide' ? 'slide-title' : 'spatial-label'
          const item = items.find(value => value.layerItemId === id)
          if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('Native text missing')
          item.content.data.text = surface.type === 'slide' ? '跨页 Slide 已更新' : '跨页 Spatial 已更新'
        }
      }
      const projectionBefore = selectEffectiveLayerProjection(useEditorStore.getState())
      const receipt = await api.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
        operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'course.replace', project } } })
      const committed = await api.read(before.documentId)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const observed = await api.read(before.documentId)
      return { receipt, before, committed, observed, projectionBefore, projectionAfter: selectEffectiveLayerProjection(useEditorStore.getState()) }
    }, { projectPath: mounted.projectPath })
    expect(result.receipt.status).toBe('applied')
    expect(result.committed.revision).toBe(result.before.revision + 1)
    expect(result.committed.undoDepth).toBe(result.before.undoDepth + 1)
    expect(result.observed).toEqual(result.committed)
    expect(result.projectionBefore).toMatchObject({ locationId: 'location-slide' })
    expect(result.projectionAfter).toMatchObject({ locationId: 'location-slide' })
    expect(JSON.stringify(result.observed.model)).toContain('跨页 Slide 已更新')
    expect(JSON.stringify(result.observed.model)).toContain('跨页 Flow 已更新')
    expect(JSON.stringify(result.observed.model)).toContain('跨页 Spatial 已更新')
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
