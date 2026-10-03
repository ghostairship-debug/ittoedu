import { describe, expect, it, vi } from 'vitest'
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

  it('retains approvals during long tasks without identity or pending-count quotas', () => {
    const approvals = new BrowserActionApprovals()
    approvals.beginRun('run')
    const longIdentity = 'identity-'.repeat(100)
    const longApproval = { ...approved, operationId: longIdentity, snapshotId: longIdentity,
      arguments: { target: '#title', text: 'lesson' } }
    approvals.grant(longApproval)
    for (let i = 0; i < 125; i++) approvals.grant({ ...approved, operationId: `pending-${i}` })
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60_000)
    try { expect(approvals.consume(longApproval)).toBe(true) } finally { now.mockRestore() }
    expect(approvals.consume({ ...approved, operationId: 'pending-124' })).toBe(true)
    approvals.invalidate('run')
    expect(approvals.consume({ ...approved, operationId: 'pending-1' })).toBe(false)
  })
})
