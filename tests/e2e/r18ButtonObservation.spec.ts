import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { dynamicAdmissionPayloadSchema, dynamicAdmissionResultSchema } from '../../src/shared/dynamicAdmissionContract'
import { closeNativeEditor, launchNativeEditor, selectLayer } from './r18NativeAuthoringFixture'
import { REMAINING_IDS, buttonRuntime, writeRemainingLesson } from './r18NativeAuthoringRemainingFixture'

test('R18 candidate button observation: actual input and before-after evidence preserve the live lesson', async () => {
  test.setTimeout(120_000)
  const productRoot = resolve(__dirname, '../..')
  const directory = join(productRoot, 'output/r18-button-observation', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(directory, { recursive: true })
  const projectPath = join(directory, 'lesson.h5lesson'), baseline = await writeRemainingLesson(projectPath)
  const run = await launchNativeEditor(productRoot, directory, projectPath)
  try {
    await selectLayer(run.page, REMAINING_IDS.brokenRuntime)
    const closePanel = run.page.locator('[aria-label="课件编辑面板"]').getByRole('button', { name: '关闭面板', exact: true })
    if (await closePanel.isVisible()) await closePanel.click()
    await run.page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    const project = structuredClone(baseline.project)
    buttonRuntime(project).runtime.source = buttonRuntime(project).runtime.source.replaceAll("'doubleclick'", "'click'")
      .replace('cursor:pointer', 'pointer-events:auto;cursor:pointer')
    const componentFiles = Object.fromEntries(Object.entries(baseline.componentFiles).map(([packageKey, files]) => [
      packageKey,
      Object.fromEntries(Object.entries(files).map(([name, bytes]) => [
        name,
        Buffer.from(bytes).toString('base64'),
      ])),
    ]))
    const payload = dynamicAdmissionPayloadSchema.parse({ project,
      assetFiles: Object.fromEntries(Object.entries(baseline.assetFiles).map(([id, bytes]) => [id, Buffer.from(bytes).toString('base64')])),
      componentFiles, observeBehavior: true,
      buttonCheck: { version: 1, instanceId: REMAINING_IDS.brokenRuntime, label: '显示答案' },
      targets: [{ locationId: project.startLocationId, stateId: null, instanceIds: [REMAINING_IDS.brokenRuntime] }] })
    expect(dynamicAdmissionPayloadSchema.safeParse({ ...payload, verificationMode: 'public-props' }).success).toBe(false)
    expect(dynamicAdmissionPayloadSchema.safeParse({ ...payload, buttonCheck: { ...payload.buttonCheck!, instanceId: 'outside-target' } }).success).toBe(false)
    const perform = async (input: typeof payload) => dynamicAdmissionResultSchema.parse(await run.page.evaluate(async input => {
      if (!window.desktopAPI?.dynamicAdmission) throw new Error('Missing actual desktop admission')
      return window.desktopAPI.dynamicAdmission({ operation: 'run', id: crypto.randomUUID(), payload: input })
    }, input))
    const repaired = await perform(payload)
    writeFileSync(join(directory, 'repaired.json'), JSON.stringify(repaired, null, 2))
    expect(repaired.ok, repaired.message).toBe(true)
    const evidence = repaired.behaviorEvidence?.[0]
    expect(evidence?.actions).toContain('click-button')
    expect(evidence?.frames).toHaveLength(8)
    expect(evidence?.buttonClick).toMatchObject({ instanceId: REMAINING_IDS.brokenRuntime, input: 'electron-mouse', functionalResult: 'requires-review' })
    expect(evidence?.buttonClick?.beforeText).toContain('答案尚未显示')
    expect(evidence?.buttonClick?.afterText).toContain('正确答案：周期是完成一次往复运动所用的时间。')
    expect(evidence?.buttonClick?.beforeText.replace(/\s+/g, ' ').trim()).toBe('显示答案 答案尚未显示')
    expect(evidence?.buttonClick?.afterText.replace(/\s+/g, ' ').trim()).toBe('显示答案 正确答案：周期是完成一次往复运动所用的时间。')
    expect(evidence!.buttonClick!.observedAt - evidence!.buttonClick!.clickedAt).toBeGreaterThanOrEqual(500)
    const after = evidence!.frames.find(frame => frame.phase === 'after-button-click')!
    writeFileSync(join(directory, 'candidate-after-click.png'), Buffer.from(after.dataUrl.split(',')[1]!, 'base64'))
    await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    await expect(run.page.getByText('正确答案：周期是完成一次往复运动所用的时间。', { exact: true })).toHaveCount(0)
    const delayedProject = structuredClone(project)
    buttonRuntime(delayedProject).runtime.source = buttonRuntime(delayedProject).runtime.source
      .replace('var showAnswer=function(){answer.textContent=', 'var showAnswer=function(){setTimeout(function(){answer.textContent=')
      .replace("时间。'};", "时间。'},150)};")
    expect(buttonRuntime(delayedProject).runtime.source).toContain('setTimeout')
    const delayed = await perform({ ...payload, project: delayedProject })
    writeFileSync(join(directory, 'delayed.json'), JSON.stringify(delayed, null, 2))
    expect(delayed.ok, delayed.message).toBe(true)
    expect(delayed.behaviorEvidence?.[0]?.buttonClick?.afterText).toContain('正确答案：周期是完成一次往复运动所用的时间。')
    const brokenProject = structuredClone(baseline.project)
    buttonRuntime(brokenProject).runtime.source = buttonRuntime(brokenProject).runtime.source.replace('cursor:pointer', 'pointer-events:auto;cursor:pointer')
    const broken = await perform({ ...payload, project: brokenProject })
    writeFileSync(join(directory, 'broken.json'), JSON.stringify(broken, null, 2))
    expect(broken.ok, broken.message).toBe(true)
    expect(broken.behaviorEvidence?.[0]?.buttonClick?.afterText).toContain('答案尚未显示')
    expect(broken.behaviorEvidence?.[0]?.buttonClick?.functionalResult).toBe('requires-review')
    const missing = await perform({ ...payload, buttonCheck: { ...payload.buttonCheck!, label: '不存在的按钮' } })
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('实际找到 0 个')
    await expect(run.page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    await run.page.screenshot({ path: join(directory, 'live-lesson-untouched.png') })
  } finally { await closeNativeEditor(run) }
})
