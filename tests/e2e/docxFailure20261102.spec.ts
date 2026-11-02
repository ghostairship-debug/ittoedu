import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Row } from './helpers/g20M20Harness'

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

test('damaged Word input shows an actionable failure and can be retried after repair', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The real desktop acceptance runs on Windows.')
  test.setTimeout(180_000)
  const base = resolve('output/goal-correction-20261102/word-failure')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'ui-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const name = '损坏文稿.docx', filename = join(workspace, name)
  const broken = Buffer.from('damaged Word fixture: preserve these bytes')
  writeFileSync(filename, broken)
  const before = hash(broken)
  const evidence: Record<string, unknown> = { case: 'Word damaged input and retry', phase: 'launch', before }
  let running: Awaited<ReturnType<typeof launchM20>> | undefined
  try {
    running = await launchM20(fixture)
    const { app, page } = running
    await chooseM20Workspace(app, page, workspace)
    evidence.phase = 'open-damaged-original'
    await m20Row(page, name).dblclick()
    const pending = page.locator('.office-file-view__pending').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await expect(pending).toHaveAttribute('aria-label', `${name} 原件载入`, { timeout: 60_000 })
    await expect(page.locator('.office-file-view > p[role="alert"]')).toHaveText('Word 分页预览未完成：此预览入口需要有效的 DOCX 原件，请检查文稿后重试。\n原件保持不变，可重新载入或用系统应用核对。', { timeout: 60_000 })
    expect(hash(readFileSync(filename))).toBe(before)
    await page.screenshot({ path: join(directory, '01-damaged-feedback.png'), fullPage: true })

    evidence.phase = 'repair-and-retry'
    const repaired = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('修复后的中文文稿')] }] }))
    writeFileSync(filename, repaired)
    const repairedHash = hash(repaired)
    // Use the visible recovery action rather than invoking an internal service.
    await pending.getByRole('button', { name: '重新载入', exact: true }).click()
    const preview = page.locator('.docx-file-preview').filter({ has: page.locator('strong', { hasText: name }) })
    await expect(preview).toBeVisible({ timeout: 60_000 })
    await expect(preview).toHaveAttribute('data-source-sha256', repairedHash, { timeout: 60_000 })
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    expect(hash(readFileSync(filename))).toBe(repairedHash)
    evidence.phase = 'complete'; evidence.status = 'passed'; evidence.repairedHash = repairedHash
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.finalHash = hash(readFileSync(filename))
    if (running) await m20Evidence(info, fixture, running.page, evidence, error)
    else writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, failure: String(error) }, null, 2))
    throw error
  } finally {
    if (running) await closeM20(running.app)
  }
})

test('cancel an actual Word load, preserve its original and open it again', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The real desktop acceptance runs on Windows.')
  test.setTimeout(180_000)
  const base = resolve('output/goal-correction-20261102/word-cancel')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'ui-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const name = '取消排版后重开.docx', filename = join(workspace, name)
  const document = new Document({ sections: [{ children: Array.from({ length: 250 }, (_, index) =>
    new Paragraph(`第 ${index + 1} 段：这个中文文稿用于检查取消排版后原件是否保留以及重新打开是否正常。`)) }] })
  const original = await Packer.toBuffer(document)
  writeFileSync(filename, original)
  const before = hash(original)
  const evidence: Record<string, unknown> = { case: 'cancel pending Word load and reopen', phase: 'launch', before }
  let running: Awaited<ReturnType<typeof launchM20>> | undefined
  try {
    running = await launchM20(fixture)
    const { app, page } = running
    await chooseM20Workspace(app, page, workspace)
    evidence.phase = 'cancel-pending'
    await m20Row(page, name).dblclick()
    const pending = page.locator('.office-file-view__pending').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await expect(pending).toHaveAttribute('aria-label', `${name} 原件载入`)
    const cancel = pending.getByRole('button', { name: '取消并关闭', exact: true })
    await expect(cancel).toBeVisible()
    await cancel.click()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name, exact: true })).toHaveCount(0)
    expect(hash(readFileSync(filename))).toBe(before)

    evidence.phase = 'reopen-after-cancel'
    await m20Row(page, name).dblclick()
    const preview = page.locator('.docx-file-preview').filter({ has: page.locator('strong', { hasText: name }) })
    await expect(preview).toBeVisible({ timeout: 60_000 })
    await expect(preview).toHaveAttribute('data-source-sha256', before)
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    expect(hash(readFileSync(filename))).toBe(before)
    evidence.phase = 'complete'; evidence.status = 'passed'; evidence.finalHash = hash(readFileSync(filename))
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.finalHash = hash(readFileSync(filename))
    if (running) await m20Evidence(info, fixture, running.page, evidence, error)
    else writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, failure: String(error) }, null, 2))
    throw error
  } finally {
    if (running) await closeM20(running.app)
  }
})

