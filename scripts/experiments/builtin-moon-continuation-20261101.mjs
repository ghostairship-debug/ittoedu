import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { bounded } from './builtin-moon-cleanup-recovery-20261101.mjs'
import { observeReadOperation } from './builtin-moon-readiness-probe-20261101.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const key = filename => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)

// Only the normal UI sends. These helpers validate identity and preserve the prior artifacts.
export function assertContinuationState(state, continuation) {
  assert.equal(state.workspaceId, continuation.workspaceId, 'The existing workspace identity changed; no message was sent.')
  assert.equal(state.selectedAgentId, 'builtin', 'This conversation must use the built-in AI; no external Agent may receive the request.')
  const conversation = state.conversation
  assert(conversation && conversation.conversationId === continuation.conversationId, 'The original conversation is unavailable.')
  assert.equal(state.titleMatches, 1, 'The UI conversation title is ambiguous; do not select another conversation.')
  assert.equal(conversation.lastRunId, continuation.previousRunId, 'The conversation advanced after the recorded run; inspect it before sending.')
  assert.equal(state.previousRun?.conversationId, continuation.conversationId)
  assert.equal(state.previousRun?.status, 'completed', 'Only the completed original candidate may be continued by this experiment.')
  assert.equal(conversation.hasDraft, false, 'An existing user draft must be preserved.')
  assert.equal(conversation.attachmentCount, 0, 'Existing unsent attachments must be preserved.')
  assert(!state.submissions.some(item => !['accepted', 'failed', 'cancelled'].includes(item.state)), 'An unsettled submission already exists; do not send another.')
  return conversation
}

export async function readContinuationState(page, continuation, checkpoint, phase) {
  assert(checkpoint?.report && typeof checkpoint.persist === 'function', 'A persistent readiness checkpoint is required.')
  const read = (name, operation) => observeReadOperation(checkpoint.report, checkpoint.persist, `${phase}.${name}`, operation, checkpoint.options)
  const workspace = await read('workspace', () => page.evaluate(async input => {
    const workspace = await window.desktopAPI.execution.workspace(input.workspace)
    const current = workspace.conversations.find(item => item.conversationId === input.conversationId)
    const title = current?.title || '新会话'
    return { workspaceId: workspace.workspace.workspaceId,
      titleMatches: workspace.conversations.filter(item => (item.title || '新会话') === title).length,
      conversation: current ? { conversationId: current.conversationId, title, revision: current.revision,
        lastRunId: current.runIndex.builtinRunIds.at(-1), runIds: current.runIndex.builtinRunIds,
        hasDraft: Boolean(current.inputDraft), attachmentCount: current.inputAttachments.length } : null }
  }, continuation))
  const submissions = await read('submissions', () => page.evaluate(async input => {
    const records = await window.desktopAPI.execution.submissions({ workspaceId: input.workspaceId, conversationId: input.conversationId })
    return records.map(item => ({ submissionId: item.submissionId, state: item.state, runId: item.runId }))
  }, continuation))
  const previousRun = await read('run', () => page.evaluate(async input => {
    const previous = await window.desktopAPI.execution.run(input.previousRunId)
    return previous ? { conversationId: previous.input.conversationId, status: previous.status } : null
  }, continuation))
  const agent = await read('acp-status', () => page.evaluate(async input => {
    const state = await window.desktopAPI.execution.acp({ action: 'status', workspaceId: input.workspaceId, conversationId: input.conversationId })
    return { selectedAgentId: state.snapshot.selectedAgentId }
  }, continuation))
  return { ...workspace, selectedAgentId: agent.selectedAgentId, previousRun, submissions }
}

export async function selectContinuation(page, continuation, checkpoint) {
  const initial = await readContinuationState(page, continuation, checkpoint, 'initial')
  const target = assertContinuationState(initial, continuation)
  checkpoint.report.currentStage = 'select-exact-conversation-ui'; await checkpoint.persist()
  const navigation = page.getByRole('navigation', { name: '工作空间会话', exact: true })
  const button = navigation.getByRole('button', { name: target.title, exact: true })
  await button.waitFor({ state: 'visible', timeout: 10000 })
  assert.equal(await button.count(), 1)
  await button.click({ timeout: 10000 })
  await page.waitForFunction(title => [...document.querySelectorAll('nav[aria-label="工作空间会话"] button')]
    .some(node => node.getAttribute('aria-label') === title && node.getAttribute('aria-current') === 'page'), target.title, { timeout: 10000 })
  const agent = page.getByLabel('选择 Agent', { exact: true })
  await agent.waitFor({ state: 'visible', timeout: 10000 })
  assert.equal(await agent.inputValue(), 'builtin', 'The selected conversation must use the built-in AI; never switch or prompt an external Agent.')
  assert.equal(await page.getByRole('textbox', { name: '给果铃AI发消息', exact: true }).inputValue(), '', 'The visible composer already contains a draft.')
  const confirmed = await readContinuationState(page, continuation, checkpoint, 'confirmed')
  assertContinuationState(confirmed, continuation)
  return { conversationId: target.conversationId, title: target.title, revision: confirmed.conversation.revision,
    runIds: confirmed.conversation.runIds, submissionIds: confirmed.submissions.map(item => item.submissionId) }
}

export function matchContinuationSubmission(items, baseline, prompt, sentAt) {
  const fresh = items.filter(item => !baseline.submissionIds.includes(item.submissionId))
  assert(fresh.length <= 1, 'Another submission appeared in this conversation; inspect the public records without sending again.')
  const item = fresh[0]
  if (!item) return null
  assert.equal(item.text, prompt, 'The new submission does not belong to this experiment.')
  assert.equal(item.conversationId, baseline.conversationId)
  assert(item.createdAt >= sentAt - 1000, 'The observed submission predates the one-shot UI click.')
  assert(!item.runId || !baseline.runIds.includes(item.runId), 'The previous completed run cannot stand in for this continuation.')
  return { submissionId: item.submissionId, state: item.state, runId: item.runId,
    createdAt: item.createdAt, updatedAt: item.updatedAt,
    ...(item.failure ? { failure: { code: item.failure.code } } : {}) }
}

export async function findContinuationSubmission(page, continuation, baseline, prompt, sentAt) {
  const items = await bounded('Read continuation submission acknowledgement without resending', () => page.evaluate(async identity => {
    const records = await window.desktopAPI.execution.submissions(identity)
    return records.map(item => ({ submissionId: item.submissionId, conversationId: item.conversationId,
      state: item.state, runId: item.runId, text: item.text, createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(item.failure ? { failure: { code: item.failure.code } } : {}) }))
  }, { workspaceId: continuation.workspaceId, conversationId: continuation.conversationId }))
  return matchContinuationSubmission(items, baseline, prompt, sentAt)
}

async function absent(filename) {
  try { await fs.lstat(filename) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  throw new Error(`The new output already exists; preserve it and inspect the prior attempt: ${filename}`)
}

export async function prepareContinuationFiles(continuation, out) {
  for (const field of ['workspace', 'sourceGlx', 'newGlx', 'newHtml']) assert(path.isAbsolute(continuation[field]), `continuation.${field} must be absolute.`)
  assert.equal(key(path.dirname(continuation.newGlx)), key(continuation.workspace))
  assert.equal(key(path.dirname(continuation.newHtml)), key(continuation.workspace))
  assert(/\.glx$/i.test(continuation.newGlx) && /\.html$/i.test(continuation.newHtml))
  assert(continuation.protectedFiles?.length >= 2, 'The original GLX/HTML and any human copy must be listed for preservation.')
  const protectedKeys = continuation.protectedFiles.map(item => key(item.path))
  assert.equal(new Set(protectedKeys).size, protectedKeys.length)
  assert(protectedKeys.includes(key(continuation.sourceGlx)), 'The source GLX must be protected.')
  assert(!protectedKeys.includes(key(continuation.newGlx)) && !protectedKeys.includes(key(continuation.newHtml)), 'New outputs must never replace protected files.')
  await absent(continuation.newGlx); await absent(continuation.newHtml)
  const backupDirectory = path.join(out, 'preserved-originals')
  await fs.mkdir(backupDirectory)
  const records = []
  let sourceBytes
  for (const [index, item] of continuation.protectedFiles.entries()) {
    assert(path.isAbsolute(item.path) && /^[a-f0-9]{64}$/i.test(item.sha256), 'Each protected file needs its known SHA256 and absolute path.')
    const bytes = await fs.readFile(item.path), actual = sha256(bytes)
    assert.equal(actual, item.sha256.toLowerCase(), `The protected artifact changed before continuation: ${item.path}`)
    const backup = path.join(backupDirectory, `${index + 1}-${path.basename(item.path)}`)
    await fs.writeFile(backup, bytes, { flag: 'wx' })
    records.push({ path: item.path, sha256: actual, bytes: bytes.length, backup })
    if (key(item.path) === key(continuation.sourceGlx)) sourceBytes = bytes
  }
  assert(sourceBytes)
  await fs.writeFile(continuation.newGlx, sourceBytes, { flag: 'wx' })
  return { originals: records, workingCopy: { path: continuation.newGlx, sha256: sha256(sourceBytes), bytes: sourceBytes.length } }
}

export async function verifyProtectedFiles(preservation) {
  const files = []
  for (const item of preservation.originals) {
    try { const actual = sha256(await fs.readFile(item.path)); files.push({ path: item.path, expected: item.sha256, actual, unchanged: actual === item.sha256 }) }
    catch (error) { files.push({ path: item.path, expected: item.sha256, unchanged: false, error: error.code ?? error.name }) }
  }
  return { unchanged: files.every(item => item.unchanged), files }
}
