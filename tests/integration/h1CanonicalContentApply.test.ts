// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'

it.each(['ready', 'invalid'] as const)('commits a canonical %s source and owner files together with formal undo/save/cold reopen', async kind => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-h1-canonical-'))
  try {
    const encode = (text: string) => new TextEncoder().encode(text)
    const project = createBlankCourseProjectV10('Canonical files'), ownerId = 'shared-source'
    const originalSource = 'export default { mount(){return {update(){},dispose(){}}} };'
    const definition = { id: 'custom', role: 'content' as const,
      implementation: { kind: 'source' as const, language: 'javascript' as const, workspace: { ownerId, entry: 'main.js' } } }
    project.definitions.custom = definition
    project.instances.first = { id: 'first', definitionId: 'custom', data: {},
      frame: { width: 180, height: 60, transform: [1, 0, 0, 1, 51, 77] } }
    project.instances.neighbor = { id: 'neighbor', definitionId: 'custom', data: {},
      frame: { width: 180, height: 60, transform: [1, 0, 0, 1, 290, 130] } }
    project.surfaces[0]!.childIds = ['first', 'neighbor']
    const documents = new DocumentHostService(path.join(root, 'documents'))
    const captured = await documents.internalAPI.create({ kind: 'course-v10', project,
      resources: { assets: {}, components: { [ownerId]: { 'main.js': encode(originalSource) } } } }, 'canonical.h5lesson')
    if (captured.model.kind !== 'course-v10') throw new Error('Expected V10 fixture')
    const capturedModel = captured.model
    const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    const compile = vi.fn(compilation.compile.bind(compilation)), measure = vi.fn(async () => { throw new Error('Canonical files must not remeasure frames') })
    const service = new ContentApplyService({ compilation: { compile }, measure,
      session: { project: () => capturedModel.project, resources: () => capturedModel.resources,
        dispatch: command => documents.internalAPI.dispatch({ documentId: captured.documentId, epoch: captured.epoch,
          baseRevision: captured.revision, operationId: randomUUID(), actor: 'agent', runId: 'fixture-canonical', mutation: { type: 'command', command } }) } })
    const changedSource = kind === 'ready' ? 'import { value } from "./value.js"; export default { value, mount(){return {update(){},dispose(){}}} };'
      : 'export default {'
    const files = { 'main.js': encode(changedSource), 'value.js': encode('export const value = 2;') }
    const edits: ComponentEdit[] = [{ type: 'component.files.set', ownerId,
      expectedFiles: captured.model.resources.components[ownerId]!, files },
      { type: 'definition.set', definition: { ...definition, title: 'Shared edited source' } },
      { type: 'project.theme.set', theme: { css: '.lesson{color:blue}' } }]
    const localDiagnostic = { level: 'warning' as const, code: 'local-import-repair', message: '可用正文已保留，局部内容待修复', repairable: true }
    const result = await service.apply({ intent: 'canonical', edits, ...(kind === 'ready' ? { diagnostics: [localDiagnostic] } : {}) })
    expect(result).toMatchObject({ commit: 'committed', usability: kind === 'ready' ? 'partial' : 'unusable', receipt: { status: 'applied' } })
    if (kind === 'ready') expect(result.diagnostics).toContainEqual(localDiagnostic)
    expect(compile).toHaveBeenCalledTimes(1)
    expect(compile.mock.calls[0]![0].files).toEqual({ 'main.js': changedSource, 'value.js': 'export const value = 2;' })
    expect(measure).not.toHaveBeenCalled()
    if (kind === 'invalid') expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'error', repairable: true })]))
    const applied = await documents.internalAPI.read(captured.documentId)
    expect(applied).toMatchObject({ undoDepth: 1, model: { project: { theme: { css: '.lesson{color:blue}' },
      definitions: { custom: { title: 'Shared edited source' } } } } })
    const history = async (type: 'undo' | 'redo') => {
      const current = await documents.internalAPI.read(captured.documentId)
      return documents.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        operationId: randomUUID(), actor: 'human', mutation: { type } })
    }
    expect((await history('undo')).status).toBe('applied')
    const undone = await documents.internalAPI.read(captured.documentId)
    if (undone.model.kind !== 'course-v10') throw new Error('Expected V10 history')
    expect(undone.model.resources.components[ownerId]).toEqual(captured.model.resources.components[ownerId])
    expect(undone.model.project.definitions.custom).toEqual(definition)
    expect(undone.model.project.theme).toBeUndefined()
    expect((await history('redo')).status).toBe('applied')
    const filename = path.join(root, 'canonical.h5lesson')
    await documents.saveToPath(captured.documentId, filename)
    const reopened = await new DocumentHostService(path.join(root, 'cold-documents')).open(filename)
    if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10 cold file')
    expect(reopened.model.resources.components[ownerId]).toEqual(files)
    expect(reopened.model.project.instances).toEqual(captured.model.project.instances)
    expect(reopened.model.project.definitions.custom?.title).toBe('Shared edited source')
    expect(reopened.dirty).toBe(false)
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }) }
})
