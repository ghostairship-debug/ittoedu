import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function archiveFacts(filename: string) {
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
  return {
    projectId: archive.project.id,
    itemCount: archive.project.surfaces.reduce((total, surface) => surface.type === 'slide'
      ? total + surface.scenes.reduce((count, scene) => count + scene.layerItems.length, 0) : total, 0),
    assets: Object.fromEntries(Object.entries(archive.assetFiles).map(([id, bytes]) => [id, digest(bytes)])),
    components: Object.fromEntries(Object.entries(archive.componentFiles).map(([id, files]) =>
      [id, Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)]))])),
  }
}

test('M02-T05 Windows Save As retains identity and History; copied course edits independently after reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M02-T05 uses the Windows desktop carrier.')
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/m02/save-as-copy'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  const copyFolder = join(workspace, '副本'); mkdirSync(copyFolder, { recursive: true })
  const source = join(workspace, '原课件.h5lesson')
  const moved = join(workspace, '另存课件.h5lesson')
  const copied = join(copyFolder, '另存课件.h5lesson')
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'), source)
  const original = archiveFacts(source)
  const evidence: Record<string, unknown> = { source, moved, copied, original, steps: [] }
  let app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    const chooseWorkspace = async () => {
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
      await page.getByLabel('切换工作空间', { exact: true }).click()
      await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    }
    await chooseWorkspace()
    const tree = page.locator('.workspace-files-tree').getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: '原课件.h5lesson', exact: true }).dblclick()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    const snapshots = () => page.evaluate(async () => window.desktopAPI!.documents!.list())
    const initial = (await snapshots()).find(snapshot => snapshot.binding.kind === 'file' && snapshot.binding.path === source)
    if (!initial || initial.model.kind !== 'course-v9') throw new Error('source document did not open')
    evidence.initial = { id: initial.documentId, revision: initial.revision, undoDepth: initial.undoDepth, binding: initial.binding }
    const read = (id: string) => page.evaluate(async documentId => window.desktopAPI!.documents!.read(documentId), id)
    const deep = page.getByRole('button', { name: '深度编辑', exact: true })
    if (await deep.isVisible()) await deep.click()
    await page.getByTestId('add-text').click()
    await expect.poll(async () => (await read(initial.documentId)).undoDepth).toBe(initial.undoDepth + 1)
    const edited = await read(initial.documentId)
    evidence.edited = { id: edited.documentId, revision: edited.revision, undoDepth: edited.undoDepth, dirty: edited.dirty }
    expect(edited.dirty).toBe(true)

    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, moved)
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => existsSync(moved)).toBe(true)
    await expect.poll(async () => (await read(initial.documentId)).binding).toMatchObject({ kind: 'file', path: moved })
    const savedAs = await read(initial.documentId)
    expect(savedAs.documentId).toBe(initial.documentId)
    expect(savedAs.undoDepth).toBe(edited.undoDepth)
    expect(savedAs.revision).toBe(edited.revision)
    await expect.poll(async () => (await read(initial.documentId)).dirty).toBe(false)
    await expect(page.locator('.workspace-document-tabs button[role="tab"][title]').first()).toHaveAttribute('title', moved)
    expect(archiveFacts(source)).toEqual(original)
    expect(archiveFacts(moved)).toEqual({ ...original, itemCount: original.itemCount + 1 })
    evidence.savedAs = { id: savedAs.documentId, revision: savedAs.revision, undoDepth: savedAs.undoDepth, binding: savedAs.binding,
      source: archiveFacts(source), moved: archiveFacts(moved) }

    // Use the visible workspace file operation, then open the new path through the same tree.
    await page.getByRole('button', { name: '返回轻量编辑', exact: true }).click()
    const renamedRow = tree.getByRole('button', { name: '另存课件.h5lesson', exact: true })
    await expect(renamedRow).toBeVisible()
    await renamedRow.click(); await renamedRow.press('Control+C')
    const folder = tree.getByRole('button', { name: '副本', exact: true })
    await folder.click(); await folder.press('Control+V')
    await expect.poll(() => existsSync(copied)).toBe(true)
    await folder.locator('xpath=ancestor::li[1]').getByRole('button', { name: '另存课件.h5lesson', exact: true }).dblclick()
    const second = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), copied)
    expect(second.documentId).not.toBe(initial.documentId)
    expect(second.undoDepth).toBe(0)
    expect(archiveFacts(copied)).toEqual(archiveFacts(moved))
    await expect(page.locator('.workspace-document-tabs button[role="tab"][title]')).toHaveCount(2)
    evidence.copyOpened = { id: second.documentId, undoDepth: second.undoDepth, binding: second.binding, archive: archiveFacts(copied) }

    if (await deep.isVisible()) await deep.click()
    await page.getByTestId('add-text').click()
    await expect.poll(async () => (await read(second.documentId)).undoDepth).toBe(1)
    const copiedEdit = await read(second.documentId)
    expect(copiedEdit.dirty).toBe(true)
    expect((await read(initial.documentId)).undoDepth).toBe(edited.undoDepth)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await read(second.documentId)).dirty).toBe(false)
    expect(archiveFacts(copied)).toEqual({ ...original, itemCount: original.itemCount + 2 })
    expect(archiveFacts(moved)).toEqual({ ...original, itemCount: original.itemCount + 1 })
    expect(archiveFacts(source)).toEqual(original)
    evidence.copySaved = { id: second.documentId, revision: copiedEdit.revision, undoDepth: copiedEdit.undoDepth,
      source: archiveFacts(source), moved: archiveFacts(moved), copied: archiveFacts(copied) }

    await page.getByRole('button', { name: /撤销/ }).click()
    await expect.poll(async () => (await read(second.documentId)).undoDepth).toBe(0)
    expect((await read(initial.documentId)).undoDepth).toBe(edited.undoDepth)
    await page.getByRole('button', { name: /重做/ }).click()
    await expect.poll(async () => (await read(second.documentId)).undoDepth).toBe(1)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await read(second.documentId)).dirty).toBe(false)
    evidence.copyHistory = { originalUndoDepth: (await read(initial.documentId)).undoDepth,
      copiedUndoDepth: (await read(second.documentId)).undoDepth }

    // Relaunch the isolated app profile and reopen both saved bindings through the GUI.
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) })
    await app.close()
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await chooseWorkspace()
    const reopenedTree = page.locator('.workspace-files-tree').getByRole('tree', { name: '工作空间文件' })
    await reopenedTree.getByRole('button', { name: '另存课件.h5lesson', exact: true }).dblclick()
    await reopenedTree.getByRole('button', { name: '展开 副本' }).click()
    await reopenedTree.getByRole('button', { name: '副本', exact: true }).locator('xpath=ancestor::li[1]').getByRole('button', { name: '另存课件.h5lesson', exact: true }).dblclick()
    const reopened = await page.evaluate(async paths => Promise.all(paths.map(path => window.desktopAPI!.documents!.open(path))), [moved, copied])
    expect(reopened[0]!.documentId).not.toBe(reopened[1]!.documentId)
    expect(reopened.map(snapshot => snapshot.binding)).toMatchObject([{ kind: 'file', path: moved }, { kind: 'file', path: copied }])
    expect(archiveFacts(source)).toEqual(original)
    expect(archiveFacts(moved)).toEqual({ ...original, itemCount: original.itemCount + 1 })
    expect(archiveFacts(copied)).toEqual({ ...original, itemCount: original.itemCount + 2 })
    expect(errors).toEqual([])
    evidence.reopened = reopened.map(snapshot => ({ id: snapshot.documentId, binding: snapshot.binding, dirty: snapshot.dirty }))
    await page.screenshot({ path: join(directory, 'reopened-save-as-and-copy.png') })
    await info.attach('M02-T05 reopen', { path: join(directory, 'reopened-save-as-and-copy.png'), contentType: 'image/png' })
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    await app.windows()[0]?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
