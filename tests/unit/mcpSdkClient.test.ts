// @vitest-environment node
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readExplicitMcpConnection, requireCurrentProjectSave } from '../../scripts/mcpSdkClient'

describe('direct MCP SDK connection facts', () => {
  it('uses explicit ready/configuration credentials and retains the owner workspace', () => {
    expect(readExplicitMcpConnection({ endpoint: 'http://127.0.0.1:45888/mcp', token: 'explicit', workspaceId: 'existing-owner-space', pid: 123 }))
      .toEqual({ endpoint: 'http://127.0.0.1:45888/mcp', token: 'explicit', workspaceId: 'existing-owner-space' })
    expect(() => readExplicitMcpConnection({ endpoint: 'http://127.0.0.1:45888/mcp' })).toThrow('token')
  })
  it('requires the actual absolute save target and a current clean saved revision', () => {
    const filename = path.resolve('lesson.h5lesson')
    const data = { status: 'saved', path: filename, savedRevision: 4, currentRevision: 4, dirty: false }
    expect(() => requireCurrentProjectSave({ kind: 'read', data }, filename)).not.toThrow()
    expect(() => requireCurrentProjectSave({ kind: 'read', data: { ...data, savedRevision: 3, dirty: true } }, filename)).toThrow('尚未保存')
    expect(() => requireCurrentProjectSave({ kind: 'read', data }, path.resolve('other.h5lesson'))).toThrow('保存目标不符')
    expect(() => requireCurrentProjectSave({ kind: 'document-operation', result: { status: 'applied' } }, filename)).toThrow('保存回执')
  })
})
