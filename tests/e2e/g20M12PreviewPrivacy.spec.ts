import { _electron as electron, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

test('M12-T03 admission preview cannot read desktop settings or Electron IPC', async () => {
  test.setTimeout(90_000)
  const output = join(root, 'output/g20/m12/t03')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'preview-'))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.desktopAPI?.dynamicAdmission)).toBe('function')
    const preview = new Promise<{ url: string; desktopAPI: string; executionSettings: string; ipcRenderer: string; require: string }>((resolvePreview, rejectPreview) => {
      app.on('window', worker => {
        worker.on('domcontentloaded', () => {
          if (!worker.url().includes('/admission.html')) return
          void worker.evaluate(() => ({
            url: location.href,
            desktopAPI: typeof window.desktopAPI,
            executionSettings: typeof window.desktopAPI?.executionSettings,
            ipcRenderer: typeof (window as Window & { ipcRenderer?: unknown }).ipcRenderer,
            require: typeof (window as Window & { require?: unknown }).require,
          })).then(resolvePreview, rejectPreview)
        })
      })
    })
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const request = page.evaluate(async ({ id, project }) => window.desktopAPI!.dynamicAdmission!({
      operation: 'run', id, payload: { project, assetFiles: {}, componentFiles: {},
        targets: [{ locationId: project.startLocationId, instanceIds: ['missing-fixture-instance'] }] },
    }), { id: randomUUID(), project })
    const observed = await preview
    expect(observed.url).toContain('/admission.html')
    expect(observed).toMatchObject({ desktopAPI: 'undefined', executionSettings: 'undefined', ipcRenderer: 'undefined', require: 'undefined' })
    expect(await request).toMatchObject({ ok: false })
  } finally { await app.close() }
})
