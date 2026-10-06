// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'

// Target resolution, resource admission, Gateway and Session are real. Geometry is
// fixed because this case proves formal content/History facts, not browser layout.
vi.mock('../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement', () => ({
  measureHtmlAtDesignViewport: vi.fn(async (request: HtmlDesignMeasurementRequest) => ({
    viewport: request.viewport, diagnostics: [], source: { html: request.html },
    root: { kind: 'web', label: 'content', sourcePath: [0],
      frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 0, 0] },
      style: {}, pseudoElements: {}, children: [], decorations: [], sourceRegions: [],
      content: { kind: 'element', tagName: 'div', attributes: {}, style: {}, pseudoElements: {},
        children: [{ kind: 'text', text: 'Inserted content' }] } },
  })),
}))

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10 fixture')
  return snapshot.model
}

it('reports empty content targets before admitting originals, then inserts, reads equivalent content and undoes once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-audit-content-'))
  const host = new DocumentHostService(path.join(root, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('Content truth')
    const initial = await host.internalAPI.create({ kind: 'course-v10', project,
      resources: { assets: {}, components: {} } }, 'content-truth.h5lesson')
    await host.tools.beginRun({ runId: 'content-truth', actor: 'agent',
      documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('content-truth', ['content'])
    let serial = 0
    const call = (name: string, input: unknown) => host.tools.execute('content-truth', `call-${++serial}`, { name, input })
    const apply = async (input: unknown) => {
      const result = await call('project.apply', input)
      expect(result.kind).toBe('read')
      if (result.kind !== 'read') throw new Error(JSON.stringify(result))
      return result.data as ContentApplyResult
    }
    const files = componentProjectFiles(project, course(initial).resources)
    const emptyPage = files.find(file => file.kind === 'page')!
    const structure = files.find(file => file.kind === 'structure' && file.target?.kind === 'container'
      && file.target.container.kind === 'surface')!
    const html = '<div>Inserted content</div>'
    await fs.writeFile(path.join(root, 'author.html'), html)
    await call('project.read', { path: emptyPage.path })
    const failures = []
    for (const source of [{ content: html }, { from: 'author.html' }]) {
      const result = await apply({ path: emptyPage.path, intent: 'content', ...source })
      failures.push(result)
      const current = await host.internalAPI.read(initial.documentId)
      expect(current.revision).toBe(initial.revision)
      expect(current.undoDepth).toBe(0)
      expect(course(current)).toEqual(course(initial))
    }
    for (const result of failures) {
      expect(result).toMatchObject({ commit: 'not_committed', usability: 'unusable', insertedIds: [],
        diagnostics: [expect.objectContaining({ code: 'no-content-target', repairable: true,
          message: expect.stringContaining('insert') })] })
      expect(result.receipt).toBeUndefined()
      expect(result.input).toMatchObject({ intent: 'content', source: { kind: 'html', html } })
    }
    expect(failures[1]!.input).toMatchObject({ source: { original: { bytes: new TextEncoder().encode(html), filename: 'author.html' } } })
    expect(await fs.readFile(path.join(root, 'author.html'), 'utf8')).toBe(html)
    const inserted = await apply({ path: structure.path, from: 'author.html', intent: 'insert' })
    expect(inserted).toMatchObject({ commit: 'committed', usability: 'usable', receipt: { status: 'applied' } })
    const current = await host.internalAPI.read(initial.documentId)
    expect(current.undoDepth).toBe(1)
    expect(course(current).project.surfaces[0]!.childIds).toEqual(inserted.insertedIds)
    expect(course(current).project.instances[inserted.insertedIds[0]!]!.data)
      .toMatchObject({ html: expect.stringContaining('Inserted content') })
    const original = Object.values(course(current).project.assets).find(asset => asset.filename === 'author.html')!
    expect(course(current).resources.assets[original.id]).toEqual(new TextEncoder().encode(html))
    const object = componentProjectFiles(course(current).project, course(current).resources)
      .find(file => file.kind === 'html' && file.target?.kind === 'instance')!
    expect(await call('project.read', { path: object.path })).toMatchObject({ kind: 'read', data: { content: object.content } })
    expect(await apply({ path: object.path, content: object.content, intent: 'content' }))
      .toMatchObject({ commit: 'unchanged', usability: 'usable', insertedIds: [] })
    const equivalent = await host.internalAPI.read(initial.documentId)
    expect(equivalent.revision).toBe(current.revision)
    expect(equivalent.undoDepth).toBe(1)
    expect(course(equivalent)).toEqual(course(current))
    expect((await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch,
      baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
    const undone = await host.internalAPI.read(initial.documentId)
    expect(undone.undoDepth).toBe(0)
    expect(course(undone).project.surfaces[0]!.childIds).toEqual([])
    expect(course(undone).project.instances).toEqual(course(initial).project.instances)
    expect(course(undone).project.assets).toEqual(course(initial).project.assets)
    expect(course(undone).resources).toEqual(course(initial).resources)
  } finally {
    await host.tools.stop('content-truth')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  }
})
