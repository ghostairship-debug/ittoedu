import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import {
  installFlowComponentConversionUiFixture,
  readFlowComponentConversionUiState,
  runFlowComponentConversionProbe,
} from './flowComponentConversionProbe'

const root = resolve(__dirname, '..', '..')

async function launchProbeEditor() {
  const runRoot = mkdtempSync(join(tmpdir(), `courseware-r18-080-${process.pid}-`))
  const server = await createServer({
    configFile: join(root, 'vite.renderer.config.ts'),
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
      watch: { ignored: ['**/output/**', '**/test-results/**'] },
    },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`],
    cwd: root,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      [BACKGROUND_E2E_ENV]: '1',
    },
  })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '新建独立课件', exact: true }).click()
  await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
  return { app, page, runRoot, server }
}

async function closeProbeEditor(
  launch: Awaited<ReturnType<typeof launchProbeEditor>>,
) {
  const child = launch.app.process()
  await launch.app.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    setTimeout(() => app.exit(0), 0)
  }).catch(() => undefined)
  await launch.app.close().catch(() => undefined)
  if (child.exitCode === null) child.kill()
  await launch.server.close()
  rmSync(launch.runRoot, { recursive: true, force: true })
}

test('Flow overlay component converts through real capture, archive, Published and DOCX', async () => {
  test.setTimeout(120_000)
  const launch = await launchProbeEditor()
  try {
    const result = await runFlowComponentConversionProbe(launch.page)
    expect(result.archiveByteLength).toBeGreaterThan(0)
    expect(result.bodyComponentCount).toBe(1)
    expect(result.originalOverlayCount).toBe(0)
    expect(result.selectionItemIds).toHaveLength(1)
    expect(result.capturedAssetId).toMatch(/^component-capture-/)
    expect(result.capturedPngSignature).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(result.undoneToOverlay).toBe(true)
    expect(result.redoneToBody).toBe(true)
    expect(result.reversePreserved).toBe(true)
    expect(result.publishedBefore).toBe('正文组件:0')
    expect(result.publishedAfter).toBe('正文组件:1')
    expect(result.projectedBodyComponents).toBe(1)
    expect(result.projectedOriginalOverlays).toBe(0)
  } finally {
    await closeProbeEditor(launch)
  }
})

test('Flow properties UI commits the chosen nested destination and one undo', async () => {
  test.setTimeout(120_000)
  const launch = await launchProbeEditor()
  const { page } = launch
  try {
    const fixture = await installFlowComponentConversionUiFixture(page)
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    await page.getByRole('tab', { name: '属性', exact: true }).click()
    await expect(page.getByTestId('flow-overlay-component-properties')).toBeVisible()
    await page.getByLabel('正文位置', { exact: true }).selectOption({
      label: '分节「嵌套目标」 · 末尾',
    })
    await page.getByTestId('flow-overlay-to-document').click()
    await expect.poll(async () => (
      await readFlowComponentConversionUiState(page, fixture)
    ).convertedBlockId).not.toBeNull()
    const converted = await readFlowComponentConversionUiState(page, fixture)
    expect(converted.revision).toBe(fixture.baseRevision + 1)
    expect(converted.selectedOverlayIds).toEqual([])
    expect(converted.destinationChildTypes).toEqual(['paragraph', 'component'])
    expect(converted.overlayExists).toBe(false)
    expect(converted.capturedProjectAssetCount).toBe(0)
    expect(converted.capturedResourceCount).toBe(0)
    expect(converted.selectedBlockId).toBe(converted.convertedBlockId)
    expect(converted.destinationChildIds[1]).toBe(converted.convertedBlockId)

    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect.poll(async () => readFlowComponentConversionUiState(page, fixture)).toMatchObject({
      revision: fixture.baseRevision,
      destinationChildIds: ['ui-nested-existing'],
      destinationChildTypes: ['paragraph'],
      convertedBlockId: null,
      overlayExists: true,
      capturedProjectAssetCount: 0,
      capturedResourceCount: 0,
    })
  } finally {
    await closeProbeEditor(launch)
  }
})
