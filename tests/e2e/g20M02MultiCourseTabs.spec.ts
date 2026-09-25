import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')
const filename = '同名课件.h5lesson'

function archiveFacts(path: string) {
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(path)))
  const project = archive.project
  return {
    projectId: project.id,
    itemCount: project.surfaces.reduce((total, surface) => surface.type === 'slide'
      ? total + surface.scenes.reduce((count, scene) => count + scene.layerItems.length, 0) : total, 0),
    assets: Object.fromEntries(Object.entries(archive.assetFiles).map(([id, bytes]) => [id, Array.from(bytes)])),
  }
}

test('M02-T01 Windows same-name courses keep edits, resources and history in their own tabs', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M02-T01 uses the Windows desktop carrier.')
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/m02/multi-course-tabs'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  const folderA = join(workspace, '甲'), folderB = join(workspace, '乙')
  mkdirSync(folderA, { recursive: true }); mkdirSync(folderB, { recursive: true })
  const fileA = join(folderA, filename), fileB = join(folderB, filename)
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'), fileA)
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'), fileB)
  const originalA = archiveFacts(fileA), originalB = archiveFacts(fileB)
  expect(originalA.projectId).not.toBe(originalB.projectId)
  const evidence: Record<string, unknown> = { fileA, fileB, originalA, originalB, steps: [] }
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const files = page.locator('.workspace-files-tree')
    const tree = files.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: '展开 甲' }).click()
    await tree.getByRole('button', { name: '展开 乙' }).click()
    const rows = tree.getByRole('button', { name: filename, exact: true })
    await expect(rows).toHaveCount(2)
    const tabs = page.locator('.workspace-document-tabs button[role="tab"][title]')
    const read = (path: string) => page.evaluate(async file => window.desktopAPI!.documents!.open(file), path)
    const facts = async (path: string) => {
      const snapshot = await read(path)
      if (snapshot.model.kind !== 'course-v9') throw new Error(`not a course: ${path}`)
      return {
        documentId: snapshot.documentId, revision: snapshot.revision,
        undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth, dirty: snapshot.dirty,
        projectId: snapshot.model.project.id,
        itemCount: snapshot.model.project.surfaces.reduce((total, surface) => surface.type === 'slide'
          ? total + surface.scenes.reduce((count, scene) => count + scene.layerItems.length, 0) : total, 0),
        assets: Object.fromEntries(Object.entries(snapshot.model.resources.assets).map(([id, bytes]) => [id, Array.from(bytes)])),
      }
    }
    const activate = async (index: number) => {
      await tabs.nth(index).click()
      await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('canvas-stage')).toBeVisible()
    }
    const addText = async () => {
      const deep = page.getByRole('button', { name: '深度编辑', exact: true })
      if (await deep.isVisible()) await deep.click()
      await page.getByTestId('add-text').click()
    }
    const record = async (step: string) => {
      const state = { step, A: await facts(fileA), B: await facts(fileB) }
      ;(evidence.steps as unknown[]).push(state)
      return state
    }

    await rows.first().dblclick()
    await expect(tabs).toHaveCount(1)
    await expect(tabs.first()).toHaveAttribute('title', fileA)
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await rows.last().dblclick()
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(1)).toHaveAttribute('title', fileB)
    const labels = await tabs.allTextContents()
    evidence.labels = labels
    evidence.tabTitles = await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('title')))
    const initial = await record('both-open')
    expect(initial.A.documentId).not.toBe(initial.B.documentId)
    expect(initial.A.projectId).toBe(originalA.projectId)
    expect(initial.B.projectId).toBe(originalB.projectId)
    expect(initial.A.assets).toEqual(originalA.assets)
    expect(initial.B.assets).toEqual(originalB.assets)

    await activate(0); await addText()
    await expect.poll(async () => (await facts(fileA)).itemCount).toBe(originalA.itemCount + 1)
    await record('A-edited')
    await activate(1); await addText()
    await expect.poll(async () => (await facts(fileB)).itemCount).toBe(originalB.itemCount + 1)
    const bothEdited = await record('B-edited')
    expect(bothEdited.A.itemCount).toBe(originalA.itemCount + 1)
    expect(bothEdited.B.itemCount).toBe(originalB.itemCount + 1)
    expect(bothEdited.A.undoDepth).toBe(initial.A.undoDepth + 1)
    expect(bothEdited.B.undoDepth).toBe(initial.B.undoDepth + 1)

    await activate(0)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => archiveFacts(fileA).itemCount).toBe(originalA.itemCount + 1)
    await page.getByRole('button', { name: /撤销/ }).click()
    await expect.poll(async () => (await facts(fileA)).itemCount).toBe(originalA.itemCount)
    const afterUndoA = await record('A-undo')
    expect(afterUndoA.B.itemCount).toBe(originalB.itemCount + 1)
    expect(afterUndoA.B.undoDepth).toBe(initial.B.undoDepth + 1)
    await page.getByRole('button', { name: /重做/ }).click()
    await expect.poll(async () => (await facts(fileA)).itemCount).toBe(originalA.itemCount + 1)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()

    await activate(1)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => archiveFacts(fileB).itemCount).toBe(originalB.itemCount + 1)
    await page.getByRole('button', { name: /撤销/ }).click()
    await expect.poll(async () => (await facts(fileB)).itemCount).toBe(originalB.itemCount)
    const afterUndoB = await record('B-undo')
    expect(afterUndoB.A.itemCount).toBe(originalA.itemCount + 1)
    expect(afterUndoB.A.undoDepth).toBe(initial.A.undoDepth + 1)
    await page.getByRole('button', { name: /重做/ }).click()
    await expect.poll(async () => (await facts(fileB)).itemCount).toBe(originalB.itemCount + 1)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await facts(fileB)).dirty).toBe(false)
    const final = await record('both-saved-after-redo')
    expect(final.A.dirty).toBe(false); expect(final.B.dirty).toBe(false)
    expect(final.A.assets).toEqual(originalA.assets); expect(final.B.assets).toEqual(originalB.assets)
    expect(archiveFacts(fileA)).toMatchObject({ projectId: originalA.projectId, itemCount: originalA.itemCount + 1, assets: originalA.assets })
    expect(archiveFacts(fileB)).toMatchObject({ projectId: originalB.projectId, itemCount: originalB.itemCount + 1, assets: originalB.assets })
    expect(errors).toEqual([])
    await page.screenshot({ path: join(directory, 'both-tabs.png') })
    await info.attach('M02-T01 tabs', { path: join(directory, 'both-tabs.png'), contentType: 'image/png' })
    // The contract requires visible, distinguishable titles even with the same basename.
    expect(labels[0]).not.toBe(labels[1])
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
