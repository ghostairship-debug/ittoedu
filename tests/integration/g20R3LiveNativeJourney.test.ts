// @vitest-environment node
import { expect, it } from 'vitest'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { hasUnresolvedToolFailure } from '../../src/main/workbench/execution/executionOutcome'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import { PodmanComputeBackend, PINNED_PYTHON_IMAGE_ID } from '../../src/main/workbench/compute/PodmanComputeBackend'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import { WebResearchService } from '../../src/main/workbench/network/WebResearchService'
import { DeepSeekSearchProvider } from '../../src/main/workbench/network/DeepSeekSearchProvider'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import bundledSkills from '../../src/shared/generated/bundledSkills.json'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'

/** Opt-in Owner-authorized real inference; fixture success cannot satisfy this test. */
it.skipIf(process.env.GUOLING_R3_REAL_NATIVE !== '1')('delivers a real-model compute report and a sourced research report through the native services', async () => {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('Existing authorized DEEPSEEK_API_KEY is required; no new credentials are requested')
  const continuityOnly = process.env.GUOLING_R3_CONTINUATION === '1'
  const computeOnly = process.env.GUOLING_R3_COMPUTE_ONLY === '1'
  const resumeEvidence = process.env.GUOLING_R3_RESUME_EVIDENCE_ROOT
  const root = path.resolve('output/g20/r3/native-live-' + randomUUID())
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace, { recursive: true })
  const csv = 'month,amount\nJan,20\nFeb,22\nMar,31\n'
  await fs.writeFile(path.join(workspace, 'sales.csv'), csv)
  const key = randomBytes(32)
  const encryption: CredentialEncryptionPort = { isEncryptionAvailable: () => true,
    encryptString(text) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]) },
    decryptString(value) { const bytes = Buffer.from(value), c = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); c.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([c.update(bytes.subarray(28)), c.final()]).toString('utf8') } }
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption })
  const saved = await settings.saveConnection({ apiKey: process.env.DEEPSEEK_API_KEY, connection: {
    provider: 'deepseek', protocol: 'openai-chat', baseURL: 'https://api.deepseek.com', accountId: 'existing-owner-authorized-api', authKind: 'api-key', billing: { kind: 'metered' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
  await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: saved.connection.id, model: 'deepseek-flash', ...(continuityOnly ? { contextWindow: 32000 } : {}) }, vision: null, imageGenerate: null, imageEdit: null } })
  const backend = new PodmanComputeBackend({ distro: 'Ubuntu', image: PINNED_PYTHON_IMAGE_ID })
  expect(await backend.availability()).toEqual({ available: true })
  const compute = new ComputeJobService({ directory: path.join(root, 'jobs'), backend })
  const jobs = new HostJobService({ compute, images: {} as ImageGenerationService })
  const web = new WebResearchService({ searchProvider: new DeepSeekSearchProvider({ selection: () => ({ connection: saved.connection, model: 'deepseek-flash' }), credential: conn => settings.resolveCredential(conn) }) })
  const documents = new DocumentHostService(path.join(root, 'journals'))
  documents.tools.configureHostServices({ compute, jobs, web, skills: new BundledSkillService(bundledSkills), beginRun: async grant => { web.beginRun(grant.runId) }, stopRun: async runId => { await web.stopRun(runId) } })
  const desktop = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings, fetch: async (url, init) => {
    const response = await fetch(url, init)
    if (!response.ok) { const raw = (await response.clone().text()).slice(0, 16000).replaceAll(process.env.DEEPSEEK_API_KEY!, '[redacted]'); await fs.writeFile(path.join(root, 'http-error-sanitized.json'), raw); console.info('Sanitized provider error:', raw) }
    return response
  }, authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }) })
  const { workspace: space } = await desktop.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await desktop.operate({ type: 'create-conversation', workspaceId: space.workspaceId }) as { conversationId: string; revision: number }
  const summaries: unknown[] = []
  if (resumeEvidence) {
    const originals = await new ExecutionRunStore(path.join(path.resolve(resumeEvidence), 'desktop', 'runs')).list()
    const previous = originals.find(run => run.compacted && ['completed', 'partial'].includes(run.status))
    if (!previous) throw new Error('A preserved real research run with compaction is required')
    expect(hasUnresolvedToolFailure(previous)).toBe(false)
    const previousWorkspace = path.join(path.resolve(resumeEvidence), 'workspace')
    const report = await fs.readFile(path.join(previousWorkspace, 'research.md'), 'utf8')
    const originalCsv = await fs.readFile(path.join(previousWorkspace, 'sales.csv'), 'utf8')
    // Resume a copy of the journal. The original failed/partial evidence is retained.
    await new ExecutionRunStore(path.join(root, 'desktop', 'runs')).save(previous)
    const resumed = await desktop.engine.resume(previous.runId, { ...previous.input, workspaceRoot: previousWorkspace,
      selection: await settings.snapshot('conversation') })
    const final = await desktop.engine.wait(resumed.runId)
    const receipt = { label: 'preserved-research-explicit-continuation', previousRoot: resumeEvidence, previousStatus: previous.status,
      status: final.status, failure: final.failure, requests: final.requests.length,
      tools: final.tools.map(tool => ({ name: tool.call.name, result: tool.result })), compactedSource: previous.compacted,
      reportPreserved: (await fs.readFile(path.join(previousWorkspace, 'research.md'), 'utf8')) === report,
      inputPreserved: (await fs.readFile(path.join(previousWorkspace, 'sales.csv'), 'utf8')) === originalCsv }
    await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify(receipt, null, 2))
    console.info(JSON.stringify({ evidence: root, label: receipt.label, status: final.status, requests: final.requests.length,
      tools: final.tools.map(tool => tool.call.name), reportPreserved: receipt.reportPreserved, inputPreserved: receipt.inputPreserved, failure: final.failure }))
    expect(final.status, JSON.stringify(final.failure)).toBe('completed')
    expect(receipt.reportPreserved).toBe(true); expect(receipt.inputPreserved).toBe(true)
    return
  }
  async function runTask(text: string, label: string) {
    const current = await desktop.operate({ type: 'conversation', workspaceId: space.workspaceId, conversationId: conversation.conversationId }) as { revision: number }
    const submitted = await desktop.operate({ type: 'send', workspaceId: space.workspaceId, conversationId: conversation.conversationId,
      submissionId: randomUUID(), expectedRevision: current.revision, text, documents: [], permission: 'workspace' }) as { run: ExecutionRunRecord }
    const started = Date.now()
    const run = await desktop.engine.wait(submitted.run.runId)
    const summary = { label, status: run.status, elapsedMs: Date.now() - started, model: run.input.selection.model, failure: run.failure,
      requestCount: run.requests.length, usage: run.requests.map(r => ({ kind: r.kind, model: r.actualModel, input: r.inputTokens, output: r.outputTokens, status: r.state })),
      tools: run.tools.map(t => ({ name: t.call.name, state: t.state, result: t.result })), files: await fs.readdir(workspace) }
    summaries.push(summary); await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify(summaries, null, 2))
    console.info(JSON.stringify({ evidence: root, label, status: run.status, elapsedMs: Date.now() - started, requests: run.requests.length, tools: run.tools.map(t => t.call.name), files: await fs.readdir(workspace), failure: run.failure }))
    expect(run.status, JSON.stringify(run.failure)).toBe('completed')
    return run
  }
  try {
    if (!continuityOnly) {
    const dataRun = await runTask('读取当前目录 sales.csv，实际计算总金额和各月数值，制作一份简洁可视化 HTML 分析报告并保存。报告应包含真实计算生成的柱状图和结论；实际执行的 Python 脚本、计算结果 JSON、图表和报告关联 CSS 都要在当前目录保存，重开可用。保留原始 CSV。不需要网络和图片生成。', 'compute-report')
    expect(dataRun.tools.some(t => t.call.name === 'compute.run')).toBe(true)
    expect(dataRun.tools.some(t => t.call.name === 'artifact.save')).toBe(true)
    expect(await fs.readFile(path.join(workspace, 'sales.csv'), 'utf8')).toBe(csv)
    const files = await fs.readdir(workspace), reports = files.filter(name => /\.html$/.test(name))
    expect(reports.length).toBeGreaterThan(0)
    for (const extension of ['.py', '.json', '.css']) expect(files.some(name => name.endsWith(extension)), extension).toBe(true)
    for (const name of reports) {
      const html = await fs.readFile(path.join(workspace, name), 'utf8'); expect(html).toMatch(/73/)
      for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
        const value = match[1]!
        if (/^(?:https?:|data:|mailto:|javascript:)/.test(value)) continue
        expect((await fs.stat(path.resolve(workspace, value.split(/[?#]/)[0]!))).isFile(), value).toBe(true)
      }
      expect((await new DocumentHostService(path.join(root, 'reopen-journals')).open(path.join(workspace, name))).model).toMatchObject({ kind: 'text', source: html })
    }
    if (computeOnly) {
      const retained = new Map(await Promise.all(files.filter(name => !name.endsWith('.html')).map(async name => [name, await fs.readFile(path.join(workspace, name), 'utf8')] as const)))
      await runTask('在刚才的 HTML 分析报告末尾增加一句“复核合计：73”，保存报告。沿用已有图表、CSS、计算结果和脚本，不重复计算或改动其他文件。', 'compute-report-revision')
      for (const [name, text] of retained) expect(await fs.readFile(path.join(workspace, name), 'utf8'), name).toBe(text)
      expect(await fs.readFile(path.join(workspace, reports[0]!), 'utf8')).toContain('复核合计')
      const reopened = await new DocumentHostService(path.join(root, 'revised-reopen-journals')).open(path.join(workspace, reports[0]!))
      expect(reopened.model).toMatchObject({ kind: 'text', source: await fs.readFile(path.join(workspace, reports[0]!), 'utf8') })
      return
    }
    }
    const research = await runTask('另外搜索并阅读 Python 官方文档中 CSV 与 JSON 处理的原始说明，写一份简短中文说明，解释本项目这类数据处理应如何保存结构化结果，明确区分文档事实和建议。至少两个官方原始来源，在当前目录保存 research.md 并提供可追溯链接；不要修改前面的成果。', 'research-report')
    expect(research.tools.some(t => t.call.name === 'web.search')).toBe(true)
    expect(research.tools.filter(t => t.call.name === 'web.open').length).toBeGreaterThanOrEqual(2)
    const report = await fs.readFile(path.join(workspace, 'research.md'), 'utf8')
    expect(report).toContain('docs.python.org'); expect(report).toMatch(/csv/i); expect(report).toMatch(/json/i)
    if (continuityOnly) {
      expect(research.compacted, 'Declared 32k host budget must exercise actual compaction, not just a unit stub').toBeDefined()
      const resumed = await desktop.engine.resume(research.runId, research.input)
      const continued = await desktop.engine.wait(resumed.runId)
      const result = { label: 'research-explicit-continuation', status: continued.status, failure: continued.failure, previousCompaction: research.compacted, messages: continued.messages.length, requests: continued.requests.length, tools: continued.tools.map(t => ({ name: t.call.name, result: t.result })) }
      summaries.push(result); console.info(JSON.stringify({ evidence: root, ...result }))
      expect(continued.status, JSON.stringify(continued.failure)).toBe('completed')
      expect(await fs.readFile(path.join(workspace, 'research.md'), 'utf8')).toBe(report)
      expect(await fs.readFile(path.join(workspace, 'sales.csv'), 'utf8')).toBe(csv)
    }
  } finally {
    // Keep test inputs, run receipts and products; never persist a plaintext credential.
    await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify(summaries, null, 2))
  }
}, 600_000)
