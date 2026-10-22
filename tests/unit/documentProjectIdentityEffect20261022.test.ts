// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'

it('retains a reconciled replacement project identity through Undo, Redo and cold recovery', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-identity-effect-'))
  try {
    const journal = createDocumentJournal({ directory }), driver = new CourseV10Driver(), project = createBlankCourseProjectV10('Original')
    const session = await DocumentSession.create({ documentId: 'identity-document', epoch: 'original-epoch', saved: true,
      model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
      binding: { kind: 'file', path: path.join(directory, 'work.glx'), version: 'original', bindingVersion: 1 } }, driver, journal)
    const replacement = { ...structuredClone(project), id: 'replacement-project' }
    await session.reconcileFile({ epoch: 'original-epoch', baseRevision: 0, bindingVersion: 1 }, async () => ({ version: 'replaced', matchesDisk: false,
      model: { kind: 'course-v10', project: replacement, resources: { assets: {}, components: {} } } }))
    const identity = (value: DocumentSession) => {
      const snapshot = value.read()
      if (snapshot.model.kind !== 'course-v10') throw new Error('expected work project')
      return snapshot.model.project.id
    }
    expect(identity(session)).toBe('replacement-project')
    const history = async (type: 'undo' | 'redo') => session.execute({ documentId: session.documentId, epoch: 'original-epoch', baseRevision: session.readIdentity().revision,
      operationId: type, actor: 'human', mutation: { type } })
    expect((await history('undo')).status).toBe('applied')
    expect(identity(session)).toBe(project.id)
    expect((await history('redo')).status).toBe('applied')
    expect(identity(session)).toBe('replacement-project')
    const retained = await createDocumentJournal({ directory }).recover(session.documentId)
    expect(retained?.past[0].effects?.[0].kind).toBe('replace')
    const cold = await DocumentSession.restore(retained!, 'cold-epoch', driver, createDocumentJournal({ directory }))
    expect(identity(cold)).toBe('replacement-project')
    expect(cold.read().revision).toBe(3)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
