import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('Mixed scene and step semantics survive archive and current-surface try-run in Electron', async () => {
  test.setTimeout(120_000)
  const root = resolve(__dirname, '../..')
  const runRoot = mkdtempSync(join(tmpdir(), 'courseware-nav-levels-'))
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/output/**'] } } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw Error('No server address')
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`], cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, [BACKGROUND_E2E_ENV]: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  try {
    const page = await app.firstWindow()
    // Enter only the landing page; never replace an already opened editor or recovery draft.
    const startupMore = page.locator('.lesson-workspace-more > summary')
    const startupEditor = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
    const startupRecovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
    await expect.poll(async () => await startupEditor.isVisible() || await startupMore.isVisible() || await startupRecovery.isVisible()).toBe(true)
    if (!await startupEditor.isVisible() && await startupMore.isVisible() && !await startupRecovery.isVisible()) {
      await startupMore.click()
      await page.getByRole('button', { name: '新建独立课件', exact: true }).click()
    }
    await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
    const result = await page.evaluate(async () => {
      const load = (path: string): Promise<any> => import(path)
      const { createBlankCourseProject } = await load('/src/renderer/project/createCourseProject.ts')
      const { createDefaultTeacherControllerPackage } = await load('/src/shared/defaultTeacherControllerComponent.ts')
      const controller = createDefaultTeacherControllerPackage()
      const controllerKey = `${controller.manifest.id}@${controller.manifest.version}`
      const components = { [controllerKey]: controller }
      const { addCourseFlowPage, addCourseSpatialPage } = await load('/src/renderer/course/courseLocationCommands.ts')
      const { createCourseProjectArchive, openCourseProjectArchive } = await load('/src/renderer/project/courseProjectArchive.ts')
      const { buildPublishedCourseV2Payload } = await load('/src/renderer/export/course/buildPublishedCourse.ts')
      const { createPublishedCourseSession } = await load('/src/player/surfaces/publishedDynamicHosts.ts')
      const { mountFlowLocationTryRun } = await load('/src/renderer/ui/flowLocationTryRun.ts')
      const { mountSpatialLocationTryRun } = await load('/src/renderer/ui/spatialLocationTryRun.ts')
      let project = createBlankCourseProject({ title: '导航分层验证' })
      project = addCourseFlowPage(project, {}).project
      project = addCourseSpatialPage(project, {}).project
      const slide = project.surfaces.find((s: any) => s.type === 'slide')
      slide.scenes[0].presentation = { initialStateId: 'one', states: ['one','two','three'].map(id => ({ id, name: id, layerItemOverrides: {} })) }
      const flow = project.surfaces.find((s: any) => s.type === 'flow')
      const spatial = project.surfaces.find((s: any) => s.type === 'spatial-2d')
      flow.blocks.push({ id: 'second-anchor', type: 'paragraph', content: { inlines: [{ type: 'text', text: '第二锚点' }] } })
      spatial.camera.frames.push(...['two','three'].map((id,index) => ({ id, name: id, x: 200*(index+1), y: 0, zoom: 1 })))
      project.locations = project.locations.flatMap((l: any) => l.kind === 'flow-block' ? [l,{...l,id:'flow-two',blockId:'second-anchor'}] : l.kind === 'spatial-camera' ? [l,{...l,id:'spatial-two',cameraFrameId:'two'},{...l,id:'spatial-three',cameraFrameId:'three'}] : [l])
      const bytes = createCourseProjectArchive({ project, assetFiles: {}, componentFiles: { [controllerKey]: controller.files } })
      project = openCourseProjectArchive(bytes).project
      const container = document.createElement('div')
      Object.assign(container.style, { position:'fixed',inset:'0',zIndex:'99999',background:'white' })
      document.body.append(container)
      const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components })
      const session = createPublishedCourseSession(payload)
      await session.mount(container)
      const visited = []
      do { const p = session.getPlaybackProgress(); visited.push([p.sceneIndex,p.stepIndex]) } while(await session.nextStep())
      await session.previousScene()
      const previousScene = session.getPlaybackProgress()
      await session.destroy()
      const tryRunResults = []
      const findButton = (label: string): HTMLButtonElement | undefined => {
        const search = (root: HTMLElement | ShadowRoot): HTMLButtonElement | undefined => {
          const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.trim() === label)
          if (button) return button
          for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) {
              const nested = search(element.shadowRoot)
              if (nested) return nested
            }
          }
        }
        return search(container)
      }
      for (const kind of ['flow-block','spatial-camera']) {
        const initial = project.locations.find((l: any) => l.kind === kind)
        const host = await (kind === 'flow-block' ? mountFlowLocationTryRun : mountSpatialLocationTryRun)({ container, project, components, locationId: initial.id })
        findButton('展开教师控制器')?.click()
        for (let i = 0; i < 100 && !findButton('下一步'); i++) await new Promise(resolve => setTimeout(resolve, 10))
        const button = findButton('下一步')
        if (!button) throw new Error('Mounted teacher controller did not provide the next-step control')
        button.click()
        for (let i=0;i<100 && host.locationId===initial.id;i++) await new Promise(resolve=>setTimeout(resolve,10))
        tryRunResults.push(host.locationId)
        await host.destroy()
      }
      container.remove()
      return { visited, previousScene: [previousScene.sceneIndex,previousScene.stepIndex], tryRunResults, archiveBytes: bytes.length }
    })
    expect(result.visited).toEqual([[0,0],[0,1],[0,2],[1,0],[1,1],[2,0],[2,1],[2,2]])
    expect(result.previousScene).toEqual([1,0])
    expect(result.tryRunResults).toEqual(['flow-two','spatial-two'])
    expect(result.archiveBytes).toBeGreaterThan(0)
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(w => w.destroy()); setTimeout(()=>app.exit(0),0) }).catch(()=>undefined)
    await app.close().catch(()=>undefined)
    await server.close()
    const scoped = relative(resolve(tmpdir()), resolve(runRoot))
    if (!scoped.startsWith('courseware-nav-levels-') || scoped.includes('..') || isAbsolute(scoped)) throw Error('Invalid cleanup directory')
    rmSync(runRoot, { recursive:true, force:true })
  }
})
