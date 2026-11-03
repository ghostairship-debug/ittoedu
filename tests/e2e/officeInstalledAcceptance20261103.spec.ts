import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

test.use({ trace: 'off', video: 'off' })
test('installed NSIS application edits, saves and cold reopens an original PPT with a fresh profile', async ({}, info) => {
  test.skip(process.platform !== 'win32' || !process.env.COURSEWARE_INSTALL_ACCEPTANCE_DIRECTORY)
  test.setTimeout(180000)
  const directory = resolve(process.env.COURSEWARE_INSTALL_ACCEPTANCE_DIRECTORY!)
  const requestedExecutable = process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE
  if (!requestedExecutable) throw new Error('Explicit installed executable is required')
  const executable = resolve(requestedExecutable)
  expect(existsSync(executable)).toBe(true)
  const workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  expect(existsSync(profile)).toBe(false)
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile }, filename = join(workspace, '安装后编辑验收.pptx')
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  slide.addText('安装后原始标题', { x: 1, y: 1, w: 10, h: 1, fontSize: 28, color: '202124', objectName: 'installed-title' })
  slide.addText('范围外内容保留', { x: 1, y: 3, w: 10, h: 1, objectName: 'preserved' })
  const bytes = await ppt.write({ outputType: 'uint8array' })
  if (!(bytes instanceof Uint8Array)) throw new Error('Fixture bytes expected')
  writeFileSync(filename, bytes)
  const content = () => { const value = inspectOfficeContent(readFileSync(filename), 'pptx'); if (value.format !== 'pptx') throw new Error('PPT expected'); return value }
  const facts: Record<string, unknown> = { status: 'running', phase: 'open', directory, executable,
    boundary: 'Real installed NSIS application and clean explicit profile; direct text input, shared history and saved original OOXML. No native IME or independent-device claim.' }
  const errors: string[] = []
  let { app, page } = await launchM20(fixture, { visible: true })
  page.on('pageerror', error => errors.push(error.message))
  try {
    facts.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'), execPath: process.execPath }))
    expect((facts.runtime as any).packaged).toBe(true)
    expect(resolve((facts.runtime as any).execPath)).toBe(executable)
    expect(resolve((facts.runtime as any).appPath)).toBe(join(dirname(executable), 'resources', 'app.asar'))
    await chooseM20Workspace(app, page, workspace); await m20Row(page, '安装后编辑验收.pptx').dblclick()
    const editor = page.locator('.pptx-editor').filter({ visible: true }), stage = editor.getByTestId('pptx-edit-surface')
    await expect(stage).toContainText('安装后原始标题', { timeout: 45000 })
    facts.phase = 'edit-and-save'
    await stage.getByText('安装后原始标题', { exact: true }).first().dblclick()
    await expect(stage.locator('[contenteditable="true"]').filter({ visible: true }).first()).toBeVisible()
    await page.keyboard.press('Control+A'); await page.keyboard.insertText('真实安装后保存的中文标题'); await page.keyboard.press('Escape')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => content().slides[0].shapes.find(shape => shape.name === 'installed-title')?.text).toBe('真实安装后保存的中文标题')
    expect(content().slides[0].shapes.find(shape => shape.name === 'preserved')?.text).toBe('范围外内容保留')
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => content().slides[0].shapes.find(shape => shape.name === 'installed-title')?.text).toBe('安装后原始标题')
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => content().slides[0].shapes.find(shape => shape.name === 'installed-title')?.text).toBe('真实安装后保存的中文标题')
    await page.screenshot({ path: join(directory, 'installed-edited.png'), fullPage: true })
    const previousPid = app.process().pid
    facts.phase = 'cold-reopen'; await closeM20(app); ({ app, page } = await launchM20(fixture, { visible: true }))
    page.on('pageerror', error => errors.push(error.message))
    expect(app.process().pid).not.toBe(previousPid)
    await chooseM20Workspace(app, page, workspace); await m20Row(page, '安装后编辑验收.pptx').dblclick()
    await expect(page.getByTestId('pptx-edit-surface')).toContainText('真实安装后保存的中文标题', { timeout: 45000 })
    await expect(page.locator('.pptx-editor').getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    expect(content().slides[0].shapes.find(shape => shape.name === 'preserved')?.text).toBe('范围外内容保留')
    expect(errors).toEqual([])
    facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await page.screenshot({ path: join(directory, 'installed-cold-reopen.png'), fullPage: true })
    await m20Evidence(info, fixture, page, facts)
  } catch (error) { facts.errors = errors; await m20Evidence(info, fixture, page, facts, error); throw error }
  finally { await closeM20(app) }
})
