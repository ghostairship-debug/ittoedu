import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { LocalAgentRecord } from '../../src/shared/localAgentContract'
import { localAgentMessages } from '../../src/shared/localAgentText'

// Requires existing saved/reopened lesson and RELEASED profile. No fallback fixture.
// Fresh run: two turns, Codex resume (read-only) then NEW OpenCode FileAI.
// Explicit retained-resume evidence skips only that completed turn; one FileAI remains.
// Restart recovery evidence is not native compaction evidence.
const inputSchema = z.object({
  profile: z.string().min(1), workspaceDirectory: z.string().min(1), lessonDirectory: z.string().min(1),
  lessonId: z.uuid(), conversationId: z.uuid(), codexSessionId: z.uuid(), externalSessionId: z.string().min(1),
  projectPath: z.string().min(1), projectId: z.string().min(1), documentPath: z.string().min(1),
  teacherParagraph: z.string().min(1), replaceBefore: z.string().min(1), replaceAfter: z.string().min(1),
  materialQuestion: z.string().min(1), materialAnswer: z.string().min(1),
}).strict()

test('r19 Luna continuation: retained Codex resume then same conversation OpenCode file edit', async ({}, testInfo) => {
  test.skip(process.env.R19_CONTINUATION_LUNA_RUN !== '1', 'Explicit two-turn gate; collection never starts a model')
  test.setTimeout(25 * 60_000)
  expect(process.env.R19_CONTINUATION_PROFILE_RELEASED).toBe('1')
  expect(process.env.R19_CONTINUATION_INPUT).toBeTruthy()
  const input = inputSchema.parse(JSON.parse(readFileSync(process.env.R19_CONTINUATION_INPUT!, 'utf8')))
  for (const path of [input.profile, input.workspaceDirectory, input.lessonDirectory, input.projectPath]) expect(existsSync(path), path).toBe(true)
  const output = testInfo.outputPath('evidence'); mkdirSync(output, { recursive: true })
  const save = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2))
  const scope = { version: 1 as const, kind: 'lesson' as const, lessonId: input.lessonId, normalizedDirectory: input.lessonDirectory, conversationId: input.conversationId }
  const ref = { lessonId: input.lessonId, lessonDirectory: input.lessonDirectory, relativePath: input.documentPath }
  const projectBefore = readFileSync(input.projectPath)
  const app = await electron.launch({ args: ['.', `--user-data-dir=${input.profile}`], cwd: resolve(__dirname, '../..'), env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  try {
    const list = () => page.evaluate(workspace => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace }), scope)
    const read = async (sessionId: string) => {
      let after = 0, record: LocalAgentRecord | undefined
      const events: LocalAgentRecord['events'] = []
      for (;;) {
        const result = await page.evaluate(({ workspace, sessionId, after }) => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace, sessionId, after }), { workspace: scope, sessionId, after })
        record = result.records?.[0]; expect(record).toBeTruthy()
        const incoming = record!.events.filter(event => event.sequence > after); events.push(...incoming)
        if (record!.events.length < 200) break
        expect(incoming.length).toBeGreaterThan(0); after = Math.max(...incoming.map(event => event.sequence))
      }
      return { ...record!, events }
    }
    const before = await list(); save('sessions-before.json', before)
    expect(before.records?.some(record => record.status === 'running'), 'Do not overlap the live automatic task').toBe(false)
    const prior = await read(input.codexSessionId)
    expect(prior.adapter).toBe('codex'); expect(prior.externalSessionId).toBe(input.externalSessionId)
    expect('kind' in prior.workspace, 'Main can resume only a lesson-native record, not a builder/project fallback').toBe(true)
    const lessonResult = await page.evaluate(directory => window.desktopAPI!.lesson!({ operation: 'open-lesson', directory }), input.lessonDirectory)
    const lesson = lessonResult.lesson!; expect(lesson.identity.lessonId).toBe(input.lessonId)
    const otherDocuments = Object.values(lesson.manifest.documents).filter(path => path !== input.documentPath).map(path => ({ path: join(input.lessonDirectory, path), bytes: readFileSync(join(input.lessonDirectory, path)) }))
    const conversation = lessonResult.conversations!.find(item => item.conversationId === input.conversationId)!
    expect(conversation.projectTarget?.projectId).toBe(input.projectId)
    expect(resolve(conversation.projectTarget!.normalizedPath).toLowerCase()).toBe(resolve(input.projectPath).toLowerCase())
    // Refresh both real native catalogs before spending either turn.
    for (const adapter of ['codex', 'opencode'] as const) {
      const directory = await page.evaluate(adapter => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter, refresh: true }), adapter)
      let model = directory.capabilities?.models.find(model => model.id === (adapter === 'codex' ? 'gpt-5.6-luna' : 'openai/gpt-5.6-luna-fast'))
      expect(model, `${adapter} must advertise Luna`).toBeTruthy()
      const tier = model!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
      expect(Boolean(tier) || model!.id.endsWith('luna-fast'), 'This gate requires actual native Fast').toBe(true)
      // ACP exposes effort only for its selected model: select Luna before
      // reading that capability, rather than assuming unknown means unsupported.
      if (adapter === 'opencode' && model!.effort.kind === 'unknown') {
        const selected = await page.evaluate(({ adapter, model }) => window.desktopAPI!.localAgent({ operation: 'configure', adapter, configuration: { model, effort: null } }), { adapter, model: model!.id })
        save('opencode-selected-model-capabilities.json', selected)
        model = selected.capabilities?.models.find(entry => entry.id === model!.id)
        expect(model).toBeTruthy()
      }
      const effort = model!.effort.kind === 'supported' ? (model!.effort.values.includes('medium') ? 'medium' : model!.effort.default ?? model!.effort.values[0]!) : null
      const configuration = { model: model!.id, effort, ...(tier ? { serviceTier: tier.id } : {}) }
      const configured = await page.evaluate(({ adapter, configuration }) => window.desktopAPI!.localAgent({ operation: 'configure', adapter, configuration }), { adapter, configuration })
      expect(configured.enabled).toBe(true); save(`${adapter}-native-route.json`, { directory, configuration, configured })
    }
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, input.workspaceDirectory)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, input.lessonDirectory)
    await page.getByRole('button', { name: '打开课例', exact: true }).click()
    await page.getByRole('region', { name: '课例对话导航' }).getByRole('button', { name: conversation.title, exact: true }).and(page.locator('[aria-pressed]')).click()
    const files = page.locator('.lesson-workspace-files')
    if (!await files.getByRole('button', { name: basename(input.documentPath), exact: true }).isVisible()) await files.getByRole('button', { name: `▸ ${basename(input.lessonDirectory)}`, exact: true }).click()
    await files.getByRole('button', { name: basename(input.documentPath), exact: true }).click()
    const editor = page.getByRole('region', { name: `教学文档 ${input.documentPath}`, exact: true })
    if (!await editor.locator('.cm-content').isVisible()) await editor.getByRole('button', { name: '源文', exact: true }).click()
    const disk = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
    const retainedResume = process.env.R19_CONTINUATION_COMPLETED_RESUME
    if (retainedResume) expect(disk.source.split(input.teacherParagraph)).toHaveLength(2)
    else expect(disk.source).not.toContain(input.teacherParagraph)
    expect(disk.source.split(input.replaceBefore)).toHaveLength(2)
    expect(input.replaceBefore).not.toBe(input.replaceAfter)
    if (!retainedResume) {
    await editor.locator('.cm-content').click(); await editor.locator('.cm-content').press('Control+End')
    await page.keyboard.insertText(`\n\n${input.teacherParagraph}\n`)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)).source).toBe(`${disk.source}\n\n${input.teacherParagraph}\n`)
    }
    const current = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
    const recordsBefore = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readAiRecords(ref), ref)
    const startedAt = Date.now()
    // Production resume RPC: the external session identity must survive, no fallback.
    const resumed = retainedResume ? { sessionId: retainedResume } : await page.evaluate(({ workspace, sessionId, prompt }) => window.desktopAPI!.localAgent({ operation: 'lesson-resume', workspace, sessionId, prompt }), { workspace: scope, sessionId: input.codexSessionId,
      prompt: `只读核对重启后的当前事实，不写文件，不继续生成或重放旧任务。读取当前 ${input.documentPath}，逐字引用末段教师刚保存的内容；回答材料问题：${input.materialQuestion}；读取当前课件并报告真实 projectId 与标题。只报告本轮实际读取结果。` })
    expect(resumed.sessionId).toBeTruthy()
    await expect.poll(async () => (await read(resumed.sessionId!)).status, { timeout: 10 * 60_000, intervals: [2000] }).toBe('completed')
    const resumedRecord = await read(resumed.sessionId!)
    save('actual-native-resume.json', { startedAt, finishedAt: Date.now(), retainedResume: retainedResume ?? null, prior, resumedRecord })
    expect(resumedRecord.externalSessionId).toBe(input.externalSessionId)
    const answer = localAgentMessages(resumedRecord.events).filter(message => message.role === 'assistant').map(message => message.text).join('\n')
    expect(answer).toContain(input.teacherParagraph); expect(answer).toContain(input.materialAnswer); expect(answer).toContain(input.projectId)
    expect((await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)).source).toBe(current.source)
    expect(await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readAiRecords(ref), ref)).toEqual(recordsBefore)
    const afterResume = await list()
    const chat = page.getByRole('complementary', { name: '课例创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption('opencode')
    await chat.getByRole('button', { name: '编辑当前文档', exact: true }).click()
    await chat.getByRole('textbox', { name: '给创作助手的消息', exact: true }).fill(`${process.env.R19_CONTINUATION_REPAIR_REASON ?? ''}只对当前文档进行一处精确修改：把唯一的“${input.replaceBefore}”替换为“${input.replaceAfter}”。其他字符全部保留，包括末段教师手改。不要重放历史任务，不改课件或其他文件。读取本轮baseline和request后生成有效非空候选，由宿主保存。`)
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readAiRecords(ref), ref)).length, { timeout: 10 * 60_000, intervals: [2000] }).toBe(recordsBefore.length + 1)
    const final = await page.evaluate(ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
    expect(final.source).toBe(current.source.replace(input.replaceBefore, input.replaceAfter))
    const sessions = await list()
    const added = sessions.records!.filter(record => !afterResume.records!.some(old => old.id === record.id))
    expect(added).toHaveLength(1); expect(added[0]!.adapter).toBe('opencode')
    const fileRecord = await read(added[0]!.id)
    expect(fileRecord.externalSessionId).toBeTruthy(); expect(fileRecord.externalSessionId).not.toBe(input.externalSessionId)
    expect(fileRecord.lessonWorkspace ?? fileRecord.workspace).toEqual(scope)
    expect(readFileSync(input.projectPath)).toEqual(projectBefore)
    for (const document of otherDocuments) expect(readFileSync(document.path), document.path).toEqual(document.bytes)
    save('file-ai-new-session.json', { fileRecord, before: current, final, records: await page.evaluate(ref => window.desktopAPI!.lessonFiles!.readAiRecords(ref), ref) })
    await page.screenshot({ path: join(output, 'same-conversation-file-edit.png') })
    await testInfo.attach('restart-continuation-evidence', { body: output, contentType: 'text/plain' })
  } finally { await app.close() }
})
