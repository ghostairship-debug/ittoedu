// Deterministic guard checks only: no Playwright, app/profile, remote access, or model request.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { assertContinuationState, matchContinuationSubmission, prepareContinuationFiles, readContinuationState, verifyProtectedFiles } from './builtin-moon-continuation-20261101.mjs'

const identity = { workspaceId: 'space', conversationId: 'conversation', previousRunId: 'r4' }
const validState = () => ({ workspaceId: 'space', selectedAgentId: 'builtin', titleMatches: 1,
  conversation: { conversationId: 'conversation', lastRunId: 'r4', hasDraft: false, attachmentCount: 0 },
  previousRun: { conversationId: 'conversation', status: 'completed' },
  submissions: [{ submissionId: 'old', state: 'accepted', runId: 'r4' }] })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

test('only the exact completed conversation with no newer user input can continue', () => {
  assert.equal(assertContinuationState(validState(), identity).conversationId, identity.conversationId)
  for (const change of [state => { state.conversation.hasDraft = true }, state => { state.conversation.attachmentCount = 1 },
    state => { state.titleMatches = 2 }, state => { state.conversation.lastRunId = 'newer' },
    state => { state.workspaceId = 'different' }, state => { state.previousRun.status = 'running' }, state => { state.selectedAgentId = 'external' },
    state => { state.submissions.push({ submissionId: 'queued', state: 'queued' }) }]) {
    const state = validState(); change(state); const before = structuredClone(state)
    assert.throws(() => assertContinuationState(state, identity)); assert.deepEqual(state, before)
  }
})

test('a new exact submission is accepted; an old completed run cannot masquerade as the new attempt', () => {
  const baseline = { conversationId: 'conversation', submissionIds: ['old'], runIds: ['r4'] }
  const old = { submissionId: 'old', state: 'accepted', runId: 'r4' }
  assert.equal(matchContinuationSubmission([old], baseline, 'repair', 10000), null)
  const fresh = { submissionId: 'new', conversationId: 'conversation', text: 'repair', createdAt: 10001,
    state: 'accepted', runId: 'new-run' }
  assert.equal(matchContinuationSubmission([old, fresh], baseline, 'repair', 10000).runId, 'new-run')
  for (const patch of [{ text: 'someone else' }, { runId: 'r4' }, { conversationId: 'other' }, { createdAt: 1 }])
    assert.throws(() => matchContinuationSubmission([old, { ...fresh, ...patch }], baseline, 'repair', 10000))
  assert.throws(() => matchContinuationSubmission([fresh, { ...fresh, submissionId: 'third' }], baseline, 'repair', 10000))
})

async function fixture(operation) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'moon-continuation-guard-'))
  try {
    const workspace = path.join(base, 'workspace'), out = path.join(base, 'output')
    await fs.mkdir(workspace); await fs.mkdir(out)
    const names = ['r4.glx', 'r4.html', 'human.glx', 'r8.glx'], protectedFiles = []
    for (const [index, name] of names.entries()) {
      const filename = path.join(workspace, name), bytes = Buffer.from(`known original ${index}`)
      await fs.writeFile(filename, bytes); protectedFiles.push({ path: filename, sha256: hash(bytes) })
    }
    await operation({ ...identity, workspace, sourceGlx: protectedFiles[3].path, protectedFiles,
      newGlx: path.join(workspace, 'improved.glx'), newHtml: path.join(workspace, 'improved.html') }, out)
  } finally { await fs.rm(base, { recursive: true, force: true }) }
}

test('r8 is copied exclusively while all four originals and independent backups retain exact bytes', async () => fixture(async (config, out) => {
  const preserved = await prepareContinuationFiles(config, out)
  assert.deepEqual(await fs.readFile(config.newGlx), await fs.readFile(config.sourceGlx))
  assert.equal(preserved.originals.length, 4)
  for (const item of preserved.originals) assert.equal(hash(await fs.readFile(item.backup)), item.sha256)
  assert.equal((await verifyProtectedFiles(preserved)).unchanged, true)
  await assert.rejects(fs.stat(config.newHtml), { code: 'ENOENT' })
}))

test('existing output or wrong source hash is refused without replacing an artifact', async () => fixture(async (config, out) => {
  await fs.writeFile(config.newGlx, 'prior unfinished attempt')
  await assert.rejects(prepareContinuationFiles(config, out), /already exists/)
  assert.equal(await fs.readFile(config.newGlx, 'utf8'), 'prior unfinished attempt')
  await fs.rm(config.newGlx)
  config.protectedFiles[0].sha256 = '0'.repeat(64)
  await assert.rejects(prepareContinuationFiles(config, out), /changed before continuation/)
  await assert.rejects(fs.stat(config.newGlx), { code: 'ENOENT' })
}))

test('a concurrent original change is detected and preserved for review, never auto-restored', async () => fixture(async (config, out) => {
  const preserved = await prepareContinuationFiles(config, out)
  await fs.writeFile(config.protectedFiles[2].path, 'new human edit')
  const result = await verifyProtectedFiles(preserved)
  assert.equal(result.unchanged, false); assert.equal(result.files[2].unchanged, false)
  assert.equal(await fs.readFile(config.protectedFiles[2].path, 'utf8'), 'new human edit')
  assert.equal(hash(await fs.readFile(preserved.originals[2].backup)), preserved.originals[2].sha256)
}))

test('a protected path cannot be selected as the new output', async () => fixture(async (config, out) => {
  config.newGlx = config.sourceGlx
  await assert.rejects(prepareContinuationFiles(config, out), /replace protected/)
  assert.equal(hash(await fs.readFile(config.sourceGlx)), config.protectedFiles[3].sha256)
}))

async function withPublicReadFixture(operation, failSubmissions = false) {
  const calls = [], saved = [], report = { reads: [] }
  const before = name => {
    const current = saved.at(-1).reads.at(-1)
    assert.equal(current.name, `initial.${name}`); assert.equal(current.status, 'running')
    calls.push(name)
  }
  const api = {
    workspace: async () => { before('workspace'); return { workspace: { workspaceId: 'space' }, conversations: [{
      workspaceId: 'space', conversationId: 'conversation', title: 'Existing', revision: 7,
      inputDraft: '', inputAttachments: [], runIndex: { builtinRunIds: ['r4'] },
    }] } },
    submissions: async () => { before('submissions'); await new Promise(resolve => setTimeout(resolve, 25))
      if (failSubmissions) throw new Error('known recovery failure')
      return [{ submissionId: 'old', state: 'accepted', runId: 'r4' }] },
    run: async () => { before('run'); return { input: { conversationId: 'conversation' }, status: 'completed', usage: 'unrequested-large-usage-body' } },
    acp: async () => { before('acp-status'); return { snapshot: { selectedAgentId: 'builtin' } } },
  }
  const previousWindow = globalThis.window
  globalThis.window = { desktopAPI: { execution: api } }
  try {
    await operation({ page: { evaluate: (callback, input) => callback(input) }, calls, saved, report,
      checkpoint: { report, persist: async () => { saved.push(structuredClone(report)) },
        options: { timeoutMs: 300, originalBudgetMs: 5, heartbeatMs: 5 } } })
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow }
}

test('the same pending recovery read survives the old short budget with phase checkpoints and unchanged identity checks', async () => withPublicReadFixture(async ({ page, calls, saved, report, checkpoint }) => {
  const state = await readContinuationState(page, identity, checkpoint, 'initial')
  assertContinuationState(state, identity)
  assert.deepEqual(calls, ['workspace', 'submissions', 'run', 'acp-status'])
  assert(saved.some(value => value.reads.at(-1).name === 'initial.submissions' && value.reads.at(-1).status === 'waiting-on-original-read-past-eight-seconds'))
  assert(report.reads.every(step => step.status === 'completed' && step.invocationCount === 1))
  assert(!JSON.stringify(report).includes('unrequested-large-usage-body'))
}))

test('a failed recovery read is persisted and prevents every later read without replay', async () => withPublicReadFixture(async ({ page, calls, report, checkpoint }) => {
  await assert.rejects(readContinuationState(page, identity, checkpoint, 'initial'), /known recovery failure/)
  assert.deepEqual(calls, ['workspace', 'submissions'])
  assert.equal(report.reads.at(-1).status, 'failed'); assert.equal(report.reads.at(-1).invocationCount, 1)
}, true))
