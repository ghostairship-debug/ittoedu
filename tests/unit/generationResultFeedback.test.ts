import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generationReceiptFeedback } from '@/main/localAgent/generationHostFeedback'
import { generationSemanticChangesSchema } from '@/shared/generationChangeSummary'
import { generationExecutionEvidenceSchema } from '@/shared/generationExecutionEvidence'
import { aiHostResultSchema } from '@/shared/localAgentTaskContract'
import { createWorkspaceIdentity } from '@/main/workspaceIdentity'

const semanticChanges = generationSemanticChangesSchema.parse({
  changes: [{ path: 'surfaces[id="surface-1"].scenes[id="scene-2"].name', before: '旧页名', after: '新页名', kind: 'updated', field: 'name',
    target: { entity: 'scene', id: 'scene-2', owner: 'surface', ownerKey: 'surface:surface-1', impact: 'instance',
      name: '新页名', surfaceId: 'surface-1', locationId: 'location-2' }, truncated: { before: false, after: true } }],
  omitted: 3,
  comparison: { status: 'partial', scopes: [
    { scope: 'document', status: 'complete' },
    { scope: 'resource-assets', status: 'not-provided', reason: 'resource snapshots were not supplied' },
  ] },
  truncation: { changeLimit: 200, valueLengthLimit: 500, omittedChanges: 3, truncatedValues: 1 },
})

const executionEvidence = generationExecutionEvidenceSchema.parse([
  { source: 'published-player', ruleId: 'rule-next', runId: 7, chainId: 70, status: 'checked', runStatus: 'navigation-terminal',
    start: { locationId: 'location-1', stateId: null }, end: { locationId: 'location-2', stateId: 'answer' } },
  { source: 'published-player', ruleId: 'rule-enter', runId: 8, chainId: 70, parentRunId: 7, status: 'skipped', runStatus: 'completed',
    start: { locationId: 'location-2', stateId: 'answer' }, end: { locationId: 'location-2', stateId: 'answer' }, reason: '入场运行未纳入本次结果核对' },
])

function identities() {
  return {
    taskId: randomUUID(), epoch: 1,
    workspace: createWorkspaceIdentity('project-1', 'C:\\courses\\feedback.h5lesson'),
    observationId: randomUUID(), requestId: randomUUID(), candidateId: randomUUID(), resultId: randomUUID(),
  }
}

describe('generation result feedback', () => {
  it('U10-feedback-parity projects the exact semantic changes and execution facts used by the committed result', () => {
    const identity = identities()
    const result = aiHostResultSchema.parse({ version: 1, ...identity, status: 'committed', beforeRevision: 4, afterRevision: 5,
      receipts: [{ version: 1, requestId: identity.requestId, candidateId: identity.candidateId, workspace: identity.workspace,
        status: 'committed', beforeRevision: 4, afterRevision: 5,
        affected: [{ id: 'scene-2', operation: 'updated', ownerKey: 'surface:surface-1', authoringAddress: null }],
        resources: { assetIds: [], packageIds: [] }, semanticChanges, executionEvidence }],
      semanticChanges, executionEvidence, summary: '已提交页面名称修改；行为记录供后续核对。', diagnostics: [], receiptDelivery: 'pending' })

    const [projected] = generationReceiptFeedback([result])
    expect(projected!.semanticChanges).toEqual(semanticChanges)
    expect(projected!.executionEvidence).toEqual(executionEvidence)
    expect(projected!.semanticChanges!.omitted).toBe(3)
    expect(projected!.semanticChanges!.changes[0]!.truncated).toEqual({ before: false, after: true })
    expect(projected!.affected).toEqual([{ id: 'scene-2', operation: 'updated', ownerKey: 'surface:surface-1' }])
    expect(result.semanticChanges).toEqual(semanticChanges)
    expect(result.executionEvidence).toEqual(executionEvidence)
  })

  it('U10-continuation preserves committed facts and failed execution evidence without turning either into a goal verdict', () => {
    const committedIdentity = identities()
    const failedIdentity = identities()
    const committed = aiHostResultSchema.parse({ version: 1, ...committedIdentity, status: 'committed', beforeRevision: 8, afterRevision: 9,
      receipts: [{ version: 1, requestId: committedIdentity.requestId, candidateId: committedIdentity.candidateId, workspace: committedIdentity.workspace,
        status: 'committed', beforeRevision: 8, afterRevision: 9, affected: [], resources: { assetIds: [], packageIds: [] }, semanticChanges }],
      semanticChanges, summary: '已提交现有阶段。', diagnostics: [], receiptDelivery: 'pending' })
    const failedRun = generationExecutionEvidenceSchema.parse([{ source: 'published-player', ruleId: 'rule-broken', runId: 9, chainId: 90,
      status: 'failed', runStatus: 'failed', start: { locationId: 'location-2', stateId: 'answer' },
      end: { locationId: 'location-3', stateId: null }, reason: '实际目的地与声明不一致' }])
    const failed = aiHostResultSchema.parse({ version: 1, ...failedIdentity, status: 'failed', beforeRevision: 9, afterRevision: 9, receipts: [],
      summary: '候选检查失败，未提交。', diagnostics: [{ code: 'result-mismatch', message: '目的地不一致', path: ['interactions', 'rule-broken'] }],
      failure: { version: 1, stage: 'prepare', requestId: failedIdentity.requestId, candidateId: failedIdentity.candidateId,
        diagnostics: [{ code: 'result-mismatch', message: '目的地不一致', path: ['interactions', 'rule-broken'] }], assetIds: [], packageIds: [],
        executionEvidence: failedRun } })

    const projected = generationReceiptFeedback([committed, failed])
    expect(projected[0]).toEqual(expect.objectContaining({ status: 'committed', semanticChanges }))
    expect(projected[1]!.failure).toEqual(expect.objectContaining({ executionEvidence: failedRun }))
    expect(projected[1]!.failure!.diagnostics[0]).toEqual(expect.objectContaining({ code: 'result-mismatch', message: '目的地不一致' }))
    expect(JSON.stringify(projected)).not.toMatch(/goalPassed|teacherGoal|目标已通过/)
  })
})
