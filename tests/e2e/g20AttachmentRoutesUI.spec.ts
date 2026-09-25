import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('M08-T03 selection, resource-tree drag and @ reference keep same-name files as distinct managed snapshots', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The desktop acceptance carrier is Windows Electron')
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/m08/attachment-routes')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace'), nested = join(workspace, 'nested'), external = join(directory, 'external')
  mkdirSync(nested, { recursive: true }); mkdirSync(external)
  const paths = [join(external, 'same.png'), join(workspace, 'same.png'), join(nested, 'same.png')]
  const bytes = await Promise.all([
    { width: 4, height: 3, color: '#dc3344' },
    { width: 5, height: 3, color: '#22a65d' },
    { width: 6, height: 3, color: '#4055db' },
  ].map(({ width, height, color }) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()))
  paths.forEach((filename, index) => writeFileSync(filename, bytes[index]!))

  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))

    // Authorize this fixture through the actual workspace chooser. The file
    // picker is only substituted at the OS-dialog boundary.
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const composer = page.locator('.attachment-composer')
    const chat = page.getByRole('textbox', { name: '给创作助手发消息' })
    const ready = composer.getByRole('button', { name: '预览发送内容', exact: true })
    await expect(composer.getByRole('button', { name: '添加', exact: true })).toBeEnabled()
    await expect(page.locator('.lesson-directory-tree').getByRole('button', { name: 'same.png', exact: true })).toBeVisible()

    // 1. A genuine composer click uses the native picker and its one-shot grant.
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, paths[0])
    await composer.getByRole('button', { name: '添加', exact: true }).click(); await composer.getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
    await expect(ready).toHaveCount(1)

    // 2. Browser drag events originate on the real resource-tree row; the
    // composer consumes its dataTransfer and resolves a fresh host grant.
    const treeFile = page.locator('.lesson-directory-tree').getByRole('button', { name: 'same.png', exact: true })
    await treeFile.dragTo(composer)
    await expect(ready).toHaveCount(2)

    // 3. The @ picker traverses the resource tree and adds a reference chip.
    await composer.getByRole('button', { name: '添加', exact: true }).click(); await composer.getByRole('menuitem', { name: '引用工作空间文件', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '引用空间文件' })
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: '文件夹：nested', exact: true }).click()
    await picker.getByRole('button', { name: '引用：same.png', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(ready).toHaveCount(3)
    await expect(composer.getByLabel('same.png用途')).toHaveCount(3)
    await expect(chat).toHaveValue('')

    await expect.poll(async () => page.evaluate(async folder => {
      const api = window.desktopAPI.execution!
      const opened = await api.workspace(folder)
      const conversations = await api.conversations(opened.workspace.workspaceId)
      return conversations[0]?.inputAttachments ?? []
    }, workspace)).toHaveLength(3)
    // Read the persisted draft after the poll. The UI entry routes must all
    // converge on typed references, not on file paths inserted into chat text.
    const refs = await page.evaluate(async folder => {
      const api = window.desktopAPI.execution!
      const opened = await api.workspace(folder)
      return (await api.conversations(opened.workspace.workspaceId))[0]!.inputAttachments
    }, workspace)
    expect(refs.map(ref => ref.role)).toEqual(['reference', 'reference', 'reference'])
    expect(new Set(refs.map(ref => ref.attachmentId)).size).toBe(3)
    const snapshots = await page.evaluate(ids => Promise.all(ids.map(id => window.desktopAPI.attachments!.snapshot(id))), refs.map(ref => ref.attachmentId))
    expect(snapshots.map(item => item.name)).toEqual(['same.png', 'same.png', 'same.png'])
    expect(snapshots.map(item => item.source.kind)).toEqual(['file', 'workspace', 'workspace'])
    expect(snapshots.map(item => item.source.pathHint?.toLowerCase())).toEqual(paths.map(item => item.toLowerCase()))
    expect(snapshots.every(item => item.source.readOnly && item.state === 'added')).toBe(true)
    expect(snapshots.map(item => item.digest)).toEqual(bytes.map(digest))
    expect(new Set(snapshots.map(item => item.digest)).size).toBe(3)
    for (const [index, ref] of refs.entries()) {
      const actual = await page.evaluate(async reference => {
        const result = await window.desktopAPI.attachments!.readRepresentation(reference.attachmentId, reference.representationId)
        return { kind: result.representation.kind, bytes: Array.from(result.bytes), snapshotId: result.snapshot.id }
      }, ref)
      expect(actual.kind).toBe('image')
      expect(actual.snapshotId).toBe(snapshots[index]!.id)
      expect(Buffer.from(actual.bytes)).toEqual(bytes[index])
      expect(readFileSync(paths[index]!)).toEqual(bytes[index])
    }
    expect(errors).toEqual([])
    await page.screenshot({ path: join(directory, 'three-same-name-attachments.png') })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ case: 'M08-T03', routes: ['picker', 'resource-tree-drag', '@ resource reference'],
      names: snapshots.map(item => item.name), sourceKinds: snapshots.map(item => item.source.kind),
      snapshotIdsDistinct: true, sourceDigests: bytes.map(digest), snapshotDigests: snapshots.map(item => item.digest),
      representationBytesMatch: true, originalFilesUnchanged: true, typedDraftReferences: refs.length, chatInput: await chat.inputValue(), rendererErrors: errors }, null, 2))
    await info.attach('M08 attachment routes evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    const page = app?.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined)
    throw error
  } finally {
    if (app) {
      await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
  }
})
