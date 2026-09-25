import { describe, expect, it } from 'vitest'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import { relToolDiagnostics } from '../e2e/helpers/g20RelToolDiagnostics'

describe('REL tool diagnostics', () => {
  it('keeps bounded argument shapes and stable error codes without values or messages', () => {
    const run = { tools: [{
      call: { name: 'build.create', input: { target: 'secret-handle', content: 'private lesson',
        password: 'credential' } }, state: 'returned',
      result: { kind: 'error', code: 'invalid-target', message: 'private source text' },
    }] } as ExecutionRunRecord
    const diagnostics = relToolDiagnostics([run])
    expect(diagnostics).toEqual([{
      runIndex: 0, toolIndex: 0, name: 'build.create', state: 'returned',
      inputShape: { type: 'object', fields: { target: 'string', content: 'string' }, otherFieldCount: 1 },
      resultKind: 'error', errorCode: 'invalid-target',
    }])
    const serialized = JSON.stringify(diagnostics)
    for (const sensitive of ['secret-handle', 'private lesson', 'credential', 'private source text'])
      expect(serialized).not.toContain(sensitive)
  })

  it('does not persist unknown values even when they look like legal tool names or codes', () => {
    const run = { tools: [{
      call: { name: 'private.secret', input: { target: 'private', password: 'credential' } },
      state: 'secret-state',
      result: { kind: 'secret-result', code: 'secret-token-abc', message: 'private message' },
    }, {
      call: { name: 'build.create', input: { target: 'private' } }, state: 'returned',
      result: { kind: 'error', code: 'secret-token-abc', message: 'private message' },
    }] } as unknown as ExecutionRunRecord
    const serialized = JSON.stringify(relToolDiagnostics([run]))
    for (const sensitive of ['private.secret', 'secret-state', 'secret-result', 'secret-token-abc',
      'private message', 'credential']) expect(serialized).not.toContain(sensitive)
    expect(relToolDiagnostics([run])[1]?.errorCode).toBe('unrecognized')
  })
})
