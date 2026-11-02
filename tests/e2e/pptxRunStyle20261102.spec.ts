import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Row } from './helpers/g20M20Harness'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function inspect(filename: string) {
  const value = inspectOfficeContent(readFileSync(filename), 'pptx')
  if (value.format !== 'pptx') throw new Error('Expected PPTX')
  return value
}

test('PPT original UI edits one text run while preserving its neighbor, history and cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Formal desktop acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  const base = resolve('output/goal-correction-20261102/pptx-run-style')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const name = '双片段样式.pptx', filename = join(workspace, name)
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  ppt.addSlide().addText([
    { text: '保留相邻片段', options: { fontSize: 20, bold: true, color: '204060' } },
    { text: '目标片段', options: { fontSize: 32, italic: true, color: 'A05020' } },
  ], { x: 1, y: 1, w: 10, h: 1, objectName: 'run-style-target' })
  const generated = await ppt.write({ outputType: 'uint8array' })
  if (!(generated instanceof Uint8Array)) throw new Error('Expected PPTX bytes')
  writeFileSync(filename, generated)
  const initialHash = hash(generated), original = inspect(filename)
  const target = original.slides[0].shapes.find(shape => shape.name === 'run-style-target')
  if (!target || target.runs.length !== 1 || target.runs[0]?.length !== 2) throw new Error('Fixture must contain one paragraph with exactly two real text runs')
  const neighborBefore = structuredClone(target.runs[0][0]), targetBefore = structuredClone(target.runs[0][1])
  expect(neighborBefore.text).toBe('保留相邻片段')
  expect(targetBefore.text).toBe('目标片段')
  expect(neighborBefore.style).toMatchObject({ fontSize: 20, bold: true, color: '204060' })
  expect(targetBefore.style).toMatchObject({ fontSize: 32, italic: true, color: 'A05020' })
  const expectedTarget = { ...targetBefore, style: { ...targetBefore.style, fontSize: 26 } }
  const evidence: Record<string, unknown> = { case: 'PPT UI targeted text run style', directory, phase: 'launch', initialHash,
    shapeId: target.shapeId, paragraph: 0, run: 1, neighborBefore, targetBefore,
    boundary: 'Real human UI, no model run; isolated original PPTX fixture.' }
  const errors: string[] = []
  let { app, page } = await launchM20(fixture)
  page.on('pageerror', error => errors.push(error.message))
  const runs = () => {
    const shape = inspect(filename).slides[0].shapes.find(item => item.shapeId === target.shapeId)
    if (!shape || shape.runs.length !== 1 || shape.runs[0]?.length !== 2) throw new Error('Target identity or run structure changed')
    return shape.runs[0]
  }
  try {
    const initialPid = app.process().pid
    evidence.initialPid = initialPid
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const preview = page.getByRole('region', { name: `${name} PPTX 对象共编`, exact: true })
    await expect(preview).toBeVisible()
    const picker = preview.getByLabel('选择幻灯片对象'), panel = preview.getByRole('complementary', { name: '演示文稿对象编辑' })
    await picker.selectOption(target.shapeId)
    await panel.getByLabel('文字范围', { exact: true }).selectOption('r:0:1')
    await expect(panel.getByLabel('对象文字')).toHaveValue(targetBefore.text)
    await expect(panel.getByLabel('字号', { exact: true })).toHaveValue('32')
    evidence.phase = 'human-targeted-run-edit'
    await panel.getByLabel('字号', { exact: true }).fill('26')
    await panel.getByRole('button', { name: '应用修改', exact: true }).click()
    await expect.poll(() => runs()[1].style.fontSize).toBe(26)
    await expect(preview).toContainText('已自动保存')
    expect(runs()[0]).toEqual(neighborBefore)
    expect(runs()[1]).toEqual(expectedTarget)
    const savedHash = hash(readFileSync(filename))
    expect(savedHash).not.toBe(initialHash)
    evidence.savedHash = savedHash; evidence.neighborAfter = runs()[0]; evidence.targetAfter = runs()[1]
    await page.screenshot({ path: join(directory, '01-targeted-run-saved.png'), fullPage: true })

    evidence.phase = 'undo-and-redo'
    await preview.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => runs()[1].style.fontSize).toBe(32)
    expect(runs()[0]).toEqual(neighborBefore); expect(runs()[1]).toEqual(targetBefore)
    await expect(preview).toContainText('已自动保存')
    await preview.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => runs()[1].style.fontSize).toBe(26)
    expect(runs()[0]).toEqual(neighborBefore); expect(runs()[1]).toEqual(expectedTarget)
    await expect(preview).toContainText('已自动保存')
    expect(hash(readFileSync(filename))).toBe(savedHash)
    evidence.undoRedo = { originalTargetSize: 32, savedTargetSize: 26, neighborUnchanged: true }

    evidence.phase = 'independent-process-cold-reopen'
    await closeM20(app)
    ;({ app, page } = await launchM20(fixture))
    page.on('pageerror', error => errors.push(error.message))
    const coldPid = app.process().pid
    expect(coldPid).not.toBe(initialPid)
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const cold = page.getByRole('region', { name: `${name} PPTX 对象共编`, exact: true })
    await expect(cold).toBeVisible()
    await expect(cold).toContainText('第 1 / 1 页')
    await cold.getByLabel('选择幻灯片对象').selectOption(target.shapeId)
    const coldPanel = cold.getByRole('complementary', { name: '演示文稿对象编辑' })
    await coldPanel.getByLabel('文字范围', { exact: true }).selectOption('r:0:1')
    await expect(coldPanel.getByLabel('字号', { exact: true })).toHaveValue('26')
    expect(hash(readFileSync(filename))).toBe(savedHash)
    expect(runs()[0]).toEqual(neighborBefore); expect(runs()[1]).toEqual(expectedTarget)
    expect(errors).toEqual([])
    evidence.coldPid = coldPid; evidence.finalHash = hash(readFileSync(filename)); evidence.errors = errors
    evidence.phase = 'complete'; evidence.status = 'real-ui-targeted-run-style-history-cold-reopen-passed'
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.errors = errors; evidence.finalHash = hash(readFileSync(filename))
    await m20Evidence(info, fixture, page, evidence, error)
    throw error
  } finally { await closeM20(app) }
})

