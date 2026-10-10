// @vitest-environment node
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { connectExplicitMcp, readExplicitMcpConnection, requireCurrentProjectSave } from '../../scripts/mcpSdkClient'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { residentMcpFixture } from '../helpers/residentMcpFixture'

describe('direct MCP SDK connection facts', () => {
  it('calls the actual resident schema with flat arguments and detaches without stopping its owner', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-mcp-sdk-example-'))
    let fixture: Awaited<ReturnType<typeof residentMcpFixture>> | undefined
    let sdk: Awaited<ReturnType<typeof connectExplicitMcp>> | undefined
    try {
      const workspace = path.join(directory, 'workspace'); await mkdir(workspace)
      await writeFile(path.join(workspace, 'example.md'), 'Existing editable document')
      fixture = await residentMcpFixture({ host: new DocumentHostService(path.join(directory, 'documents')), directory, workspaceRoot: workspace })
      const connection = readExplicitMcpConnection({ endpoint: (await fixture.service.status()).endpoint })
      sdk = await connectExplicitMcp(connection)
      const opened = await sdk.call('file.open', { path: 'example.md' })
      expect(opened.isError).toBe(false)
      expect(opened.structuredContent).toMatchObject({ result: { kind: 'read', data: { target: expect.any(String), writable: true } } })
      await sdk.detach(); sdk = undefined
      expect((await fixture.service.status()).state).toBe('running')
      expect(fixture.service.server.listeningPort).toBeGreaterThan(0)
    } finally {
      await sdk?.detach(); await fixture?.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('uses explicit ready/configuration without credentials and retains the owner workspace', () => {
    expect(readExplicitMcpConnection({ endpoint: 'http://127.0.0.1:45888/mcp', workspaceId: 'existing-owner-space', pid: 123 }))
      .toEqual({ endpoint: 'http://127.0.0.1:45888/mcp', workspaceId: 'existing-owner-space' })
    expect(readExplicitMcpConnection({ endpoint: 'http://127.0.0.1:45888/mcp' })).not.toHaveProperty('token')
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
