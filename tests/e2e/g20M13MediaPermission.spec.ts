import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackagesToArchiveFiles } from '../../src/renderer/components/componentPackageStore'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'
import { closeSelectionApp, openSelectionFile } from './helpers/g20SelectionHarness'

// M13-T03: a real course Runtime asks for camera and microphone during try-run. Chromium's
// fake capture devices stand in for hardware; the host consent dialog is the real main-process
// path with only showMessageBox answered by the test. No network or model request is made.
const root = resolve(__dirname, '../..')
const runtimeId = 'm13-media-runtime'
const runtimeSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    authoringApiVersion: 1,
    create: function (ctx) {
      var panel = document.createElement('div');
      panel.dataset.m13Media = 'root';
      Object.assign(panel.style, { position: 'absolute', left: '16px', top: '16px', width: '560px', padding: '12px',
        background: '#ffffff', color: '#111827', font: '16px Microsoft YaHei', border: '1px solid #94a3b8',
        // DOM-mode Canvas Runtime layers do not take pointers; interactive course UI opts in.
        pointerEvents: 'auto' });
      var status = document.createElement('p');
      status.dataset.m13Status = 'status';
      status.textContent = '尚未请求设备';
      var stream = null;
      function stop() { if (stream) stream.getTracks().forEach(function (track) { track.stop(); }); stream = null; }
      function add(label, run) { var button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', run); panel.append(button); }
      add('打开摄像头和麦克风', function () {
        status.textContent = '正在请求设备';
        navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(function (next) {
          stop(); stream = next;
          status.textContent = '设备已开启：' + next.getTracks().map(function (track) { return track.kind; }).sort().join('+');
        }, function (error) { status.textContent = '设备未开启：' + error.name; });
      });
      add('关闭设备', function () { stop(); status.textContent = '设备已关闭'; });
      add('检查网络', function () {
        status.textContent = navigator.onLine ? '网络可用' : '网络不可用：离线';
      });
      panel.append(status);
      ctx.dom.overlay.append(panel);
      return { destroy: function () { stop(); panel.remove(); } };
    }
  });
`

function mediaProject() {
  const fixture = createPublishedCanvasRuntimeV2Fixture([{ itemId: runtimeId, renderMode: 'dom', source: runtimeSource }])
  const project = structuredClone(fixture.project)
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) for (const item of scene.layerItems) {
      if (item.kind === 'runtime' && item.layerItemId === runtimeId) item.frame = { mode: 'absolute', x: 80, y: 80, width: 640, height: 320 }
    }
  }
  return project
}

async function answerConsent(app: ElectronApplication, answers: number[]) {
  await app.evaluate(({ dialog }, next) => {
    const state = (globalThis as { __m13Consent?: { calls: unknown[]; answers: number[] } }).__m13Consent ??= { calls: [], answers: [] }
    state.answers.push(...next)
    dialog.showMessageBox = (async (_window: unknown, options: { title?: string; message?: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number }) => {
      state.calls.push({ title: options.title, message: options.message, detail: options.detail, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId })
      return { response: state.answers.shift() ?? 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, answers)
}
const consentCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __m13Consent?: { calls: Record<string, unknown>[] } }).__m13Consent?.calls ?? [])

test('M13-T03 course Runtime gets camera and microphone only per granted request, sees denial clearly and stays usable offline', async ({}, info) => {
  test.setTimeout(180_000)
  const base = join(root, 'output/g20/m13/media-permission'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const project = mediaProject()
  writeFileSync(join(workspace, 'media.h5lesson'), createCourseProjectArchive({ project, assetFiles: {},
    componentFiles: componentPackagesToArchiveFiles(withDefaultComponentController(project).componentPackages) }, { mtime: '2026-09-24T08:00:00.000Z' }))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`, '--use-fake-device-for-media-stream'],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 950))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await openSelectionFile(page, workspace, 'media.h5lesson')
    await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const panel = page.getByTestId('course-try-run-host').locator('[data-m13-media="root"]')
    const status = panel.locator('[data-m13-status="status"]')
    await expect(status).toHaveText('尚未请求设备')

    // 1. Granted: the course gets both devices; the dialog names them and defaults to 拒绝.
    await answerConsent(app, [1])
    await panel.getByRole('button', { name: '打开摄像头和麦克风', exact: true }).click()
    await expect(status).toHaveText('设备已开启：audio+video')
    let calls = await consentCalls(app)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ title: '课件请求使用设备', message: '当前课件请求使用摄像头和麦克风。',
      buttons: ['拒绝', '允许本次使用摄像头和麦克风'], defaultId: 0, cancelId: 0 })
    await panel.getByRole('button', { name: '关闭设备', exact: true }).click()
    await expect(status).toHaveText('设备已关闭')

    // 2. Denied: asked again (no remembered grant) and the course sees NotAllowedError.
    await answerConsent(app, [0])
    await panel.getByRole('button', { name: '打开摄像头和麦克风', exact: true }).click()
    await expect(status).toHaveText('设备未开启：NotAllowedError')
    calls = await consentCalls(app)
    expect(calls).toHaveLength(2)

    // Screen capture is not a course device request: denied without any prompt.
    const display = await page.evaluate(() => navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => 'granted', (error: Error) => error.name))
    expect(display).not.toBe('granted')
    expect(await consentCalls(app)).toHaveLength(2)

    // 3. Offline: devices stay usable after consent, and the course reports the network state plainly.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await panel.getByRole('button', { name: '检查网络', exact: true }).click()
    await expect(status).toHaveText('网络不可用：离线')
    await answerConsent(app, [1])
    await panel.getByRole('button', { name: '打开摄像头和麦克风', exact: true }).click()
    await expect(status).toHaveText('设备已开启：audio+video')
    expect(await consentCalls(app)).toHaveLength(3)
    await panel.getByRole('button', { name: '关闭设备', exact: true }).click()
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await panel.getByRole('button', { name: '检查网络', exact: true }).click()
    await expect(status).toHaveText('网络可用')

    expect(errors).toEqual([])
    const path = join(directory, 'm13-t03-evidence.json')
    writeFileSync(path, JSON.stringify({ caseId: 'M13-T03', carrier: 'electron try-run + course Runtime API 2 + Chromium fake capture devices',
      consentCalls: await consentCalls(app), displayMedia: display, errors }, null, 2))
    await page.screenshot({ path: join(directory, 'try-run-media.png') })
    await info.attach('M13-T03 media permission evidence', { path, contentType: 'application/json' })
  } finally { await closeSelectionApp(app) }
})
