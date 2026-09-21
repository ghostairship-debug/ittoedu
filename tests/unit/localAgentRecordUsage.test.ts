// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
import { readLocalAgentRecordUsage } from '../../src/main/localAgent/localAgentRecordUsage'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { localAgentRecordUsageSchema } from '../../src/shared/localAgentRecordUsage'
import { localAgentRecordV2Schema } from '../../src/shared/localAgentTaskContract'
import type { ConversationOwner } from '../../src/shared/lessonWorkspace'
import { normalizeWorkspacePath, type AiWorkspaceIdentity } from '../../src/shared/workspaceIdentity'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

function scope(owner: ConversationOwner, conversationId: string): AiWorkspaceIdentity {
  if (owner.kind === 'lesson') throw new Error('Directory owner required by this fixture')
  return {
    version: 1,
    kind: 'directory',
    normalizedDirectory: owner.kind === 'workspace' ? owner.workspaceRoot : owner.projectPath,
    conversationId,
  }
}

async function writeRecord(repository: LocalAgentRepository, workspace: AiWorkspaceIdentity) {
  const id = randomUUID()
  await repository.write(localAgentRecordV2Schema.parse({
    version: 3,
    id,
    adapter: 'codex',
    workspace,
    externalSessionId: null,
    workingDirectoryId: id,
    tasks: [],
    observations: [],
    hostResults: [],
    events: [],
  }))
  const staging = await repository.staging(workspace, id)
  await fs.writeFile(path.join(staging, 'trace.bin'), Buffer.alloc(37, 1))
  await repository.writeDisplay(workspace, id, { cleanupIssue: 'x' })
  return id
}

describe('local agent record usage', () => {
  it('refreshes current owner and whole-application bytes while excluding originals, recovery, and CLI preferences', async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-usage-'))
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-usage-workspace-'))
    directories.push(userData, workspaceRoot)
    const normalizedRoot = normalizeWorkspacePath(workspaceRoot)
    const projectPath = normalizeWorkspacePath(path.join(workspaceRoot, 'project'))
    await fs.mkdir(projectPath)
    const owner: ConversationOwner = { kind: 'project', workspaceRoot: normalizedRoot, projectPath }
    const otherOwner: ConversationOwner = { kind: 'workspace', workspaceRoot: normalizedRoot }
    const conversations = new LessonConversationRepository(userData)
    const currentConversation = await conversations.create(owner)
    const otherConversation = await conversations.create(otherOwner)
    const repository = new LocalAgentRepository(userData)
    const currentScope = scope(owner, currentConversation.conversationId)
    const otherScope = scope(otherOwner, otherConversation.conversationId)
    const currentId = await writeRecord(repository, currentScope)
    await writeRecord(repository, otherScope)
    const noticeOnly: AiWorkspaceIdentity = { version: 1, projectId: 'notice-only', normalizedPath: `${projectPath}/copy.h5lesson` }
    await repository.confirmExternalAiNotice(noticeOnly)

    await fs.writeFile(path.join(workspaceRoot, 'course.h5lesson'), Buffer.alloc(8192, 2))
    await fs.mkdir(path.join(userData, 'lesson-document-recovery'), { recursive: true })
    await fs.writeFile(path.join(userData, 'lesson-document-recovery', 'draft.json'), Buffer.alloc(4096, 3))
    await fs.mkdir(path.join(userData, 'local-agent', 'preferences', 'v1'), { recursive: true })
    await fs.writeFile(path.join(userData, 'local-agent', 'preferences', 'v1', 'codex.json'), Buffer.alloc(2048, 4))

    const currentBytes = await repository.storedBytes([currentScope])
    const allBytes = await repository.storedBytes()
    const beforeDamagedMetadata = localAgentRecordUsageSchema.parse(await readLocalAgentRecordUsage(userData, owner))
    const ownerKey = `${owner.workspaceRoot}::${owner.projectPath}`
    const ownerHash = createHash('sha256').update(ownerKey).digest('hex').slice(0, 24)
    const damagedMetadata = path.join(userData, 'project-conversations', 'v1', ownerHash, `${randomUUID()}.json.damaged`)
    await fs.writeFile(damagedMetadata, Buffer.alloc(4096, 6))
    const initial = localAgentRecordUsageSchema.parse(await readLocalAgentRecordUsage(userData, owner))
    expect(initial.currentScopeBytes).toBe(beforeDamagedMetadata.currentScopeBytes)
    expect(initial.applicationBytes).toBe(beforeDamagedMetadata.applicationBytes + 4096)
    expect(initial.currentScopeBytes).toBeGreaterThan(currentBytes)
    expect(initial.applicationBytes).toBeGreaterThan(allBytes)
    expect(initial.currentScopeBytes).toBeGreaterThan(37)
    expect(initial.applicationBytes).toBeGreaterThan(initial.currentScopeBytes)
    expect(initial.applicationBytes).toBeLessThan(8192 + 4096 + 2048)

    await repository.delete(currentScope, currentId)
    await conversations.delete(owner, currentConversation.conversationId, async () => undefined)
    const refreshed = await readLocalAgentRecordUsage(userData, owner)
    expect(refreshed.currentScopeBytes).toBe(0)
    expect(refreshed.applicationBytes).toBeLessThan(initial.applicationBytes)
    expect(refreshed.measuredAt).toBeGreaterThanOrEqual(initial.measuredAt)
  })

  it('does not follow symbolic links out of the application record root', async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-usage-links-'))
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'local-agent-usage-external-'))
    directories.push(userData, external)
    await fs.writeFile(path.join(external, 'original.h5lesson'), Buffer.alloc(16_384, 5))
    const root = path.join(userData, 'local-agent', 'v3')
    await fs.mkdir(root, { recursive: true })
    const link = path.join(root, 'external-link')
    try { await fs.symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')) return
      throw error
    }
    expect(await new LocalAgentRepository(userData).storedBytes()).toBe(0)
  })
})
