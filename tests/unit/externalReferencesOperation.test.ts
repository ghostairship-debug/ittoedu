// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LessonConversationRepository } from '../../src/main/localAgent/lessonConversationRepository'
import { generationExternalReferences } from '../../src/shared/externalAiReferences'
import { generationRequestSchema } from '../../src/shared/generationContract'
import { normalizeWorkspacePath } from '../../src/shared/workspaceIdentity'

const DOCUMENT_BODY = '教学重点：电流形成闭合回路，先画电路再解释'
const MATERIAL_FRAGMENT = '材料片段：学生先画电路再解释'
const fake = vi.hoisted(() => ({ userData: '', lessonId: '', directory: '', view: {} as Record<string, unknown>,
  bodies: {} as Record<string, string>, versions: {} as Record<string, unknown>, receipt: {} as Record<string, unknown> }))
vi.mock('electron', () => ({ app: { getPath: () => fake.userData }, session: { defaultSession: { resolveProxy: vi.fn() } } }))
vi.mock('../../src/main/localAgent/nativeProxy', () => ({ configureNativeSystemProxy: vi.fn() }))
vi.mock('../../src/main/lessonWorkspace', () => ({ LessonWorkspaceService: class {
  async read() { return { identity: { schemaVersion: 1, lessonId: fake.lessonId, normalizedDirectory: fake.directory }, manifest: { documents: {} } } } } }))
vi.mock('../../src/main/lessonAuthoring', () => ({ LessonAuthoring: class {
  async read() { return fake.view }
  async validateBuild() { return { allowed: true, issues: [] } } } }))
vi.mock('../../src/main/lessonMaterials', () => ({ LessonMaterials: class {
  async list() { return [{ id: 'material-1', assets: [{ id: 'asset-1', path: 'materials/asset-1.png' }] }] }
  async read() { return fake.receipt } } }))
vi.mock('../../src/main/lessonDocumentDesktopService', () => ({ lessonDocumentFiles: () => ({ openDocument: async (ref: { relativePath: string }) => ({ ref,
  source: fake.bodies[ref.relativePath] ?? '', version: fake.versions[ref.relativePath], diagnostics: [] }) }) }))

const directory = 'c:/courses/a.h5lesson'
const lesson = () => ({ schemaVersion: 1 as const, lessonId: fake.lessonId, normalizedDirectory: directory })

function request() {
  return generationRequestSchema.parse({ version: 1, requestId: randomUUID(),
    workspace: { version: 1, projectId: 'generation-project', normalizedPath: normalizeWorkspacePath(directory) },
    documentRevision: 0, sessionGeneration: 1, purpose: 'single-page', instruction: '把第 3 页标题改短',
    context: { title: '示例' }, allowedCarriers: ['native'],
    destinations: [{ kind: 'create', scope: { projectId: 'generation-project', documentRevision: 0, sessionGeneration: 1, revisionPolicy: { kind: 'exact' },
      surfaceType: 'slide', surfaceId: 'surface', locationId: 'location', stateId: null, owner: 'scene', ownerKey: 'scene:scene',
      parent: { kind: 'owner' }, insertion: { kind: 'append' } } }] })
}

beforeEach(async () => {
  fake.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'external-references-'))
  fake.lessonId = randomUUID()
  fake.directory = directory
  fake.bodies = { '01-teaching-plan.md': `# 教学策划\n${DOCUMENT_BODY}` }
  fake.versions = { '01-teaching-plan.md': { contentVersion: 'plan-1', attachments: [] } }
  fake.view = { currentStage: 'presentation-script', issues: [], state: { schemaVersion: 1, lessonId: fake.lessonId, mode: 'manual', epoch: 7, controlEpoch: 0, documents: {},
    materials: [{ id: 'material-1', extractionVersion: 'extraction-1', fragmentIds: ['fragment-1'], sourceVersion: 'source-1' }] },
  documents: [{ role: 'teaching-plan', relativePath: '01-teaching-plan.md', status: 'confirmed', version: fake.versions['01-teaching-plan.md'] }] }
  fake.receipt = { materialId: 'material-1', sourceVersion: 'source-1', extractionVersion: 'extraction-1', readAt: 1,
    fragments: [{ id: 'fragment-1', kind: 'text', text: MATERIAL_FRAGMENT, locator: { part: '正文' } }],
    assets: [{ id: 'asset-1', mime: 'image/png', bytes: Buffer.from('material-original') }] }
})
afterEach(async () => { await fs.rm(fake.userData, { recursive: true, force: true }) })

describe('Main answers the pre-send explanation', () => {
  it('describes the lesson documents and materials it injects into a generation request', async () => {
    const { operateLocalAgent } = await import('../../src/main/localAgent/service')
    const draft = request()
    // 渲染进程此刻能算出的清单：注入内容缺席，教师看到的描述与真实载荷不一致。
    expect(generationExternalReferences(draft).join('\n')).not.toContain('课例')

    const response = await operateLocalAgent({ operation: 'external-references', scope: { kind: 'generation',
      lessonWorkspace: { version: 1, kind: 'lesson', lessonId: fake.lessonId, normalizedDirectory: directory, conversationId: randomUUID() }, request: draft } })
    expect(response.externalReferences).toContain(`课例：${directory}（全部教学文档全文：01-teaching-plan.md）`)
    expect(response.externalReferences).toContain('课例材料提取片段：material-1（1 个片段）')
    expect(response.externalReferences).toContain('课例材料原件：material-1（1 份 base64 原始字节）')
    expect(response.externalReferences).toContain(`工程：${normalizeWorkspacePath(directory)}（完整可编辑内容）`)
  })

  it('describes the lesson turn a discussion send injects, without a conversation message list', async () => {
    const { operateLocalAgent } = await import('../../src/main/localAgent/service')
    const conversation = await new LessonConversationRepository(fake.userData)
      .create({ kind: 'lesson', lesson: lesson() }, '主讨论', { version: 1, projectId: 'generation-project', normalizedPath: normalizeWorkspacePath(directory) })
    const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: fake.lessonId, normalizedDirectory: directory, conversationId: conversation.conversationId }

    const response = await operateLocalAgent({ operation: 'external-references', scope: { kind: 'conversation', workspace, prompt: '把这一页改成两栏' } })
    expect(response.externalReferences).toContain(`会话目录：${normalizeWorkspacePath(directory)}`)
    expect(response.externalReferences).toContain(`课例：${directory}（全部教学文档全文：01-teaching-plan.md）`)
    expect(response.externalReferences).toContain('课例材料提取片段：material-1（1 个片段）')
  })

  it('refuses an unknown conversation instead of describing another workspace', async () => {
    const { operateLocalAgent } = await import('../../src/main/localAgent/service')
    const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: fake.lessonId, normalizedDirectory: directory, conversationId: randomUUID() }
    await expect(operateLocalAgent({ operation: 'external-references', scope: { kind: 'conversation', workspace, prompt: '继续' } }))
      .rejects.toThrow('当前课例对话不存在，请重新打开')
  })
})
