// @vitest-environment node
import { setRootContainers } from '../helpers/glxWorkFixture'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { DocumentHostService } from '@/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '@/core/course/createCourseProjectV10'
import { createFlowDocumentRecoveryPort, serializeFlowDocumentRecovery, type FlowDocumentDraft } from '@/renderer/authoring/flowDocumentDraft'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected Flow fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

describe('Flow adapter with the real document recovery owner', () => {
  it('preserves unaccepted same-epoch raw through remount writes and clears, while adopted current input does not become history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-owner-')); roots.push(root)
    const host = new DocumentHostService(path.join(root, 'documents'), {}, { legacyFlowRecoveryDirectory: path.join(root, 'legacy-flow') })
    const project = createBlankCourseProjectV10('Flow recovery')
    setRootContainers(project, [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }])
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.glx')
    const target = { documentId: snapshot.documentId, projectId: project.id, projectPath: null, surfaceId: 'flow', revision: project.revision,
      epoch: 'first-provider', documentEpoch: snapshot.epoch }
    const draft: FlowDocumentDraft = { surfaceId: 'flow', revision: project.revision, source: 'original unfinished source', composing: false, diagnostics: [] }
    await createFlowDocumentRecoveryPort(host.internalAPI).write(serializeFlowDocumentRecovery(target, draft), target)

    // The remounted provider reads and rejects the disk input. Read itself
    // must not change ownership or retire the old active raw.
    const remounted = createFlowDocumentRecoveryPort(host.internalAPI), current = { ...target, epoch: 'second-provider' }
    const originals = await remounted.read(current)
    expect(originals).toHaveLength(1)
    await remounted.write(serializeFlowDocumentRecovery(current, { ...draft, source: 'new local source' }), current)
    expect((await host.readAuthoringDrafts(snapshot.documentId))?.flow?.map(record => record.source).sort()).toEqual(['new local source', 'original unfinished source'])
    await remounted.clear(current)
    expect((await host.readAuthoringDrafts(snapshot.documentId))?.flow?.map(record => record.source)).toEqual(['original unfinished source'])

    // Once the exact original has been accepted, subsequent edits replace it
    // as current input instead of preserving an unnecessary raw history.
    await remounted.claim(current, originals[0]!)
    await remounted.write(serializeFlowDocumentRecovery(current, { ...draft, source: 'continued accepted source' }), current)
    expect((await host.readAuthoringDrafts(snapshot.documentId))?.flow?.map(record => record.source)).toEqual(['continued accepted source'])
    await remounted.clear(current)
    expect(await host.readAuthoringDrafts(snapshot.documentId)).toBeNull()
  })
})
