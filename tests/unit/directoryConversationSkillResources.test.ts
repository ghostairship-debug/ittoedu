// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { courseAgentAvailableSkills } from '../../src/shared/courseAgentSkills'
import { directoryConversationSkillPrompt, prepareDirectoryConversationSkills } from '../../src/main/localAgent/directoryConversationSkillResources'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
import { normalizeWorkspacePath } from '../../src/shared/workspaceIdentity'

const fake = vi.hoisted(() => ({
  userData: '', starts: [] as unknown[][], resumes: [] as unknown[][], records: [] as any[],
}))

vi.mock('electron', () => ({ app: { getPath: () => fake.userData }, session: { defaultSession: { resolveProxy: vi.fn() } } }))
vi.mock('../../src/main/localAgent/harness', () => ({ LocalAgentHarness: class {
  async start(...args: unknown[]) { fake.starts.push(args); return randomUUID() }
  async resume(...args: unknown[]) { fake.resumes.push(args); return randomUUID() }
  async list() { return { records: fake.records, damaged: [] } }
  async cancel() {}
  async close() {}
} }))
vi.mock('../../src/main/localAgent/nativeProxy', () => ({ configureNativeSystemProxy: vi.fn() }))
vi.mock('../../src/main/lessonDocumentDesktopService', () => ({ lessonDocumentFiles: vi.fn() }))
vi.mock('../../src/main/lessonAuthoring', () => ({ LessonAuthoring: class {} }))
vi.mock('../../src/main/lessonMaterials', () => ({ LessonMaterials: class {} }))
vi.mock('../../src/main/localAgent/lessonGenerationContext', () => ({ readLessonGenerationContext: vi.fn() }))
vi.mock('../../src/main/projectFileObservation', () => ({ projectFileStatus: vi.fn() }))

beforeEach(async () => {
  vi.resetModules()
  fake.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'directory-courseware-skills-'))
  fake.starts = []; fake.resumes = []; fake.records = []
})
afterEach(async () => { await fs.rm(fake.userData, { recursive: true, force: true }) })

describe('directory conversation built-in Skills', () => {
  it('publishes a complete, versioned application resource without a personal Skill install', async () => {
    const first = await prepareDirectoryConversationSkills(fake.userData)
    const second = await prepareDirectoryConversationSkills(fake.userData)
    expect(second).toEqual(first)
    expect(first.root).toContain(path.join('local-agent', 'directory-conversation-skills', first.semanticVersion))
    expect(first.root).not.toContain('.codex')
    for (const skill of courseAgentAvailableSkills) {
      expect(first.paths[skill.name]).toBe(path.join(first.root, 'skills', skill.name, 'SKILL.md'))
      expect(await fs.readFile(first.paths[skill.name], 'utf8')).not.toHaveLength(0)
    }
    expect(await fs.readFile(path.join(first.root, 'skills', 'build-courseware-project', 'references', 'validation-boundaries.md'), 'utf8'))
      .toContain('自动化最多 `engineering candidate`')
    await fs.writeFile(first.paths['courseware-session'], 'damaged')
    await expect(prepareDirectoryConversationSkills(fake.userData)).rejects.toThrow('当前版本不一致')
  })

  it('routes directory starts and resumes through the versioned methods while preserving the raw user message', async () => {
    const workspaceRoot = path.join(fake.userData, 'ordinary-workspace')
    await fs.mkdir(workspaceRoot)
    const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceRoot)
    const conversations = new LessonConversationRepository(fake.userData)
    const conversation = await conversations.create({ kind: 'workspace', workspaceRoot: normalizedWorkspaceRoot }, '普通目录讨论')
    const workspace = { version: 1 as const, kind: 'directory' as const, normalizedDirectory: normalizedWorkspaceRoot, conversationId: conversation.conversationId }
    const service = await import('../../src/main/localAgent/service')

    await service.operateLocalAgent({ operation: 'lesson-start', workspace, adapter: 'codex', intent: 'discuss', prompt: '根据材料设计一节课' })
    const startPrompt = fake.starts[0]![2] as string
    expect(startPrompt).toContain('根据材料设计一节课')
    expect(startPrompt).toContain('courseware-session')
    expect(startPrompt).toContain(path.join(fake.userData, 'local-agent', 'directory-conversation-skills'))
    expect(startPrompt).not.toContain('.codex')
    expect(startPrompt).toContain('不强制读取 courseware-session')
    expect(startPrompt).toContain('普通 Markdown 的局部改字、改写或选区修订无需读取课件方法')

    const priorSessionId = randomUUID()
    fake.records = [{ id: priorSessionId, workspace, externalSessionId: 'native-session' }]
    await service.operateLocalAgent({ operation: 'lesson-resume', workspace, sessionId: priorSessionId, prompt: '继续，并检查互动路径' })
    const resumePrompt = fake.resumes[0]![2] as string
    expect(resumePrompt).toContain('继续，并检查互动路径')
    expect(resumePrompt).toContain('build-courseware-project')
    expect(resumePrompt).toContain('软件内普通任务默认持续推进')
  })
})
