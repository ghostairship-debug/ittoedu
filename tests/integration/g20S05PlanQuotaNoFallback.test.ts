// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ExecutionConnectionConfiguration } from '../../src/shared/workbench/executionSettings'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

// S05-T07 local half (Owner-approved 2026-09-24): plan connections hit rate-limit and quota
// with local 429/402 fixtures instead of exhausting a real subscription. A configured metered
// API must never receive a request, and no remaining-quota figure may be invented.
const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
const cipher = { isEncryptionAvailable: async () => true, encryptString: async (value: string) => Buffer.from(value), decryptString: async (bytes: Uint8Array) => Buffer.from(bytes).toString() }
const caps: ExecutionConnectionConfiguration['capabilities'] = { tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown' }
const invented = /剩余|余额|remaining|balance/i

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s05-plan-quota-')); directories.push(directory)
  const planAnswers = [429, 402], imageAnswers = [429, 402]
  const wire: string[] = []
  const server = createServer((request, response) => { void (async () => {
    for await (const _chunk of request) { /* consume the real serialized payload */ }
    wire.push(request.url ?? '')
    if (request.url === '/plan/v1/chat/completions') { response.writeHead(planAnswers.shift() ?? 500, { 'Retry-After': '30' }); response.end('{"error":{"message":"plan limit"}}'); return }
    if (request.url?.startsWith('/backend-api/codex/images/')) { response.writeHead(imageAnswers.shift() ?? 500); response.end('{"error":{"message":"subscription limit"}}'); return }
    if (request.url === '/metered/v1/chat/completions') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'metered', model: 'metered-model', choices: [{ index: 0, delta: { role: 'assistant', content: '按量完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    response.writeHead(404); response.end()
  })().catch(() => response.destroy()) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local server')
  const baseURL = `http://127.0.0.1:${address.port}`
  const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'settings'), encryption: cipher })
  const plan = await settings.saveConnection({ apiKey: 'plan-key', connection: { provider: 'fixture-plan', protocol: 'openai-chat', baseURL: `${baseURL}/plan/v1`,
    accountId: 'plan-account', authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: caps } })
  const metered = await settings.saveConnection({ apiKey: 'metered-key', connection: { provider: 'fixture-metered', protocol: 'openai-chat', baseURL: `${baseURL}/metered/v1`,
    accountId: 'metered-account', authKind: 'api-key', billing: { kind: 'metered' }, capabilities: caps } })
  const oauth = await settings.saveConnection({ connection: { provider: 'openai', protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL,
    accountId: 'subscription-account', authKind: 'oauth', billing: { kind: 'subscription' }, capabilities: { ...caps, vision: 'unknown' } } })
  const target = await settings.reserveOAuthLogin(oauth.connection.id, oauth.connection.revision)
  expect(await settings.compareAndSetOAuthCredential(target.credentialRef, 0, { connectionId: target.connectionId, revision: target.revision,
    accountId: 'subscription-account', accessToken: 'subscription-token', refreshToken: 'subscription-refresh', expiresAt: Date.now() + 3600_000 })).toBe(true)
  // The metered API is configured and verified, but the plan connection owns both chosen roles.
  await settings.saveProfile({ roles: { conversation: { connectionId: plan.connection.id, model: 'plan-model' }, vision: null,
    imageGenerate: { connectionId: oauth.connection.id, model: 'gpt-image-2' }, imageEdit: null } })
  return { directory, baseURL, settings, wire, metered }
}

it('S05-T07 a token plan hitting 429 then 402 fails with the exact reason and never switches to the configured metered API', async () => {
  const f = await fixture()
  const desktop = new ExecutionDesktopService({ directory: path.join(f.directory, 'execution'), documents: new DocumentHostService(path.join(f.directory, 'documents')),
    settings: f.settings, authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
  const space = await desktop.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const outcomes = []
  for (const text of ['套餐限流时', '套餐额度不足时']) {
    const conversation = await desktop.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
    const sent = await desktop.operate({ type: 'send', submissionId: randomUUID(), workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: conversation.revision, text, documents: [], attachments: [] }) as ExecutionSendResult
    const run = await desktop.engine.wait(sent.run!.runId)
    expect(run.status).toBe('failed')
    expect(run.input.selection.connection).toMatchObject({ provider: 'fixture-plan', billing: { kind: 'token-plan' } })
    const failure = run.requests.at(-1)!.failure!
    expect(failure.message).not.toMatch(invented)
    outcomes.push({ kind: failure.kind, httpStatus: failure.httpStatus, requests: run.requests.length })
  }
  expect(outcomes).toEqual([{ kind: 'rate-limit', httpStatus: 429, requests: 1 }, { kind: 'quota', httpStatus: 402, requests: 1 }])
  expect(f.wire).toEqual(['/plan/v1/chat/completions', '/plan/v1/chat/completions'])
  expect(JSON.stringify(await f.settings.read())).not.toMatch(invented)
})

it('S05-T07 a subscription OAuth image role hitting 429 then 402 reports rate-limit and quota and never reaches another connection', async () => {
  const f = await fixture()
  const roles = frozenImageRoles(role => f.settings.snapshot(role))
  await roles.beginRun('plan-run')
  const transport: typeof fetch = (input, init) => {
    const endpoint = new URL(String(input))
    if (endpoint.origin !== 'https://chatgpt.com') throw new Error('Unexpected remote image origin')
    return fetch(`${f.baseURL}${endpoint.pathname}`, init)
  }
  const provider = new ChatGPTImageProvider({ fetch: transport, credentialResolver: async connection => {
    const entry = await f.settings.readOAuthCredential(connection.auth.credentialRef)
    if (!entry.credential) throw new Error('Missing frozen credential')
    return { accessToken: entry.credential.accessToken, accountId: entry.credential.accountId }
  } })
  const images = new ImageGenerationService({ directory: path.join(f.directory, 'images'), provider, resolveReference: async () => { throw new Error('unused') } })
  const results = []
  for (const prompt of ['套餐限流时生图', '套餐额度不足时生图']) {
    const job = await images.run({ jobId: randomUUID(), runId: 'plan-run', documentId: 'document-1', operation: 'generate', prompt, selection: roles.selection('plan-run', 'generate') })
    expect(job.status).toBe('failed')
    expect(job.provenance).toMatchObject({ accountId: 'subscription-account', billing: { kind: 'subscription' } })
    expect(JSON.stringify(job)).not.toMatch(invented)
    results.push({ kind: job.failure?.kind, httpStatus: job.failure?.httpStatus })
  }
  expect(results).toEqual([{ kind: 'rate-limit', httpStatus: 429 }, { kind: 'quota', httpStatus: 402 }])
  expect(f.wire).toEqual(['/backend-api/codex/images/generations', '/backend-api/codex/images/generations'])
})
