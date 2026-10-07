// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { ContentApplyService } from '../../../../src/main/workbench/contentApply/applyService'
import { InMemoryComponentCompilation } from '../../../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

it.each(['worker-failure', 'user-abort'] as const)('measurement %s preserves usable source or honors cancellation through the real V10 writer', async failure => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t08-measure-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('测量恢复')
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'measure.h5lesson')
    const controller = new AbortController()
    const measure = vi.fn(async () => {
      if (failure === 'user-abort') { controller.abort(); throw new DOMException('User cancelled', 'AbortError') }
      throw new Error('Measurement worker unavailable')
    })
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    const service = new ContentApplyService({ measure, compilation, session: { project: () => project, resources: () => snapshot.model.resources,
      dispatch: command => host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        operationId: 'apply', actor: 'agent', mutation: { type: 'command', command } }) } })
    const html = '<h1>可用教学正文</h1><details><summary>查看答案</summary><p>答案为二</p></details>'
    const result = await service.apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0].id } },
      source: { kind: 'html', html, original: { bytes: new TextEncoder().encode(html), filename: 'teacher.html', mimeType: 'text/html' } } }, controller.signal)
    expect(measure).toHaveBeenCalledTimes(1)
    const current = await host.internalAPI.read(snapshot.documentId)
    if (failure === 'user-abort') {
      expect(result.commit).toBe('not_committed')
      expect(current).toMatchObject({ revision: snapshot.revision, undoDepth: 0 })
      expect(current.model).toEqual(snapshot.model)
    } else {
      expect(result.commit).toBe('committed')
      expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'warning', repairable: true })]))
      expect(current.undoDepth).toBe(1)
      if (current.model.kind !== 'course-v10') throw new Error('V10 required')
      const instance = current.model.project.instances[result.insertedIds[0]]
      expect(current.model.project.definitions[instance.definitionId].implementation).toMatchObject({ kind: 'builtin', key: 'guoling.html-program' })
      expect(instance.data).toMatchObject({ html })
      const filename = path.join(directory, 'saved.h5lesson')
      await host.internalAPI.save(snapshot.documentId, filename)
      const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
      expect(reopened).toMatchObject({ model: { kind: 'course-v10', project: { instances: { [instance.id]: { data: { html } } } } } })
      // Browser behavior is a separate real-renderer acceptance; this case proves no source/static fallback loss.
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
