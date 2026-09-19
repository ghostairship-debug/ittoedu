import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { installChatFailureFixture } from './chatFailureFixture'
import { archiveHasMarker, destroyEditor, dismissOverlays, firstSave, launchEditor, openWorkspaceAndSession, runDirectory, typeAndSubmit } from './r19ChatSpecSupport'

/** Commit receipt only — the same selector boundary as r19TaskDrivenTeacherChain.spec.ts readApplyState. */
async function readApplyState(page: Page) {
  return page.evaluate(() => {
    const chat = document.querySelector('.course-chat')
    const strong = chat?.querySelector('[aria-label="实际应用结果"] strong')?.textContent ?? ''
    const alert = chat?.querySelector('[role="alert"]')?.textContent ?? ''
    const notice = chat?.querySelector('[role="status"]')?.textContent ?? ''
    const buttons = [...(chat?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
    const busy = buttons.some(button => button.textContent === '停止' && !button.disabled)
    const apply = buttons.some(button => button.textContent === '应用候选' && !button.disabled)
    const committed = strong.includes('已应用课件修改') || buttons.some(button => button.textContent === '撤销最近一次 AI 修改')
    if (committed) return busy ? 'COMMITTED-BUSY' : 'COMMITTED'
    if (apply) return 'PREVIEW'
    if (busy) return `WAIT:${strong}|${alert}`
    if (strong.includes('已核对，无需修改')) return 'UNCHANGED'
    if (strong.includes('本阶段未应用') || alert) return `REJECTED:${strong}|${alert}`
    return `ENDED:${strong}|${notice}`
  })
}

/**
 * The retry branch of ensureCommittedApply() in r19TaskDrivenTeacherChain.spec.ts is only
 * reached when a task ends without a commit. This spec makes that state deterministic with
 * the failure fixture's no-progress mode, then runs the retry steps by hand: 停止 → 会话可选 →
 * 选「新对话」→ 再发送. Both halves must be observed: the terminal failure first, then a real
 * 「已应用课件修改」 receipt. Nothing in the middle is mocked.
 * No configureLuna() here: the fixture CLI only offers `fixture-model`, and this spec tests the
 * host retry path, not model routing.
 */
test('r19 050 retry: 终态失败后 停止 → 会话新对话 → 重发，第二次真实提交', async () => {
  test.setTimeout(10 * 60_000)
  const directory = runDirectory('r19-050-retry-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'retry.h5lesson')
  const marker = '平均分的含义'
  let app: ElectronApplication | undefined
  let fixture: Awaited<ReturnType<typeof installChatFailureFixture>> | undefined
  try {
    app = await launchEditor(profile)
    fixture = await installChatFailureFixture(app, directory)
    const page = await openWorkspaceAndSession(app, workspace)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    await firstSave(app, page, firstPath)
    expect(archiveHasMarker(firstPath, marker)).toBe(false)
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
    const stop = chat.getByRole('button', { name: '停止', exact: true })
    const session = chat.getByLabel('会话')
    const instruction = '在当前空白演示页正中加入一行标题文字，文字必须精确为平均分的含义。'

    fixture.mode('no-progress')
    await typeAndSubmit(chat, instruction)
    // 1) 先看到真实终态失败。没有这一段，后面即使绿了也证明不了 retry。
    await expect(chat.getByRole('alert')).toContainText('连续两轮没有进展', { timeout: 3 * 60_000 })
    await expect(stop).toBeDisabled({ timeout: 60_000 })
    await expect(session).toBeEnabled({ timeout: 30_000 })
    expect(archiveHasMarker(firstPath, marker), 'failed task must not touch the saved archive').toBe(false)
    const failedState = await readApplyState(page)
    expect(['REJECTED', 'ENDED'], `首任务必须是终态失败而不是提交：${failedState}`).toContain(failedState.split(':')[0])
    const stagnantRuns = fixture.runs()
    expect(stagnantRuns.map(run => [run.mode, run.revision, run.repair])).toEqual([
      ['no-progress', 0, false], ['no-progress', 0, true], ['no-progress', 0, true],
    ])
    console.log('050 retry step 1: 终态失败可见', JSON.stringify({
      alert: await chat.getByRole('alert').textContent(),
      runs: stagnantRuns.map(run => [run.mode, run.revision, run.repair]),
    }))

    // 2) 手动执行 ensureCommittedApply 的 retry 分支（此前从未在真实运行中执行过）。
    if (await stop.isEnabled().catch(() => false)) await stop.click({ force: true })
    await expect(stop).toBeDisabled({ timeout: 60_000 })
    console.log('050 retry step 2: 停止已不可用')
    await expect(session).toBeEnabled({ timeout: 30_000 })
    console.log('050 retry step 3: 会话可选')
    await session.selectOption('')
    await expect(session).toHaveValue('')
    fixture.mode('repair')
    await typeAndSubmit(chat, instruction)
    await expect(stop).toBeEnabled({ timeout: 30_000 })
    console.log('050 retry step 4: 已在「新对话」重新发送')

    // 3) 第二次必须真实提交：只认 actualResult 回执。
    await expect.poll(async () => (await readApplyState(page)).replace(/-BUSY$/, ''), { timeout: 5 * 60_000, intervals: [3_000, 5_000] }).toBe('COMMITTED')
    await expect(stop).toBeDisabled({ timeout: 60_000 })
    // 精确文本：带「此前结果 · 」前缀的旧回执不算本次提交。
    await expect(chat.locator('[aria-label="实际应用结果"] strong')).toHaveText('已应用课件修改')
    console.log('050 retry step 5: 已应用课件修改', JSON.stringify(await readApplyState(page)))
    const retryRuns = fixture.runs().slice(stagnantRuns.length)
    expect(retryRuns.map(run => [run.mode, run.repair])).toEqual([['repair', false], ['repair', true]])
    expect(new Set(retryRuns.map(run => run.nativeThreadId)).size).toBe(1)
    expect(retryRuns[0]!.nativeThreadId, '新对话必须开启新的原生会话，而不是复用失败的线程').not.toBe(stagnantRuns.at(-1)!.nativeThreadId)

    // 4) 保存并核对 archive 正文里真的有这次应用。
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, firstPath)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click({ force: true })
    await expect.poll(() => archiveHasMarker(firstPath, marker), { timeout: 20_000 }).toBe(true)
    console.log('050 retry step 6: archive 正文包含', JSON.stringify(marker))
    expect(pageErrors, '渲染进程不应出现未捕获异常').toEqual([])
  } finally {
    if (fixture) await fixture.restore()
    await destroyEditor(app, directory)
  }
})
