/** Explicitly invoked Electron fixture. Importing it performs no request or login. */
import assert from 'node:assert/strict'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describeTools } from '../../src/core/tools/ToolCatalog'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { createElectronCredentialEncryption } from '../../src/main/workbench/providers/providerCredentials'
import { modelFetch } from '../../src/main/workbench/providers/modelFetch'
import { serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { AFFINITY_EXPERIMENT_VERSION, affinitySelectionFact, runAffinityExperiment } from '../helpers/w7ProviderAffinityExperiment'
import { assertExperimentNetworkReady } from './experimentOwnerBootstrap20261031.node'
import type { ModelJsonObject, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

export interface W7AffinityConfig {
  profile: string; out: string; phase: 'zero' | 'live'; blocks?: 1 | 2; inputTokenFloor?: number; perRequestTimeoutMs?: number
}
const toolNames = ['project.list', 'project.read', 'project.apply', 'file.save', 'read', 'inspect', 'view.observe',
  'view.click', 'view.input', 'object.insert', 'object.layout', 'interaction.update', 'surface.recipe', 'surface.remix',
  'image.preview', 'artifact.save', 'delegate.agent', 'delegate.message', 'delegate.read', 'delegate.resume', 'job.status', 'job.wait']
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
async function save(filename: string, value: unknown) {
  const temporary = `${filename}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value, null, 2)); await fs.rename(temporary, filename)
}
export function currentCreativeAffinityPayload(selection: ModelSelection): Omit<ModelRequest, 'requestId'> {
  const tools = describeTools(toolNames)
  for (const required of ['project.read', 'project.apply', 'delegate.agent', 'artifact.save']) assert(tools.some(tool => tool.name === required))
  return { selection, sessionAffinity: { key: 'w7-fixed-creative-experiment-body-only' }, tools: tools.map(tool => ({ name: tool.name,
    description: tool.description, inputSchema: tool.schema as ModelJsonObject })), messages: [
    { role: 'system', content: '你正在参与一次固定请求体的传输实验。以下真实果铃工具仅供理解创作上下文，本次不执行任何创作、不调用任何工具，不联网，不改文件。只需确认已读输入，严格输出 READY 五个英文字母。不要解释、总结或输出代码。' },
    { role: 'user', content: '只读背景：果铃正在改进五幕互动作品的创作。正式工程需要能局部选中并改写正文，作者模块保持原相对路径及资源闭包；观察必须来自当前有效状态，保存和冷打开要保留人工内容；独立子任务有可回复身份，同组候选先回读再采用；内部机械装配不能冒充用户交付；交互需在真实消费者验证，进度按本设备隔离恢复。工具目录是当前软件生成的同一组 schema 和说明，本次不判断作品质量，不生成作品。本次唯一要求：回复 READY。' },
  ] }
}

export async function executeW7AffinityExperiment(config: W7AffinityConfig) {
  await app.whenReady()
  const networkBootstrap = assertExperimentNetworkReady()
  assert(path.isAbsolute(config.profile) && path.isAbsolute(config.out), 'W7 requires explicit absolute profile/output paths')
  assert(config.phase === 'zero' || config.phase === 'live', 'W7 phase must be explicit')
  const settingsDirectory = path.join(config.profile, 'workbench-v2', 'settings')
  const outputRelativeToSettings = path.relative(settingsDirectory, config.out)
  assert(outputRelativeToSettings === '..' || outputRelativeToSettings.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelativeToSettings),
    'Experiment output cannot overwrite the credential owner directory')
  await fs.mkdir(config.out, { recursive: true })
  const store = new ExecutionSettingsStore({ directory: settingsDirectory, encryption: await createElectronCredentialEncryption() })
  const profileBefore = (await store.read()).profile, current = await store.snapshot('conversation')
  assert.equal(current.connection.protocol, 'chatgpt-responses')
  const selection = await store.captureDelegationSelection({ connectionId: current.connection.id, model: 'gpt-6.1-terra',
    parameters: { reasoning: { effort: 'xhigh' } } }, current)
  const payload = currentCreativeAffinityPayload(selection), serialized = serializeChatGPTResponsesRequest(payload)
  const payloadSha256 = digest(serialized), payloadBytes = Buffer.byteLength(serialized), inputTokenFloor = config.inputTokenFloor ?? 4096
  // Real usage remains the final eligibility test; byte size alone is not a token estimate or cache guarantee.
  assert(payloadBytes >= 16 * 1024, 'Current creative prefix is too small; do not run a cache comparison on a tiny request')
  const scope = affinitySelectionFact(selection), gatePath = path.join(config.out, 'zero-preflight.json')
  const common = { payload, inputTokenFloor, blocks: config.blocks ?? 1, perRequestTimeoutMs: config.perRequestTimeoutMs ?? 180_000 }
  if (config.phase === 'zero') {
    const wires: Array<{ body: string; headers: Headers }> = []
    const transport: typeof fetch = async (_url, init) => {
      wires.push({ body: String(init?.body), headers: new Headers(init?.headers) })
      const frame = { type: 'response.completed', response: { id: `fixture-${wires.length}`, model: selection.model, status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'READY' }] }],
        usage: { input_tokens: inputTokenFloor + 1024, output_tokens: 1, total_tokens: inputTokenFloor + 1025,
          input_tokens_details: { cached_tokens: inputTokenFloor } } } }
      return new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    const result = await runAffinityExperiment({ ...common, transport,
      credentialResolver: async () => ({ accountId: selection.connection.accountId, accessToken: 'fixture-only-no-real-token' }) })
    assert(result.comparisonEligible && result.complete)
    assert(wires.every(wire => wire.body === serialized))
    const unchanged = (headers: Headers) => [...headers].filter(([key]) => key !== 'session-id')
    wires.forEach((wire, index) => {
      assert.deepEqual(unchanged(wire.headers), unchanged(wires[0]!.headers))
      assert.equal(wire.headers.has('session-id'), ['A', 'B', 'B', 'A'][index % 4] === 'B')
    })
    assert.equal(new Set(wires.filter(wire => wire.headers.has('session-id')).map(wire => wire.headers.get('session-id'))).size, 1)
    assert.deepEqual((await store.read()).profile, profileBefore)
    const gate = { version: AFFINITY_EXPERIMENT_VERSION, status: 'zero-pass', transport: 'injected-sse-no-network', realModelRequests: 0,
      providerCredentialResolver: 'fixture-only; wrapper separately checks owner credential presence without network',
      payloadSha256, payloadBytes, scope, blocks: common.blocks, inputTokenFloor, toolNames: payload.tools!.map(tool => tool.name),
      bodyIdentical: true, candidateHeaderOnly: true, profileUnchanged: true, networkBootstrap, generatedAt: new Date().toISOString() }
    await save(gatePath, gate); return gate
  }
  const gate = JSON.parse(await fs.readFile(gatePath, 'utf8'))
  assert.deepEqual({ version: gate.version, status: gate.status, payloadSha256: gate.payloadSha256, scope: gate.scope, blocks: gate.blocks,
    inputTokenFloor: gate.inputTokenFloor }, { version: AFFINITY_EXPERIMENT_VERSION, status: 'zero-pass', payloadSha256, scope,
    blocks: common.blocks, inputTokenFloor }, 'The exact current selection/payload must pass the zero-network gate first')
  const oauth = new OAuthDesktopService({ store, openExternal: async () => { throw new Error('No login flow in this experiment') } })
  // Same configured dispatcher, proxy and timeout owner as production; no custom route or copied credential.
  const originalTransport = modelFetch()
  const result = await runAffinityExperiment({ ...common, transport: (endpoint, init) => {
    assertExperimentNetworkReady(); return originalTransport(endpoint, init)
  }, credentialResolver: connection => { assertExperimentNetworkReady(); return oauth.resolveCredential(connection) },
    onSample: async (_sample, samples) => save(path.join(config.out, 'samples-checkpoint.json'), { version: AFFINITY_EXPERIMENT_VERSION, samples }) })
  const profileUnchanged = JSON.stringify((await store.read()).profile) === JSON.stringify(profileBefore)
  const report = { ...result, phase: 'live', profileUnchanged, comparisonEligible: result.comparisonEligible && profileUnchanged,
    networkBootstrap: assertExperimentNetworkReady(),
    routeOwner: 'production installSystemProxy(session.defaultSession) + modelFetch; credential resolution via ExecutionSettingsStore + OAuthDesktopService',
    profileRolesChangedByFixture: false, oauthCredentialRefresh: 'existing owner may refresh credentials; no credential values are read by the fixture',
    finishedAt: new Date().toISOString() }
  await save(path.join(config.out, 'result.json'), report)
  assert(profileUnchanged, 'User profile changed during experiment; result is not a matched sample')
  return report
}

export async function installW7AffinityExperiment(config: W7AffinityConfig) {
  await app.whenReady(); app.on('window-all-closed', () => undefined)
  ;(globalThis as { __w7Affinity?: () => Promise<unknown> }).__w7Affinity = () => executeW7AffinityExperiment(config)
}
