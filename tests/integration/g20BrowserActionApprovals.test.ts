import { describe, expect, it } from 'vitest'
import { BrowserActionApprovals } from '../../src/main/workbench/externalTools/BrowserActionApprovals'

describe('one-use managed browser action approvals', () => {
  const approved = { runId: 'run', operationId: 'tool:abc', tool: 'browser_type' as const,
    arguments: { target: '#title', text: 'lesson', snapshotId: 'snapshot-1' }, snapshotId: 'snapshot-1' }

  it('binds the exact run, operation, action, parameters and observed page', () => {
    const approvals = new BrowserActionApprovals()
    approvals.beginRun('run')
    approvals.grant(approved)
    expect(approvals.consume({ ...approved, runId: 'another' })).toBe(false)
    expect(approvals.consume({ ...approved, operationId: 'tool:other' })).toBe(false)
    expect(approvals.consume({ ...approved, snapshotId: 'snapshot-2' })).toBe(false)
    expect(approvals.consume(approved)).toBe(false)
    expect(() => approvals.grant(approved)).toThrow('已经使用')
  })

  it('consumes only once and removes the grant on stop', () => {
    const approvals = new BrowserActionApprovals()
    approvals.beginRun('run')
    approvals.grant(approved)
    expect(approvals.consume({ ...approved, arguments: { target: '#title', text: 'lesson' } })).toBe(true)
    expect(approvals.consume(approved)).toBe(false)
    approvals.revokeRun('run')
    expect(() => approvals.grant(approved)).toThrow('未运行')
  })

  it('rejects changed parameters and mismatched snapshot identities', () => {
    const approvals = new BrowserActionApprovals()
    approvals.beginRun('run')
    approvals.grant(approved)
    expect(() => approvals.grant({ ...approved, arguments: { target: '#other', text: 'lesson' } }))
      .toThrow('不能更换')
    expect(() => approvals.grant({ ...approved, snapshotId: 'snapshot-2' }))
      .toThrow('观察身份')
  })
})
