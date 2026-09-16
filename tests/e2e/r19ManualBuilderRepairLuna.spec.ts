import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

test('manual retained native Luna session repairs only the staged Builder module', async ({}, testInfo) => {
  test.skip(process.env.R19_MANUAL_BUILDER_REPAIR !== '1', 'Requires the released retained manual profile')
  test.setTimeout(25 * 60_000)
  const root = resolve(__dirname, '../..')
  const evidence = join(root, 'output/r19-manual-luna/manual-parallel-20260915-170551')
  const output = join(evidence, 'native-builder-repair', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(output, { recursive: true })
  const profile = join(evidence, 'profile')
  const candidate = join(profile, 'lesson-authoring-candidates/v1/7d51757a-a91f-4594-a44e-ade85171c334/build.mjs')
  const sessionId = process.env.R19_MANUAL_REPAIR_SESSION ?? '30d297dd-6223-482b-9827-2eb42cbe0dd6'
  const recordPath = join(profile, 'local-agent/v3/3c5173acb7ef5ca096a467da586cb1e2f346e933ba92fd63174ff07dff3c6a85', `${sessionId}.json`)
  const prior = JSON.parse(readFileSync(recordPath, 'utf8'))
  const workspace = prior.workspace
  expect(prior.externalSessionId).toBeTruthy()
  copyFileSync(candidate, join(output, 'before.mjs'))
  writeFileSync(join(output, 'prior-native-identity.json'), JSON.stringify({ sessionId, externalSessionId: prior.externalSessionId, workspace }, null, 2))
  const docs = ['teaching-brief.md', '01-teaching-plan.md', 'presentation-brief.md', '02-presentation-script.md']
  const before = docs.map(name => readFileSync(join(workspace.normalizedDirectory, name), 'utf8'))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  try {
    const configured = await page.evaluate(async () => {
      const api = window.desktopAPI!
      const directory = await api.localAgent({ operation: 'capabilities', adapter: 'opencode', refresh: true })
      const model = directory.capabilities?.models.find(model => model.id === 'openai/gpt-5.6-luna-fast')
      if (!model) throw new Error('Native Luna Fast unavailable')
      const selected = await api.localAgent({ operation: 'configure', adapter: 'opencode', configuration: { model: model.id, effort: null } })
      const capability = selected.capabilities?.models.find(value => value.id === model.id)
      if (capability?.effort.kind !== 'supported' || !capability.effort.values.includes('medium')) throw new Error('Native Luna medium unavailable')
      return api.localAgent({ operation: 'configure', adapter: 'opencode', configuration: { model: model.id, effort: 'medium' } })
    })
    writeFileSync(join(output, 'configuration.json'), JSON.stringify(configured, null, 2))
    const prompt = `继续原生会话中的原 Builder 候选，定点修复，不重生成四阶段教学稿、不创建/写入工程、不执行 Builder。原模块：${candidate}。请先读取原模块、当前课例四稿（只读）、仓库 .agents/skills/build-courseware-project/SKILL.md 及相关正式能力卡。据真实UI错误（证据截图 ${evidence}/builder-partial.png）：builder-step-1 asset.media.import: [{code:tool-failed,message:素材导入需要 global owner 追加位置}]。这是UI反馈，尚无独立正式receipt文件，不伪造receipt。模块没有先 activateScope 到 global owner，createScope 仍属于 scene。请按正式卡修复这处及相邻同类 scope/回执使用错误，保留教学目标、真实电路图、混合 Surface 和原模块结构；只修改这一个 staging build.mjs，禁止写四稿或任何 h5lesson。每次 activate/execute 后使用新观察/正式返回地址，不能猜测字段。检查当前 asset.media.import、course.navigation、native.content、slide.interaction 卡和 Builder 合同，最后 node --check 校验模块并简短说明。宿主将在人工处理完阶段确认后通过正式受控接口应用；本轮你只交有效候选模块，不以未执行冒充成功构建。`
    const actualPrompt = process.env.R19_MANUAL_REPAIR_PROMPT_FILE ? readFileSync(process.env.R19_MANUAL_REPAIR_PROMPT_FILE, 'utf8') : process.env.R19_MANUAL_REPAIR_PROMPT ?? prompt
    writeFileSync(join(output, 'prompt.txt'), actualPrompt)
    const started = await page.evaluate(({ workspace, sessionId, prompt }) => window.desktopAPI!.localAgent({ operation: 'lesson-resume', workspace, sessionId, prompt }), { workspace, sessionId, prompt: actualPrompt })
    writeFileSync(join(output, 'started.json'), JSON.stringify(started, null, 2))
    expect(started.sessionId).toBeTruthy()
    await expect.poll(async () => {
      const result = await page.evaluate(({ workspace, sessionId }) => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace, sessionId, after: 0 }), { workspace, sessionId: started.sessionId! })
      writeFileSync(join(output, 'native-result.json'), JSON.stringify(result, null, 2))
      return result.records?.[0]?.status
    }, { timeout: 22 * 60_000, intervals: [3000] }).not.toBe('running')
    const result = JSON.parse(readFileSync(join(output, 'native-result.json'), 'utf8'))
    expect(result.records?.[0]?.status).toBe('completed')
    copyFileSync(candidate, join(output, 'after.mjs'))
    expect(readFileSync(candidate, 'utf8')).not.toBe(readFileSync(join(output, 'before.mjs'), 'utf8'))
    execFileSync(process.execPath, ['--check', candidate])
    docs.forEach((name, index) => expect(readFileSync(join(workspace.normalizedDirectory, name), 'utf8')).toBe(before[index]))
    await page.screenshot({ path: join(output, 'completed.png') })
    await testInfo.attach('native-repair-evidence', { body: output, contentType: 'text/plain' })
  } finally { await app.close() }
})
