// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { HtmlImportDesktopService } from '../../src/main/workbench/htmlImport/HtmlImportDesktopService'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function fixture(admissionStatus: 'ready' | 'rejected' = 'ready', kind: 'slide' | 'flow' = 'slide') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-html-desktop-'))
  roots.push(root)
  const source = path.join(root, 'lesson.html')
  await fs.writeFile(source, '<!doctype html><html><body>Lesson</body></html>')
  const blank = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const project = kind === 'flow' ? addCourseFlowPage(blank, { expectedRevision: blank.revision }).project : blank
  let snapshot = { documentId: 'doc', epoch: 'epoch', revision: 0,
    model: { kind: 'course-v9' as const, project, resources: { assets: {}, components: {} } } }
  const session = { read: vi.fn(() => snapshot), drain: vi.fn(async () => snapshot) }
  const receipt = { status: 'applied' as const, documentId: 'doc', operationId: 'commit', beforeRevision: 0, revision: 1, persistence: 'recoverable' as const }
  const gateway = {
    beginRun: vi.fn(async () => {}), issueTarget: vi.fn(async () => 'frozen-handle'), stop: vi.fn(async () => {}),
    execute: vi.fn(async (_runId: string, _callId: string, call: { name: string }) => {
      if (call.name === 'build.create') return { kind: 'read', data: { job: 'job' } }
      if (call.name === 'build.write') return { kind: 'read', data: {} }
      if (call.name === 'build.check') return { kind: 'read', data: { status: admissionStatus, artifact: 'artifact' } }
      if (call.name === 'build.import') return { kind: 'document-operation', result: receipt }
      throw new Error(`Unexpected tool: ${call.name}`)
    }),
  }
  const documents = { registry: { get: vi.fn(() => session) }, tools: gateway } as unknown as DocumentHostService
  const service = new HtmlImportDesktopService({ documents, chooseSource: async () => source })
  const input = { documentId: 'doc', epoch: 'epoch', revision: 0, locationId: kind === 'flow' ? project.locations.find(item => item.kind === 'flow-block')!.id : project.locations[0]!.id,
    source: { kind: 'file' as const, path: source } }
  return { service, input, session, gateway, receipt, source, advanceRevision: () => { snapshot = { ...snapshot, revision: 1 } } }
}

describe('M17 human HTML desktop import', () => {
  it('uses one human Gateway run, frozen handle and S13 stages, then returns its receipt', async () => {
    const f = await fixture()
    const result = await f.service.import(f.input)
    expect(result?.receipt).toEqual(f.receipt)
    expect(result?.operationId).toMatch(/^html-import:/)
    expect(f.gateway.beginRun).toHaveBeenCalledWith({ runId: result?.runId, actor: 'human',
      documents: [{ documentId: 'doc', writable: [{ kind: 'document' }] }] })
    expect(f.gateway.issueTarget).toHaveBeenCalledWith(result?.runId, 'doc', { kind: 'document' })
    expect(f.gateway.execute.mock.calls.map(call => call[2].name)).toEqual(['build.create', 'build.write', 'build.write', 'build.check', 'build.import'])
    expect(f.gateway.stop).toHaveBeenCalledWith(result?.runId)
  })

  it('rejects stale requests and strict-contract extras before starting a run', async () => {
    const f = await fixture()
    await expect(f.service.import({ ...f.input, revision: 1 })).rejects.toThrow('目标已改变')
    await expect(f.service.import({ ...f.input, runId: 'renderer-run' })).rejects.toThrow()
    expect(f.gateway.beginRun).not.toHaveBeenCalled()
  })

  it('rejects a revision change while issuing the frozen handle before creating scratch', async () => {
    const f = await fixture()
    f.gateway.issueTarget.mockImplementation(async () => { f.advanceRevision(); return 'new-revision-handle' })
    await expect(f.service.import(f.input)).rejects.toThrow('签发句柄期间已改变')
    expect(f.gateway.execute).not.toHaveBeenCalled()
    expect(f.gateway.stop).toHaveBeenCalledOnce()
  })

  it('returns null when the picker is cancelled without opening a run', async () => {
    const f = await fixture()
    const service = new HtmlImportDesktopService({ documents: { registry: { get: () => f.session }, tools: f.gateway } as unknown as DocumentHostService,
      chooseSource: async () => null })
    expect(await service.import({ ...f.input, source: { kind: 'choose' } })).toBeNull()
    expect(f.gateway.beginRun).not.toHaveBeenCalled()
  })

  it('freezes the selected Flow anchor before the picker and rejects a revision change during selection', async () => {
    const f = await fixture('ready', 'flow')
    let choose!: () => void
    const picker = new Promise<string>(resolve => { choose = () => resolve(f.source) })
    const service = new HtmlImportDesktopService({ documents: { registry: { get: () => f.session }, tools: f.gateway } as unknown as DocumentHostService,
      chooseSource: () => picker })
    const pending = service.import({ ...f.input, source: { kind: 'choose' } })
    await vi.waitFor(() => expect(f.session.drain).toHaveBeenCalled())
    f.advanceRevision()
    choose()
    await expect(pending).rejects.toThrow('选择文件期间已改变')
    expect(f.gateway.beginRun).not.toHaveBeenCalled()
  })

  it('rejects a Slide anchor and accepts the frozen Flow location through the same Gateway stages', async () => {
    const slide = await fixture()
    await expect(slide.service.import({ ...slide.input, anchorBlockId: 'block' })).rejects.toThrow('Slide 场景不接受')
    expect(slide.gateway.beginRun).not.toHaveBeenCalled()
    const flow = await fixture('ready', 'flow')
    const location = flow.input.locationId
    const result = await flow.service.import({ ...flow.input, anchorBlockId: location })
    expect(result?.receipt.status).toBe('applied')
    expect(flow.gateway.execute.mock.calls.map(call => call[2].name)).toEqual(['build.create', 'build.write', 'build.write', 'build.check', 'build.import'])
  })

  it('stops the human run after an S13 admission failure without importing', async () => {
    const f = await fixture('rejected')
    await expect(f.service.import(f.input)).rejects.toThrow('未通过受控构建')
    expect(f.gateway.execute.mock.calls.some(call => call[2].name === 'build.import')).toBe(false)
    expect(f.gateway.stop).toHaveBeenCalledOnce()
  })
})
