// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlImportDesktopService } from '../../src/main/workbench/htmlImport/HtmlImportDesktopService'
import type { ContentApplyRequest, ContentApplyResult } from '../../src/main/workbench/contentApply/application/types'
import type { ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function fixture(admissionStatus: 'ready' | 'rejected' = 'ready', kind: 'slide' | 'flow' = 'slide') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-html-desktop-'))
  roots.push(root)
  const source = path.join(root, 'lesson.html')
  await fs.writeFile(source, '<!doctype html><html><body>Lesson</body></html>')
  const project = createBlankCourseProjectV10('HTML import')
  project.surfaces[0]!.kind = kind
  project.definitions.text = { id: 'text', title: 'Text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.anchor = { id: 'anchor', definitionId: 'text', data: { html: '<p>Anchor</p>' } }
  project.surfaces[0]!.childIds = ['anchor']
  let snapshot = { documentId: 'doc', epoch: 'epoch', revision: 0,
    model: { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } } }
  const initial = snapshot
  const session = { read: vi.fn(() => snapshot), drain: vi.fn(async () => snapshot) }
  const receipt = { status: 'applied' as const, documentId: 'doc', operationId: 'html-import:commit', beforeRevision: 0, revision: 1, persistence: 'recoverable' as const }
  const gateway = {
    beginRun: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    applyComponentContent: vi.fn(async (_runId: string, _callId: string, _baseline: ComponentProjectSnapshot, input: ContentApplyRequest): Promise<ContentApplyResult> => admissionStatus === 'ready'
      ? { input, commit: 'committed', receipt, insertedIds: ['imported'], diagnostics: [], usability: 'usable', delivery: 'not_requested' }
      : { input, commit: 'not_committed', insertedIds: [], diagnostics: [{ code: 'content-rejected', level: 'error', repairable: true, message: '内容应用宿主拒绝' }], usability: 'unusable', delivery: 'not_requested' }),
  }
  const documents = { registry: { get: vi.fn(() => session) }, tools: gateway, readOpenedSource: vi.fn(async () => undefined) } as unknown as DocumentHostService
  const service = new HtmlImportDesktopService({ documents, chooseSource: async () => source })
  const input = { documentId: 'doc', epoch: 'epoch', revision: 0, surfaceId: project.surfaces[0]!.id,
    source: { kind: 'file' as const, path: source } }
  return { service, input, session, documents, gateway, receipt, source, initial,
    advanceRevision: () => { snapshot = { ...snapshot, revision: 1 } },
    replaceEpoch: () => { snapshot = { ...snapshot, epoch: 'replacement' } } }
}

describe('M17 human HTML desktop import', () => {
  it('uses one human Gateway run and the same captured V10 content application as project.apply', async () => {
    const f = await fixture()
    const result = await f.service.import(f.input)
    expect(result?.receipt).toEqual(f.receipt)
    expect(result?.operationId).toBe(f.receipt.operationId)
    expect(f.gateway.beginRun).toHaveBeenCalledWith({ runId: result?.runId, actor: 'human',
      documents: [{ documentId: 'doc', writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: path.dirname(f.source) } })
    expect(f.gateway.applyComponentContent).toHaveBeenCalledWith(result?.runId, 'import-html', f.initial,
      expect.objectContaining({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: f.input.surfaceId }, index: 1 },
        source: expect.objectContaining({ kind: 'html', html: '<!doctype html><html><body>Lesson</body></html>',
          original: expect.objectContaining({ filename: 'lesson.html', mimeType: 'text/html' }) }),
        editingContext: { surfaceId: f.input.surfaceId, stateId: null } }))
    expect(f.gateway.stop).toHaveBeenCalledWith(result?.runId)
  })

  it('preserves a committed result and the content owner’s nonblocking resource notice', async () => {
    const f = await fixture()
    await fs.writeFile(f.source, '<img src="https://cdn.example.org/photo.png">')
    f.gateway.applyComponentContent.mockImplementation(async (_runId, _callId, _baseline, input) => ({ input,
      commit: 'committed', receipt: f.receipt, insertedIds: ['image'], usability: 'partial', delivery: 'not_requested',
      diagnostics: [{ code: 'image-resource-unavailable', level: 'warning', repairable: true,
        message: '离线时可能无法使用', reference: 'https://cdn.example.org/photo.png' }] }))
    const result = await f.service.import(f.input)
    expect(result?.receipt.status).toBe('applied')
    expect(result?.notices).toEqual(['离线时可能无法使用 (https://cdn.example.org/photo.png)'])
    expect(f.gateway.stop).toHaveBeenCalledOnce()
  })

  it('rejects stale requests and strict-contract extras before starting a run', async () => {
    const f = await fixture()
    await expect(f.service.import({ ...f.input, revision: 1 })).rejects.toThrow('目标已改变')
    await expect(f.service.import({ ...f.input, runId: 'renderer-run' })).rejects.toThrow()
    expect(f.gateway.beginRun).not.toHaveBeenCalled()
  })

  it('rejects an epoch change during Gateway startup before applying content and closes the run', async () => {
    const f = await fixture()
    f.gateway.beginRun.mockImplementation(async () => { f.replaceEpoch() })
    await expect(f.service.import(f.input)).rejects.toThrow('工程会话已变化')
    expect(f.gateway.applyComponentContent).not.toHaveBeenCalled()
    expect(f.gateway.stop).toHaveBeenCalledOnce()
  })

  it('returns null when the picker is cancelled without opening a run', async () => {
    const f = await fixture()
    const service = new HtmlImportDesktopService({ documents: f.documents, chooseSource: async () => null })
    expect(await service.import({ ...f.input, source: { kind: 'choose' } })).toBeNull()
    expect(f.gateway.beginRun).not.toHaveBeenCalled()
  })

  it('retains the original Flow baseline across unrelated revisions but rejects a replaced session during selection', async () => {
    const f = await fixture('ready', 'flow')
    let choose!: () => void
    const picker = new Promise<string>(resolve => { choose = () => resolve(f.source) })
    const service = new HtmlImportDesktopService({ documents: f.documents, chooseSource: () => picker })
    const pending = service.import({ ...f.input, anchorInstanceId: 'anchor', source: { kind: 'choose' } })
    await vi.waitFor(() => expect(f.session.drain).toHaveBeenCalled())
    f.advanceRevision()
    choose()
    expect((await pending)?.receipt.status).toBe('applied')
    expect(f.gateway.applyComponentContent).toHaveBeenCalledWith(expect.any(String), 'import-html', f.initial,
      expect.objectContaining({ target: { kind: 'container', container: { kind: 'surface', surfaceId: f.input.surfaceId }, index: 1 } }))
    const changed = await fixture('ready', 'flow')
    const replaced = new HtmlImportDesktopService({ documents: changed.documents, chooseSource: async () => { changed.replaceEpoch(); return changed.source } })
    await expect(replaced.import({ ...changed.input, source: { kind: 'choose' } })).rejects.toThrow('工程会话已变化')
    expect(changed.gateway.applyComponentContent).not.toHaveBeenCalled()
    expect(changed.gateway.stop).toHaveBeenCalledOnce()
  })

  it('rejects an anchor outside the selected page and inserts after the captured Flow anchor', async () => {
    const slide = await fixture()
    await expect(slide.service.import({ ...slide.input, anchorInstanceId: 'missing' })).rejects.toThrow('锚点不属于所选页面')
    expect(slide.gateway.beginRun).not.toHaveBeenCalled()
    const flow = await fixture('ready', 'flow')
    const result = await flow.service.import({ ...flow.input, anchorInstanceId: 'anchor' })
    expect(result?.receipt.status).toBe('applied')
    expect(flow.gateway.applyComponentContent).toHaveBeenCalledWith(result?.runId, 'import-html', flow.initial,
      expect.objectContaining({ target: { kind: 'container', container: { kind: 'surface', surfaceId: flow.input.surfaceId }, index: 1 } }))
  })

  it('stops the human run after a content-owner failure without claiming an import receipt', async () => {
    const f = await fixture('rejected')
    await expect(f.service.import(f.input)).rejects.toThrow('内容应用宿主拒绝')
    expect(f.gateway.applyComponentContent).toHaveBeenCalledOnce()
    expect(f.gateway.stop).toHaveBeenCalledOnce()
  })
})
