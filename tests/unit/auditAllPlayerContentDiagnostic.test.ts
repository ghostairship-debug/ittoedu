// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'

it('CA207 actual ContentApply preparation and canonical commit retain the real compiler file, line, column and source line', async () => {
  const project = createBlankCourseProjectV10(), ownerId = 'diagnostic-source', file = 'src/lesson.ts', encode = (value: string) => new TextEncoder().encode(value)
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'typescript', workspace: { ownerId, entry: file } } }
  const original = { [file]: encode('export default {};') }
  const session = await DocumentSession.create({ documentId: 'diagnostic-document', epoch: 'diagnostic-epoch', binding: { kind: 'untitled', suggestedName: 'diagnostic.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: { [ownerId]: original } } } }, new CourseV10Driver(),
  { async append() {}, async save() { throw new Error('This diagnostic probe does not save files') } })
  const captured = session.read()
  if (captured.model.kind !== 'course-v10') throw new Error('Expected V10 diagnostic fixture')
  const model = captured.model, compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler()), compile = vi.fn(compilation.compile.bind(compilation))
  const measure = vi.fn(async () => { throw new Error('Canonical source edits do not need browser measurement') })
  const service = new ContentApplyService({ compilation: { compile }, measure,
    session: { project: () => model.project, resources: () => model.resources, dispatch: command => session.execute({ documentId: captured.documentId, epoch: captured.epoch,
      baseRevision: captured.revision, operationId: 'diagnostic-edit', actor: 'human', mutation: { type: 'command', command } }) } })
  const lineText = 'const broken = ;', source = `const retained = 1;\n${lineText}\nexport default retained;`, files = { [file]: encode(source) }
  const result = await service.apply({ intent: 'canonical', edits: [{ type: 'component.files.set', ownerId, expectedFiles: original, files }] })
  expect(compile).toHaveBeenCalledOnce(); expect(measure).not.toHaveBeenCalled()
  const compiled = await compile.mock.results[0]!.value
  expect(compiled.status).toBe('failed')
  if (compiled.status !== 'failed') throw new Error('Fixture must produce a real syntax diagnostic')
  expect(compiled.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', file, line: 2, column: 15, lineText }))
  expect(result).toMatchObject({ commit: 'committed', usability: 'unusable', receipt: { status: 'applied' } })
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ level: 'error', code: 'component-compile', repairable: true, file, line: 2, column: 15, lineText }))
  expect(session.read()).toMatchObject({ undoDepth: 1, model: { resources: { components: { [ownerId]: files } } } })
})
