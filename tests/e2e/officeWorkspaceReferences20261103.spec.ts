import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { complexPptxFixture } from '../helpers/officeComplexFixture20261103'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

test.use({ trace: 'off', video: 'off' })
test('rapidly opened GLX and Office files remain open with consistent explicit and fixed references', async ({}, info) => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(180000)
  const base = resolve('output/office-coedit-20261103/workspace-references'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const project = createBlankCourseProjectV10('教学')
  writeFileSync(join(workspace, '教学.glx'), createCourseProjectV10Archive({ project, resources: { assets: {}, components: {} } }))
  writeFileSync(join(workspace, '项目汇报.pptx'), await complexPptxFixture())
  writeFileSync(join(workspace, '会议记录.docx'), (await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: '会议正文' }] })).bytes)
  writeFileSync(join(workspace, '预算.xlsx'), (await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: '预算', rows: [['项目', '数值'], ['A', 10]] }] })).bytes)
  const facts: Record<string, unknown> = { directory, status: 'running', phase: 'rapid-open', glxFixtureSchemaVersion: project.schemaVersion }
  const { app, page } = await launchM20(fixture)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await chooseM20Workspace(app, page, workspace)
    for (const name of ['教学.glx', '预算.xlsx', '会议记录.docx', '项目汇报.pptx']) await m20Row(page, name).dblclick()
    const tabs = page.locator('.workspace-document-tabs').getByRole('tab')
    await expect(tabs).toHaveCount(4, { timeout: 45000 })
    await expect(tabs.filter({ hasText: '项目汇报.pptx' })).toHaveAttribute('aria-selected', 'true')
    facts.tabs = await tabs.allTextContents()
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    const refs = assistant.getByLabel('本条消息的文件引用', { exact: true })
    await expect(refs).toContainText('项目汇报')
    await expect(refs).toContainText('第 1 页')
    facts.phase = 'fixed-reference'
    await assistant.getByRole('button', { name: '添加', exact: true }).click()
    await assistant.getByRole('menuitem', { name: '引用当前页', exact: true }).click()
    await expect(refs.getByRole('button', { name: '取消固定 项目汇报.pptx', exact: true })).toBeVisible()
    await tabs.filter({ hasText: '预算.xlsx' }).click()
    await expect(refs).toContainText('项目汇报')
    await expect(refs).not.toContainText('预算.xlsx')
    await refs.getByRole('button', { name: '取消固定 项目汇报.pptx', exact: true }).click()
    await expect(refs).toContainText('预算.xlsx')
    facts.phase = 'explicit-current-file'
    await assistant.getByRole('button', { name: '添加', exact: true }).click()
    await assistant.getByRole('menuitem', { name: '引用当前文件', exact: true }).click()
    await expect(refs.getByRole('button', { name: '取消固定 预算.xlsx', exact: true })).toBeVisible()
    await tabs.filter({ hasText: '教学.glx' }).click()
    await expect(refs).toContainText('预算.xlsx')
    await refs.getByRole('button', { name: '取消固定 预算.xlsx', exact: true }).click()
    await expect(assistant.getByLabel('本条消息的引用', { exact: true })).toContainText('教学')
    facts.phase = 'at-reference-consistency'
    await tabs.filter({ hasText: '项目汇报.pptx' }).click()
    const input = assistant.getByRole('textbox', { name: '给果铃AI发消息', exact: true })
    await input.fill('@')
    await page.getByRole('listbox', { name: '文件与当前上下文候选', exact: true }).getByRole('option', { name: '当前页', exact: true }).click()
    await expect(input).toHaveValue('')
    await expect(refs).toContainText('第 1 页')
    await expect(refs.getByRole('button', { name: '取消固定 项目汇报.pptx', exact: true })).toBeVisible()
    await tabs.filter({ hasText: '会议记录.docx' }).click()
    await expect(refs).toContainText('项目汇报')
    await refs.getByRole('button', { name: '取消固定 项目汇报.pptx', exact: true }).click()
    await expect(refs).toContainText('会议记录.docx')
    facts.atAndPlusUseSameFixedPage = true
    facts.phase = 'close-and-reopen-focus'
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 会议记录.docx', exact: true }).click()
    await expect(tabs).toHaveCount(3)
    await expect(tabs.filter({ hasText: '教学.glx' })).toHaveAttribute('aria-selected', 'true')
    await expect(assistant.getByLabel('本条消息的引用', { exact: true })).toContainText('教学')
    await expect(refs).toHaveCount(0)
    await m20Row(page, '会议记录.docx').dblclick()
    await expect(tabs).toHaveCount(4)
    await expect(refs).toContainText('会议记录.docx')
    facts.closedFileFocusRemovedAndReopened = true
    expect(errors).toEqual([])
    facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await m20Evidence(info, fixture, page, facts)
  } catch (error) {
    facts.tabs = await page.locator('.workspace-document-tabs').getByRole('tab').allTextContents().catch(() => [])
    facts.alerts = await page.getByRole('alert').allTextContents().catch(() => [])
    facts.errors = errors; await m20Evidence(info, fixture, page, facts, error); throw error
  } finally { await closeM20(app) }
})
