import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ConversationOwner } from '../../shared/lessonWorkspace'
import { conversationWorkingDirectory } from '../../shared/lessonWorkspace'
import { localAgentRecordUsageSchema, type LocalAgentRecordUsage } from '../../shared/localAgentRecordUsage'
import type { AiWorkspaceIdentity } from '../../shared/workspaceIdentity'
import { LessonConversationRepository } from './lessonConversationRepository'
import { LocalAgentRepository } from './repository'

function conversationScope(owner: ConversationOwner, conversationId: string): AiWorkspaceIdentity {
  return owner.kind === 'lesson'
    ? {
        version: 1,
        kind: 'lesson',
        lessonId: owner.lesson.lessonId,
        normalizedDirectory: owner.lesson.normalizedDirectory,
        conversationId,
      }
    : {
        version: 1,
        kind: 'directory',
        normalizedDirectory: conversationWorkingDirectory(owner),
        conversationId,
      }
}

const conversationLeaves = ['lesson-conversations', 'workspace-conversations', 'project-conversations'] as const
const ownerConversationDirectory = (userData: string, owner: ConversationOwner): string => {
  if (owner.kind === 'lesson') return path.join(userData, 'lesson-conversations', 'v1', owner.lesson.lessonId)
  const key = owner.kind === 'workspace' ? owner.workspaceRoot : owner.workspaceRoot + '::' + owner.projectPath
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24)
  return path.join(userData, owner.kind === 'workspace' ? 'workspace-conversations' : 'project-conversations', 'v1', hash)
}
const isOwnerDeletableConversationMetadata = (name: string): boolean => {
  const id = name.replace(/\.json$/, '')
  return name.endsWith('.json') && z.uuid().safeParse(id).success
}
async function bytesOfPath(target: string, root: string): Promise<number> {
  const resolved = path.resolve(target), resolvedRoot = path.resolve(root)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) throw new Error('Record usage path escaped its root')
  let stat
  try { stat = await fs.lstat(resolved) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
  if (stat.isSymbolicLink()) return 0
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  let total = 0
  for (const name of await fs.readdir(resolved)) total += await bytesOfPath(path.join(resolved, name), resolvedRoot)
  return total
}
async function conversationMetadataBytes(userData: string, owner?: ConversationOwner): Promise<number> {
  const root = path.resolve(userData)
  const directories = owner ? [ownerConversationDirectory(userData, owner)] : conversationLeaves.map(leaf => path.join(userData, leaf, 'v1'))
  let total = 0
  for (const directory of directories) {
    const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    if (owner) {
      for (const name of names.filter(isOwnerDeletableConversationMetadata)) total += await bytesOfPath(path.join(directory, name), root)
      continue
    }
    total += await bytesOfPath(directory, root)
  }
  return total
}
async function conversationIndexBytes(userData: string): Promise<number> {
  return bytesOfPath(path.join(userData, 'conversation-index-v1.json'), userData)
}

/** Fresh read for the navigation usage label; this function keeps no cache. */
export async function readLocalAgentRecordUsage(
  userData: string,
  owner: ConversationOwner,
): Promise<LocalAgentRecordUsage> {
  const conversations = new LessonConversationRepository(userData)
  const repository = new LocalAgentRepository(userData)
  const records = (await conversations.list(owner)).records
  const scopes = records.map(record => conversationScope(owner, record.conversationId))
  const currentScopeBytes = await repository.storedBytes(scopes) + await conversationMetadataBytes(userData, owner)
  const applicationBytes = await repository.storedBytes() + await conversationMetadataBytes(userData) + await conversationIndexBytes(userData)
  return localAgentRecordUsageSchema.parse({ version: 1, currentScopeBytes, applicationBytes, measuredAt: Date.now() })
}
