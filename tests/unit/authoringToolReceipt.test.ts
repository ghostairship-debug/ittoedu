import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { openSlideAuthoringSession } from '@/renderer/course/slideAuthoringBackend'
import { addSlideTextLayer } from '@/renderer/course/v9SlideContentCommands'
import { executeAuthoringTool, type AuthoringToolDefinition } from '@/renderer/authoring/tools/executeAuthoringTool'
import { applyEditorTransactionStep, type EditorTransactionState, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { commitEditorTransactionToAuthoringHistory, createResourceAwareAuthoringHistory } from '@/renderer/authoring/resourceAwareAuthoringHistory'

function setup() {
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync('tests/fixtures/architecture-baseline/slide-heavy.h5lesson')))
  let state: EditorTransactionState = { document: archive.project, resources: { assetFiles: {}, componentPackages: {} } }
  let history = createResourceAwareAuthoringHistory(state.document)
  let committed: EditorTransactionStep | undefined
  const location = state.document.locations.find((entry) => entry.kind === 'slide-scene')!
  if (location.kind !== 'slide-scene') throw new Error('Missing Slide fixture')
  const request = {
    version: 1, requestId: 'insert-text-1', tool: 'slide.text.create', input: { text: '工具文字' },
    destination: { kind: 'create', scope: {
      projectId: state.document.id, documentRevision: state.document.revision,
      revisionPolicy: { kind: 'exact' }, sessionGeneration: 0,
      surfaceType: 'slide', surfaceId: location.surfaceId, locationId: location.id,
      stateId: location.stateId ?? null, owner: 'scene', ownerKey: `scene:${location.sceneId}`,
      parent: { kind: 'owner' }, insertion: { kind: 'append' },
    } },
  }
  const port = {
    readDocument: () => state.document,
    validateDestination: vi.fn(() => null),
    commit: vi.fn((step: EditorTransactionStep) => {
      const next = applyEditorTransactionStep(state, step, 'forward')
      const nextHistory = commitEditorTransactionToAuthoringHistory(history, step)
      state = next
      history = nextHistory
      committed = step
      return true
    }),
  }
  const definition: AuthoringToolDefinition<{ text: string }> = {
    name: 'slide.text.create', inputSchema: z.object({ text: z.string() }).strict(),
    plan: ({ document, value }) => {
      const result = addSlideTextLayer(openSlideAuthoringSession(document, { locationId: location.id }), { id: 'tool-text', text: value.text })
      if (!result.ok || !result.nextSession) throw new Error(result.reason)
      return {
        transaction: {
          projectId: document.id, baseRevision: document.revision,
          nextDocument: result.nextSession.history.present,
          resourceChanges: { assetFileChanges: [{ assetId: 'tool-resource', after: new Uint8Array([1, 2, 3]) }] },
        },
        affected: [{ id: 'tool-text', operation: 'created', ownerKey: request.destination.scope.ownerKey, authoringAddress: null }],
      }
    },
  }
  return { request, definition, port, state: () => state, history: () => history,
    undo: () => { state = applyEditorTransactionStep(state, committed!, 'inverse') },
    advance: () => { state = { ...state, document: { ...state.document, revision: state.document.revision + 1 } } },
  }
}

describe('Authoring Tool single transaction receipt', () => {
  it('commits a real Slide command and resource together, with one reversible history step', async () => {
    const test = setup()
    const before = test.state().document
    const receipt = await executeAuthoringTool(test.request, test.definition, test.port)
    expect(receipt).toMatchObject({ status: 'committed', requestId: 'insert-text-1', beforeRevision: before.revision, afterRevision: before.revision + 1, resources: { assetIds: ['tool-resource'] } })
    expect(test.port.commit).toHaveBeenCalledTimes(1)
    expect(test.history().past).toHaveLength(1)
    expect(test.state().resources.assetFiles['tool-resource']).toEqual(new Uint8Array([1, 2, 3]))
    expect(JSON.stringify(test.state().document)).toContain('工具文字')
    test.undo()
    expect(test.state().document).toEqual(before)
    expect(test.state().resources.assetFiles['tool-resource']).toBeUndefined()
  })

  it('rejects stale, malformed and failed plans without writes, including async invalidation', async () => {
    const stale = setup()
    stale.advance()
    expect((await executeAuthoringTool(stale.request, stale.definition, stale.port)).status).toBe('stale')
    expect(stale.port.commit).not.toHaveBeenCalled()
    const invalid = setup()
    delete (invalid.request.destination.scope as Partial<typeof invalid.request.destination.scope>).ownerKey
    expect((await executeAuthoringTool(invalid.request, invalid.definition, invalid.port)).diagnostics[0].path).toContain('ownerKey')
    expect(invalid.port.commit).not.toHaveBeenCalled()
    const delayed = setup()
    const originalPlan = delayed.definition.plan
    delayed.definition.plan = async (input) => {
      const result = await originalPlan(input)
      delayed.advance()
      return result
    }
    expect((await executeAuthoringTool(delayed.request, delayed.definition, delayed.port)).status).toBe('stale')
    expect(delayed.port.commit).not.toHaveBeenCalled()
    const failed = setup()
    failed.definition.plan = ({ document }) => { document.title = 'private mutation'; throw new Error('resource preparation failed') }
    const before = structuredClone(failed.state())
    expect((await executeAuthoringTool(failed.request, failed.definition, failed.port)).status).toBe('failed')
    expect(failed.state()).toEqual(before)
    expect(failed.port.commit).not.toHaveBeenCalled()
  })
})
