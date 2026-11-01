/** Directory-package acceptance only: fresh profile, fixture files and zero model submissions. */
import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { extractFile } from '@electron/asar'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { chooseM20Workspace, closeM20, launchM20, m20OpenFile, m20Row, m20Snapshot, m20VisibleTextEditor } from './helpers/g20M20Harness'

const root = resolve(__dirname, '../..')
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const canonical = (filename: string) => process.platform === 'win32' ? resolve(filename).toLowerCase() : resolve(filename)

async function captureOwnedWindow(app: ElectronApplication, page: Page, path: string, info: TestInfo) {
  // CDP page screenshots timed out on unrelated package screens. Capture the
  // exact owned Electron window without changing product behavior or retrying.
  const window = await app.browserWindow(page)
  let timer: ReturnType<typeof setTimeout> | undefined
  const capture = await Promise.race([
    (async () => {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      return window.evaluate(async window => {
        const image = await window.capturePage(undefined, { stayHidden: true, stayAwake: true })
        return { png: image.toPNG().toString('base64'), size: image.getSize(), empty: image.isEmpty() }
      })
    })(),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned window capture exceeded 15000ms')), 15_000) }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
  expect(capture.empty).toBe(false)
  expect(capture.size.width > 0 && capture.size.height > 0).toBe(true)
  writeFileSync(path, Buffer.from(capture.png, 'base64'))
  await info.attach('Current packaged window', { path, contentType: 'image/png' })
}

test('isolated current directory package opens files, previews PPTX, reads its reference and exposes built-in AI without a model request', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The selected directory package is Windows x64.')
  test.setTimeout(150_000)
  const configured = process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE?.trim()
  expect(configured, 'Select the new isolated directory package explicitly.').toBeTruthy()
  const executable = resolve(configured!), resources = join(dirname(executable), 'resources')
  const asar = join(resources, 'app.asar')
  expect(existsSync(executable)).toBe(true)
  expect(existsSync(asar)).toBe(true)

  const base = join(root, 'output/comprehensive-execution-20261101/packaged-smoke')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const evidence: Record<string, unknown> = { case: '20261101 isolated directory package', executable, directory,
    workspace, phase: 'current-build-identity', modelRequests: 0 }
  const errors: string[] = [], network: string[] = []
  let app: ElectronApplication | undefined, page: Page | undefined
  try {
    // Reuse the release verifier's byte comparison for the affected current build.
    const compiledEntries = [
      'dist-electron/main/index.js',
      'dist-electron/main/workbench/execution/ExecutionEngine.js',
      'dist-electron/main/workbench/execution/ExecutionDesktopService.js',
      'dist-electron/preload/index.js',
      'dist-renderer/index.html',
    ]
    const compiledHashes: Record<string, string> = {}
    for (const entry of compiledEntries) {
      const built = readFileSync(join(root, ...entry.split('/')))
      expect(extractFile(asar, entry.split('/').join(sep)), `Current build bytes: ${entry}`).toEqual(built)
      compiledHashes[entry] = sha(built)
    }
    evidence.currentBuild = compiledHashes

    const samples = [
      { name: 'settings.json', source: '\ufeff{"value":"BEFORE",\r\n  "unfinished":\r\n}\r\n' },
      { name: 'main.ts', source: '\ufeffexport const value: string = "BEFORE";\r\n// 原样代码\r\n' },
    ]
    for (const sample of samples) writeFileSync(join(workspace, sample.name), sample.source, 'utf8')
    const pptxSource = join(root, 'output/comprehensive-execution-20261101/office/fixtures/original-timeline-opaque.pptx')
    expect(existsSync(pptxSource), 'Reuse the accepted Office fixture; never use a user original.').toBe(true)
    const pptxName = '目录包演示.pptx', pptxFile = join(workspace, pptxName)
    copyFileSync(pptxSource, pptxFile)
    const originalPptxHash = sha(readFileSync(pptxSource))
    const slide = unzipSync(readFileSync(pptxFile))['ppt/slides/slide1.xml']
    const animatedId = slide && strFromU8(slide).match(/\bspid=["'](\d+)["']/)?.[1]
    if (!animatedId) throw new Error('The accepted PPTX fixture needs its original animation target.')

    evidence.phase = 'launch-packaged-executable'
    ;({ app, page } = await launchM20(fixture))
    // This acceptance includes painted screens, so expose only its owned window.
    // An invisible off-desktop E2E window can return an earlier compositor frame.
    const ownedWindow = await app.browserWindow(page)
    evidence.visibleWindow = await ownedWindow.evaluate(window => {
      window.setOpacity(1); window.setPosition(40, 40); window.show(); window.focus()
      return { visible: window.isVisible(), opacity: window.getOpacity(), bounds: window.getBounds() }
    })
    expect(evidence.visibleWindow).toMatchObject({ visible: true, opacity: 1 })
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, execPath: process.execPath,
      appPath: app.getAppPath(), resourcesPath: process.resourcesPath, cwd: process.cwd(),
      userData: app.getPath('userData'), pid: process.pid }))
    expect(identity.packaged).toBe(true)
    expect(canonical(identity.execPath)).toBe(canonical(executable))
    expect(canonical(identity.appPath)).toBe(canonical(asar))
    expect(canonical(identity.userData)).toBe(canonical(fixture.profile))
    expect(canonical(identity.cwd)).toBe(canonical(directory))
    evidence.application = identity
    const emptySettings = await page.evaluate(async () => {
      const settings = await window.desktopAPI.executionSettings!.read()
      return { connections: settings.connections.length,
        configuredRoles: Object.entries(settings.profile.roles).filter(([, role]) => role != null).map(([name]) => name) }
    })
    expect(emptySettings).toEqual({ connections: 0, configuredRoles: [] })
    await chooseM20Workspace(app, page, workspace)

    evidence.phase = 'ordinary-files-real-editor-and-save'
    for (const sample of samples) {
      await m20OpenFile(page, sample.name, 'text')
      const filename = join(workspace, sample.name), editor = m20VisibleTextEditor(page)
      await expect(editor).toContainText('BEFORE')
      await expect.poll(async () => (await m20Snapshot(page!, filename))?.model)
        .toMatchObject({ kind: 'text', source: sample.source })
      // Same real key path as the accepted T1 consumer, preserving BOM and CRLF.
      await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+End')
      await page.keyboard.insertText(sample.source.split('\r\n')[0]!.slice(1).replace('BEFORE', 'AFTER'))
      await page.getByRole('region', { name: `教学文档 ${sample.name}`, exact: true })
        .getByRole('button', { name: '保存', exact: true }).click()
      const expected = Buffer.from(sample.source.replace('BEFORE', 'AFTER'), 'utf8')
      await expect.poll(() => readFileSync(filename).equals(expected)).toBe(true)
      await expect.poll(async () => (await m20Snapshot(page!, filename))?.dirty).toBe(false)
    }
    evidence.files = samples.map(sample => ({ name: sample.name, sha256: sha(readFileSync(join(workspace, sample.name))),
      bytes: readFileSync(join(workspace, sample.name)).byteLength, bomAndCrlfPreserved: true }))
    await captureOwnedWindow(app, page, join(directory, '01-files.png'), info)

    evidence.phase = 'packaged-pptx-readonly-viewer'
    await m20Row(page, pptxName).dblclick()
    const preview = page.locator(`.pptx-file-preview[aria-label=${JSON.stringify(`${pptxName} PPTX 只读预览`)}]`)
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('第 1 / 2 页')
    await expect(preview.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    const bounds = await preview.locator('.pptx-file-preview__surface svg').first().boundingBox()
    expect(bounds && bounds.width > 100 && bounds.height > 100).toBe(true)
    const animated = preview.locator(`[data-el="${animatedId}"]`).first()
    await preview.getByRole('button', { name: '播放动画', exact: true }).click()
    await expect(animated).toBeHidden()
    await preview.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(animated).toBeVisible()
    await expect(preview).toContainText('本页动画 1 / 1')
    await preview.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(preview).toContainText('第 2 / 2 页')
    await expect(preview.locator('.pptx-file-preview__surface')).toContainText('Keep other slide')
    expect(sha(readFileSync(pptxFile))).toBe(originalPptxHash)
    expect(sha(readFileSync(pptxSource))).toBe(originalPptxHash)
    evidence.pptx = { source: pptxSource, copy: pptxFile, originalSha256: originalPptxHash,
      svgBounds: bounds, animatedId, clickRevealed: true, secondPageVisible: true, originalAndCopyUnchanged: true }
    await captureOwnedWindow(app, page, join(directory, '02-pptx.png'), info)

    evidence.phase = 'formal-installed-reference-read'
    const referenceRoot = realpathSync(join(identity.resourcesPath, 'reference-library'))
    const referencePath = realpathSync(join(referenceRoot, 'creative-reference', 'README.md'))
    const relation = relative(referenceRoot, referencePath)
    expect(relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)).toBe(true)
    const referenceBytes = readFileSync(referencePath)
    const referenceText = new TextDecoder('utf-8', { fatal: true }).decode(referenceBytes)
    const referenceReceipt = await app.evaluate(async ({ app }, input) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      // File tools are owned by AgentFileService, not DocumentToolGateway.
      // Use the same registration and installed read-only roots as ExecutionEngine.
      const registration = requireProduct('./dist-electron/core/tools/AgentFileTools.js').agentFileRegistration('file.read')
      try {
        return await registration.handler({ execute: async (name: string, raw: unknown) => {
          const result = await host.agentFiles.execute({ runId: input.runId,
            workspaceRoot: input.workspace, permission: 'read-only' }, name, raw, `${input.runId}:read-reference`)
          return { kind: 'read', data: result.data }
        } }, { path: input.path, limit: 64000 })
      } finally { host.agentFiles.releaseRun(input.runId) }
    }, { runId: `packaged-smoke-reference-${randomUUID()}`, workspace, path: referencePath })
    writeFileSync(join(directory, 'reference-receipt.json'), JSON.stringify(referenceReceipt, null, 2) + '\n')
    expect(referenceReceipt).toMatchObject({ kind: 'read', data: { path: referencePath,
      text: referenceText, dirty: false, truncated: false } })
    expect(readFileSync(referencePath)).toEqual(referenceBytes)
    evidence.reference = { path: referencePath, sha256: sha(referenceBytes), formalReadMatched: true,
      owner: 'file.read registration / AgentFileService / installed read-only roots',
      unchanged: true, receipt: join(directory, 'reference-receipt.json') }

    evidence.phase = 'built-in-ai-ui-with-zero-submissions'
    const title = '目录包入口验证（未发送）'
    const conversation = await page.evaluate(async ({ workspace, title }) => {
      const api = window.desktopAPI.execution!, space = await api.workspace(workspace)
      const created = await api.createConversation(space.workspace.workspaceId, title)
      return { workspaceId: space.workspace.workspaceId, conversationId: created.conversationId }
    }, { workspace, title })
    // Re-read the persisted conversation through the normal UI; do not depend on
    // whether a conversation created by another consumer emits a renderer refresh.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('navigation', { name: '工作空间会话', exact: true })
      .getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('选择 Agent', { exact: true })).toHaveValue('builtin')
    await expect(page.getByRole('textbox', { name: '给果铃AI发消息', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '给果铃AI发消息', exact: true })).toHaveValue('')
    const noModelActivity = await page.evaluate(async input => {
      const api = window.desktopAPI.execution!, settings = await window.desktopAPI.executionSettings!.read()
      const current = await api.conversation(input.workspaceId, input.conversationId)
      return { runIds: current?.runIndex.builtinRunIds ?? null, submissions: (await api.submissions(input)).length,
        connections: settings.connections.length,
        configuredRoles: Object.entries(settings.profile.roles).filter(([, role]) => role != null).map(([name]) => name) }
    }, conversation)
    expect(noModelActivity).toEqual({ runIds: [], submissions: 0, connections: 0, configuredRoles: [] })
    evidence.builtInAI = { ...noModelActivity, selectedAgent: 'builtin', composerVisible: true, composerEmpty: true }
    await captureOwnedWindow(app, page, join(directory, '03-built-in-ai.png'), info)
    expect(errors).toEqual([]); expect(network).toEqual([])
    expect(sha(readFileSync(pptxSource))).toBe(originalPptxHash)
    expect(sha(readFileSync(pptxFile))).toBe(originalPptxHash)
    evidence.errors = errors; evidence.network = network
    evidence.status = 'isolated-directory-package-smoke-passed'; evidence.phase = 'complete'
    evidence.finishedAt = new Date().toISOString()
    evidence.captureMethod = 'owned-visible-electron-window-after-paint'
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  } catch (error) {
    evidence.errors = errors; evidence.network = network
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence,
      failure: error instanceof Error ? error.message : String(error) }, null, 2) + '\n')
    throw error
  } finally { if (app) await closeM20(app) }
})
