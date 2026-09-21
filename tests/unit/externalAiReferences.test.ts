// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readLessonGenerationContext } from '../../src/main/localAgent/lessonGenerationContext'
import { generationInitialRequestForPrompt } from '../../src/main/localAgent/profile'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import { generationExternalReferences, withLessonGenerationContext } from '../../src/shared/externalAiReferences'
import { generationRequestSchema } from '../../src/shared/generationContract'

const DOCUMENT_BODY = '教学重点：电流形成闭合回路，先画电路再解释'
const MATERIAL_FRAGMENT = '材料片段：学生先画电路再解释'
const ASSET_BYTES = 'lesson-material-original-bytes'

/** Real document/material owners are replaced by ports; the expansion under test is the real one. */
function lessonFixture() {
  const lesson = { schemaVersion: 1 as const, lessonId: randomUUID(), normalizedDirectory: 'c:/courses/a.h5lesson' }
  const documents = [
    { role: 'teaching-plan', relativePath: '01-teaching-plan.md', status: 'confirmed', version: { contentVersion: 'plan-1', attachments: [] } },
    { role: 'presentation-script', relativePath: '02-presentation-script.md', status: 'confirmed', version: { contentVersion: 'script-1', attachments: [] } },
  ]
  const bodies: Record<string, string> = {
    '01-teaching-plan.md': `# 教学策划\n${DOCUMENT_BODY}`,
    '02-presentation-script.md': '# 呈现脚本\n第一片段：演示页',
  }
  const deps = {
    workspace: { read: async () => { throw new Error('课例工作空间不参与本轮引用展开') } },
    authoring: {
      read: async () => ({ currentStage: 'presentation-script' as const, issues: [],
        state: { schemaVersion: 1 as const, lessonId: lesson.lessonId, mode: 'manual' as const, epoch: 7, controlEpoch: 0, documents: {},
          materials: [{ id: 'material-1', extractionVersion: 'extraction-1', fragmentIds: ['fragment-1'], sourceVersion: 'source-1' }] },
        documents }),
      validateBuild: async () => ({ allowed: true, issues: [] }),
    },
    files: { openDocument: async (ref: { relativePath: string }) => ({ ref, source: bodies[ref.relativePath] ?? '',
      version: documents.find(item => item.relativePath === ref.relativePath)!.version, diagnostics: [] }) },
    materials: {
      list: async () => [{ id: 'material-1', assets: [{ id: 'asset-1', path: 'materials/asset-1.png' }] }],
      read: async () => ({ materialId: 'material-1', sourceVersion: 'source-1', extractionVersion: 'extraction-1', readAt: 1,
        fragments: [{ id: 'fragment-1', kind: 'text' as const, text: MATERIAL_FRAGMENT, locator: { part: '正文' } }],
        assets: [{ id: 'asset-1', mime: 'image/png', bytes: Buffer.from(ASSET_BYTES) }] }),
    },
  }
  return { lesson, deps: deps as unknown as Parameters<typeof readLessonGenerationContext>[1] }
}

function rendererRequest(lessonDirectory: string, confirmedDocuments?: { teachingPlan: string; presentationScript: string }) {
  const workspace = createWorkspaceIdentity('generation-project', lessonDirectory)
  return generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace, documentRevision: 0, sessionGeneration: 1,
    purpose: confirmedDocuments ? 'whole-course' : 'single-page', instruction: '把第 3 页标题改短', context: { title: '示例' }, allowedCarriers: ['native'],
    ...(confirmedDocuments ? { confirmedDocuments } : {}),
    destinations: [{ kind: 'create', scope: { projectId: workspace.projectId, documentRevision: 0, sessionGeneration: 1, revisionPolicy: { kind: 'exact' },
      surfaceType: 'slide', surfaceId: 'surface', locationId: 'location', stateId: null, owner: 'scene', ownerKey: 'scene:scene',
      parent: { kind: 'owner' }, insertion: { kind: 'append' } } }] })
}

describe('pre-send reference list matches the payload Main actually sends', () => {
  it('names the lesson documents, material fragments and material originals injected after the request was frozen', async () => {
    const { lesson, deps } = lessonFixture()
    const draft = rendererRequest(lesson.normalizedDirectory)
    const current = await readLessonGenerationContext(lesson, deps, false)
    // The renderer freezes a single-page request, so Main alone decides this payload.
    expect(current.confirmedDocuments).toBeUndefined()

    // 修复前的清单：只描述渲染进程自己写进 request 的内容，注入内容一律缺席。
    const draftReferences = generationExternalReferences(draft).join('\n')
    expect(draftReferences).not.toContain(DOCUMENT_BODY)
    expect(draftReferences).not.toContain('material-1')
    expect(draftReferences).not.toContain('课例')

    const finalRequest = withLessonGenerationContext(draft, current)
    const references = generationExternalReferences(finalRequest)
    expect(references).toContain(`课例：${lesson.normalizedDirectory}（全部教学文档全文：01-teaching-plan.md、02-presentation-script.md）`)
    expect(references).toContain('课例材料提取片段：material-1（1 个片段）')
    expect(references).toContain('课例材料原件：material-1（1 份 base64 原始字节）')

    // 清单不是装饰：这些内容确实在本轮实际载荷里。
    const wire = JSON.stringify(generationInitialRequestForPrompt(finalRequest))
    expect(wire).toContain(DOCUMENT_BODY)
    expect(wire).toContain(MATERIAL_FRAGMENT)
    expect(wire).toContain('resources/lesson-materials/material-1/asset-1')
    expect(finalRequest.resourceFiles?.find(file => file.path === 'lesson-materials/material-1/asset-1')?.content)
      .toBe(Buffer.from(ASSET_BYTES).toString('base64'))
  })

  it('replaces a same-named material resource instead of sending two conflicting payloads', async () => {
    const { lesson, deps } = lessonFixture()
    const draft = rendererRequest(lesson.normalizedDirectory)
    const stale = { ...draft, resourceFiles: [{ path: 'lesson-materials/material-1/asset-1', encoding: 'base64' as const,
      content: Buffer.from('陈旧字节').toString('base64'), mediaType: 'image/png', role: 'material' as const },
    { path: 'components/widget.json', encoding: 'utf8' as const, content: '{}', mediaType: 'application/json', role: 'source' as const }] }
    const finalRequest = withLessonGenerationContext(stale, await readLessonGenerationContext(lesson, deps, false))
    expect(finalRequest.resourceFiles?.filter(file => file.path === 'lesson-materials/material-1/asset-1')).toHaveLength(1)
    expect(finalRequest.resourceFiles?.find(file => file.path === 'lesson-materials/material-1/asset-1')?.content)
      .toBe(Buffer.from(ASSET_BYTES).toString('base64'))
    expect(finalRequest.resourceFiles?.some(file => file.path === 'components/widget.json')).toBe(true)
    expect(generationExternalReferences(finalRequest)).toContain('课例材料原件：material-1（1 份 base64 原始字节）')
    expect(generationExternalReferences(finalRequest)).toContain('工程内组件与互动内容：1 份源文件')
  })

  it('replaces a stale renderer copy of the confirmed documents with the current files', async () => {
    const { lesson, deps } = lessonFixture()
    const draft = rendererRequest(lesson.normalizedDirectory, { teachingPlan: '旧策划正文', presentationScript: '旧脚本正文' })
    const current = await readLessonGenerationContext(lesson, deps, true)
    expect(current.confirmedDocuments?.teachingPlan).toContain(DOCUMENT_BODY)
    const finalRequest = withLessonGenerationContext(draft, current)
    expect(finalRequest.confirmedDocuments?.teachingPlan).toContain(DOCUMENT_BODY)
    expect(generationExternalReferences(finalRequest)).toContain('已确认的教学策划和呈现脚本全文')
    expect(generationExternalReferences(finalRequest)).toContain('课例材料原件：material-1（1 份 base64 原始字节）')
    expect(JSON.stringify(generationInitialRequestForPrompt(finalRequest))).toContain(DOCUMENT_BODY)
  })
})
