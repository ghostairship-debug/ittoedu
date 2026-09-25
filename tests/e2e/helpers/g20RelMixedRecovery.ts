import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ExecutionDesktopAPI, ExecutionSubmissionRecord } from '../../../src/shared/workbench/executionDesktop'
import type { ExecutionRunRecord } from '../../../src/shared/workbench/execution'
import { ExecutionRunStore } from '../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionSubmissionStore } from '../../../src/main/workbench/execution/ExecutionSubmissionStore'

interface RelResumeManifestBase {
  recoveryDirectory: string
  workspacePath: string
  workspaceId: string
  conversationId: string
  runId: string
  originalSubmissionId: string
  requestedTextModel: 'deepseek-flash'
  requestedProvider: 'teamorouter'
  requestedImageModel: 'gpt-image-2'
  createdAt: string
}

/** Old frozen GPT OAuth image runs keep their original route and private profile. */
export interface RelLegacyOAuthResumeManifest extends RelResumeManifestBase {
  schemaVersion: 1
  maxPaidContinuations: 1
  usedPaidContinuations: 0
}

export interface RelTeamoImagesResumeManifest extends RelResumeManifestBase {
  schemaVersion: 2
  maxPaidContinuations: 1
  usedPaidContinuations: 0
  requestedImageProvider: 'teamorouter'
  requestedImageProtocol: 'openai-images'
  imageConnectionId: string
  imageConnectionRevision: number
}

export interface RelResumeManifestV3 extends RelResumeManifestBase {
  schemaVersion: 3
  rootRunId: string
  latestRunId: string
  latestSubmissionId: string
  runIds: string[]
  submissionIds: string[]
  requestedImageProvider: 'teamorouter' | 'openai'
  requestedImageProtocol: 'openai-images' | 'chatgpt-responses'
  imageConnectionId: string
  imageConnectionRevision: number
}

export type RelResumeManifest = RelLegacyOAuthResumeManifest | RelTeamoImagesResumeManifest | RelResumeManifestV3
export const relResumeRunIds = (manifest: RelResumeManifest): string[] => manifest.schemaVersion === 3
  ? [...manifest.runIds] : [manifest.runId]
export const relResumeSubmissionIds = (manifest: RelResumeManifest): string[] => manifest.schemaVersion === 3
  ? [...manifest.submissionIds] : [manifest.originalSubmissionId]

export function advanceRelResumeManifest(previous: RelResumeManifest | null, input: Omit<RelResumeManifestV3,
  'schemaVersion' | 'rootRunId' | 'latestRunId' | 'latestSubmissionId' | 'runIds' | 'submissionIds' | 'runId' | 'originalSubmissionId' | 'createdAt'>
  & { runId: string; submissionId: string }): RelResumeManifestV3 {
  if (previous && (previous.recoveryDirectory !== input.recoveryDirectory || previous.workspacePath !== input.workspacePath
    || previous.workspaceId !== input.workspaceId || previous.conversationId !== input.conversationId
    || previous.requestedTextModel !== input.requestedTextModel || previous.requestedProvider !== input.requestedProvider
    || previous.requestedImageModel !== input.requestedImageModel
    || (previous.schemaVersion === 1 ? input.requestedImageProvider !== 'openai'
      : previous.requestedImageProvider !== input.requestedImageProvider
        || previous.requestedImageProtocol !== input.requestedImageProtocol
        || previous.imageConnectionId !== input.imageConnectionId
        || previous.imageConnectionRevision !== input.imageConnectionRevision)))
    throw new Error('REL resume route or workspace changed')
  const runIds = [...(previous ? relResumeRunIds(previous) : []), input.runId]
  const submissionIds = [...(previous ? relResumeSubmissionIds(previous) : []), input.submissionId]
  if (new Set(runIds).size !== runIds.length || new Set(submissionIds).size !== submissionIds.length)
    throw new Error('REL resume lineage repeats a run or submission')
  return { schemaVersion: 3, recoveryDirectory: input.recoveryDirectory, workspacePath: input.workspacePath,
    workspaceId: input.workspaceId, conversationId: input.conversationId,
    requestedTextModel: input.requestedTextModel, requestedProvider: input.requestedProvider,
    requestedImageModel: input.requestedImageModel, requestedImageProvider: input.requestedImageProvider,
    requestedImageProtocol: input.requestedImageProtocol, imageConnectionId: input.imageConnectionId,
    imageConnectionRevision: input.imageConnectionRevision,
    rootRunId: runIds[0]!, latestRunId: input.runId, runId: input.runId,
    originalSubmissionId: submissionIds[0]!, latestSubmissionId: input.submissionId,
    runIds, submissionIds, createdAt: previous?.createdAt ?? new Date().toISOString() }
}

/** Verify each durable parent and its submission before any paid continuation may be sent. */
export function verifyRelResumeLineage(manifest: RelResumeManifest, runs: readonly ExecutionRunRecord[],
  submissions: readonly ExecutionSubmissionRecord[]): void {
  const runIds = relResumeRunIds(manifest), submissionIds = relResumeSubmissionIds(manifest)
  if (runs.length !== runIds.length) throw new Error('REL resume run lineage is incomplete')
  const source = submissions.find(value => value.submissionId === submissionIds[0])
  if (!source) throw new Error('REL resume root submission is missing')
  for (const [index, run] of runs.entries()) {
    const submission = submissions.find(value => value.submissionId === submissionIds[index])
    if (!submission || run.runId !== runIds[index] || submission.runId !== run.runId
      || run.input.taskId !== submission.submissionId || run.input.conversationId !== manifest.conversationId
      || run.input.workspaceRoot !== manifest.workspacePath || submission.workspaceId !== manifest.workspaceId
      || submission.conversationId !== manifest.conversationId
      || !['partial', 'failed', 'interrupted'].includes(run.status)
      || index > 0 && (run.continuedFrom !== runs[index - 1]!.runId
        || submission.retryOfRunId !== runs[index - 1]!.runId)
      || submission.text !== source.text || JSON.stringify(submission.documents) !== JSON.stringify(source.documents)
      || JSON.stringify(submission.attachments) !== JSON.stringify(source.attachments)
      || submission.permission !== source.permission
      || JSON.stringify(submission.model) !== JSON.stringify(source.model)
      || submission.model.provider !== manifest.requestedProvider
      || submission.model.model !== manifest.requestedTextModel || submission.model.billing !== 'metered'
      || run.input.instruction !== source.text) throw new Error('REL resume durable lineage or frozen task differs')
    const first = runs[0]!, image = run.input.disclosedSettings?.roles.imageGenerate
    if (run.input.selection.model !== manifest.requestedTextModel
      || run.input.selection.connection.provider !== manifest.requestedProvider
      || JSON.stringify(run.input.selection.connection) !== JSON.stringify(first.input.selection.connection)
      || JSON.stringify(run.input.selection.parameters ?? {}) !== JSON.stringify(first.input.selection.parameters ?? {})
      || JSON.stringify(run.input.disclosedSettings) !== JSON.stringify(first.input.disclosedSettings)
      || image?.model !== manifest.requestedImageModel
      || manifest.schemaVersion !== 1 && (image?.connectionId !== manifest.imageConnectionId
        || image?.connectionRevision !== manifest.imageConnectionRevision
        || image?.provider !== manifest.requestedImageProvider))
      throw new Error('REL resume frozen route or parameters differ')
  }
  if (submissions.some(value => value.retryOfRunId === runs.at(-1)!.runId
    && value.submissionId !== submissionIds.at(-1)))
    throw new Error('REL resume leaf already has a child submission; reconcile its send intent before another send')
}

function recoveryRoot(): string {
  const local = process.env.LOCALAPPDATA
  if (process.platform !== 'win32' || !local) throw new Error('REL recovery requires Windows LOCALAPPDATA')
  return resolve(local, 'Guoling-2.0-rel-t11-recovery')
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../') && !isAbsolute(path)
}

function restrictToCurrentUser(directory: string): void {
  const identity = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
  const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0]
  if (!sid) throw new Error('Cannot determine current Windows SID for REL recovery')
  const username = execFileSync('whoami', [], { encoding: 'utf8' }).trim()
  execFileSync('icacls', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { encoding: 'utf8' })
  const acl = execFileSync('icacls', [directory], { encoding: 'utf8' })
  if (!(acl.includes(sid) || acl.toLowerCase().includes(username.toLowerCase()))
    || /(?:Everyone|Authenticated Users|BUILTIN\\Users|所有人|经过身份验证的用户|用户):/i.test(acl))
    throw new Error('REL recovery directory ACL did not restrict access to the current user')
}

/** The profile contains DPAPI protected credentials, so it never lives under repository output. */
export function createRelRecoveryDirectory(): string {
  const root = recoveryRoot()
  mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'session-'))
  try { restrictToCurrentUser(directory) }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
  return directory
}

export function validateRelRecoveryDirectory(directory: string): string {
  const root = realpathSync(recoveryRoot()), selected = realpathSync(resolve(directory))
  if (!inside(root, selected) || !existsSync(selected)) throw new Error('REL recovery path is outside the private recovery root')
  restrictToCurrentUser(selected)
  return selected
}

function validateManifestLocation(filename: string): void {
  const root = realpathSync(resolve(__dirname, '../../..', 'output/g20/rel-t11'))
  const directory = realpathSync(dirname(filename))
  if (basename(filename) !== 'resume.json' || !inside(root, directory))
    throw new Error('REL resume manifest is outside the dedicated evidence directory')
}

export function readRelResumeManifest(filename: string): RelResumeManifest {
  validateManifestLocation(filename)
  const raw: unknown = JSON.parse(readFileSync(filename, 'utf8'))
  if (!raw || typeof raw !== 'object') throw new Error('Invalid REL resume manifest')
  const manifest = raw as Partial<RelResumeManifestBase> & {
    schemaVersion?: unknown; requestedImageProvider?: unknown; requestedImageProtocol?: unknown;
    imageConnectionId?: unknown; imageConnectionRevision?: unknown;
    rootRunId?: unknown; latestRunId?: unknown; latestSubmissionId?: unknown;
    runIds?: unknown; submissionIds?: unknown; maxPaidContinuations?: unknown; usedPaidContinuations?: unknown
  }
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2 && manifest.schemaVersion !== 3
    || typeof manifest.recoveryDirectory !== 'string'
    || typeof manifest.workspacePath !== 'string' || typeof manifest.workspaceId !== 'string' || typeof manifest.conversationId !== 'string'
    || typeof manifest.runId !== 'string' || typeof manifest.originalSubmissionId !== 'string'
    || manifest.requestedTextModel !== 'deepseek-flash' || manifest.requestedProvider !== 'teamorouter'
    || manifest.requestedImageModel !== 'gpt-image-2' || typeof manifest.createdAt !== 'string')
    throw new Error('Invalid REL resume manifest fields')
  if (manifest.schemaVersion !== 3 && (manifest.maxPaidContinuations !== 1 || manifest.usedPaidContinuations !== 0))
    throw new Error('Invalid legacy REL resume manifest fields')
  if (manifest.schemaVersion === 2 && (manifest.requestedImageProvider !== 'teamorouter'
    || manifest.requestedImageProtocol !== 'openai-images' || typeof manifest.imageConnectionId !== 'string'
    || !manifest.imageConnectionId || typeof manifest.imageConnectionRevision !== 'number'
    || !Number.isSafeInteger(manifest.imageConnectionRevision) || manifest.imageConnectionRevision < 1))
    throw new Error('Invalid REL resume image route')
  if (manifest.schemaVersion === 3) {
    const runs = manifest.runIds, submissions = manifest.submissionIds
    if (!Array.isArray(runs) || !Array.isArray(submissions) || !runs.length || runs.length !== submissions.length
      || runs.some(value => typeof value !== 'string' || !value)
      || submissions.some(value => typeof value !== 'string' || !value)
      || new Set(runs).size !== runs.length || new Set(submissions).size !== submissions.length
      || manifest.rootRunId !== runs[0] || manifest.latestRunId !== runs.at(-1)
      || manifest.runId !== manifest.latestRunId || manifest.originalSubmissionId !== submissions[0]
      || manifest.latestSubmissionId !== submissions.at(-1)
      || !((manifest.requestedImageProvider === 'teamorouter' && manifest.requestedImageProtocol === 'openai-images')
        || (manifest.requestedImageProvider === 'openai' && manifest.requestedImageProtocol === 'chatgpt-responses'))
      || typeof manifest.imageConnectionId !== 'string' || !manifest.imageConnectionId
      || !Number.isSafeInteger(manifest.imageConnectionRevision) || Number(manifest.imageConnectionRevision) < 1)
      throw new Error('Invalid REL resume lineage or image route')
  }
  validateRelRecoveryDirectory(manifest.recoveryDirectory)
  if (resolve(manifest.workspacePath) !== resolve(dirname(filename), 'workspace'))
    throw new Error('REL resume workspace does not match the evidence directory')
  return manifest as RelResumeManifest
}

export function writeRelResumeManifest(filename: string, manifest: RelTeamoImagesResumeManifest | RelResumeManifestV3): void {
  validateManifestLocation(filename)
  validateRelRecoveryDirectory(manifest.recoveryDirectory)
  const temporary = `${filename}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx' }); renameSync(temporary, filename) }
  finally { rmSync(temporary, { force: true }) }
}

/** Explicit no-fee recovery after an old one-use manifest was consumed. Never sends or retries. */
export async function rebuildRelResumeManifest(input: { filename: string; recoveryDirectory: string; rootRunId: string }): Promise<RelResumeManifestV3> {
  validateManifestLocation(input.filename)
  const recoveryDirectory = validateRelRecoveryDirectory(input.recoveryDirectory)
  const profile = join(recoveryDirectory, 'profile', 'workbench-v2')
  const allRuns = await new ExecutionRunStore(join(profile, 'runs')).list()
  const allSubmissions = await new ExecutionSubmissionStore(join(profile, 'submissions')).list()
  const root = allRuns.find(run => run.runId === input.rootRunId)
  if (!root) throw new Error('REL root run is missing from the private journal')
  const runs = [root], seen = new Set([root.runId])
  while (true) {
    const children = allRuns.filter(run => run.continuedFrom === runs.at(-1)!.runId)
    if (!children.length) break
    if (children.length !== 1 || seen.has(children[0]!.runId)) throw new Error('REL journal has a fork or cycle')
    runs.push(children[0]!); seen.add(children[0]!.runId)
  }
  const firstSubmission = allSubmissions.find(value => value.submissionId === root.input.taskId)
  const image = root.input.disclosedSettings?.roles.imageGenerate
  const imageProvider = image?.provider === 'openai' ? 'openai' : image?.provider === 'teamorouter' ? 'teamorouter' : null
  if (!firstSubmission || !image || !imageProvider || image.model !== 'gpt-image-2'
    || root.input.selection.model !== 'deepseek-flash' || root.input.selection.connection.provider !== 'teamorouter'
    || imageProvider === 'teamorouter' && root.input.selection.connection.imageProtocol !== 'openai-images')
    throw new Error('REL root route or submission cannot be verified')
  const manifest: RelResumeManifestV3 = { schemaVersion: 3, recoveryDirectory,
    workspacePath: resolve(dirname(input.filename), 'workspace'), workspaceId: firstSubmission.workspaceId,
    conversationId: firstSubmission.conversationId, runId: runs.at(-1)!.runId,
    originalSubmissionId: root.input.taskId, rootRunId: root.runId, latestRunId: runs.at(-1)!.runId,
    latestSubmissionId: runs.at(-1)!.input.taskId, runIds: runs.map(run => run.runId),
    submissionIds: runs.map(run => run.input.taskId), requestedTextModel: 'deepseek-flash',
    requestedProvider: 'teamorouter', requestedImageModel: 'gpt-image-2',
    requestedImageProvider: imageProvider,
    requestedImageProtocol: imageProvider === 'openai' ? 'chatgpt-responses' : 'openai-images',
    imageConnectionId: image.connectionId, imageConnectionRevision: image.connectionRevision,
    createdAt: new Date(root.createdAt).toISOString() }
  verifyRelResumeLineage(manifest, runs, allSubmissions)
  const intents = readdirSync(dirname(input.filename)).filter(name => /^send-intent-.+\.json$/.test(name))
    .map(name => JSON.parse(readFileSync(join(dirname(input.filename), name), 'utf8')) as {
      submissionId?: string; retryOfRunId?: string | null; attempted?: boolean })
  for (const [index, run] of runs.entries()) {
    if (!intents.some(intent => intent.attempted === true && intent.submissionId === run.input.taskId
      && (intent.retryOfRunId ?? null) === (index ? runs[index - 1]!.runId : null)))
      throw new Error('REL journal run lacks its exact send intent')
  }
  if (intents.some(intent => intent.attempted === true && intent.retryOfRunId === runs.at(-1)!.runId
    && !manifest.submissionIds.includes(intent.submissionId ?? '')))
    throw new Error('REL latest send intent has no confirmed run; reconcile its submission before rebuilding')
  writeRelResumeManifest(input.filename, manifest)
  return manifest
}

/** Read every page. A single 500-event page misses late requests in a long run. */
export async function collectRelUsage(events: Pick<ExecutionDesktopAPI, 'events'>, conversationId: string,
  lineageRunIds?: readonly string[]) {
  const usage: unknown[] = []
  const allowed = lineageRunIds ? new Set(lineageRunIds) : null
  let cursor = 0, pages = 0, count = 0
  while (true) {
    const page = await events.events(conversationId, cursor, 500)
    pages++; count += page.events.length
    usage.push(...page.events.filter(event => event.type === 'usage' && (!allowed || allowed.has(event.runId))).map(event => event.data))
    if (!page.hasMore) return { usage, pages, eventCount: count, cursor: page.cursor, complete: true }
    if (page.cursor <= cursor) throw new Error('REL event pagination made no progress')
    cursor = page.cursor
  }
}
