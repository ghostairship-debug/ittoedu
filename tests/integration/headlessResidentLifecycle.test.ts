// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { residentMcpFixture } from '../helpers/residentMcpFixture'

it('binds a no-UI resident to its explicit root while GUI connection facts continue to follow the existing UI owner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'headless-mcp-root-'))
  let close: (() => Promise<void>) | undefined
  try {
    const first = path.join(directory, 'first'), second = path.join(directory, 'second')
    await mkdir(first); await mkdir(second)
    const f = await residentMcpFixture({ host: new DocumentHostService(path.join(directory, 'documents')), directory, workspaceRoot: first })
    close = f.close
    await f.conversations.registerWorkspace({ workspaceId: 'second', rootPath: await realpath(second), managed: false, authorization: 'user-selected' })
    await f.service.setInitialWorkspace('second')
    f.ui.state = null
    expect(await f.service.connectionInfo()).toMatchObject({ workspaceId: 'second', workspace: await realpath(second), permission: 'workspace' })
    const client = await f.connect()
    expect((await f.service.status()).sessions[0]).toMatchObject({ workspaceId: 'second' })
    f.ui.state = { workspaceId: 'space' }
    expect(await f.service.connectionInfo()).toMatchObject({ workspaceId: 'space', workspace: await realpath(first) })
    await client.close()
    expect((await f.service.status()).state).toBe('running')
  } finally { await close?.(); await rm(directory, { recursive: true, force: true }) }
})

it('normal service close waits for an already-received file operation and its receipt instead of just closing the transport', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'headless-mcp-stop-'))
  let close: (() => Promise<void>) | undefined, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered = false
  try {
    const workspace = path.join(directory, 'workspace'); await mkdir(workspace)
    const f = await residentMcpFixture({ host: new DocumentHostService(path.join(directory, 'documents')), directory, workspaceRoot: workspace,
      appendEvent: async event => {
        if (event.type === 'tool' && event.data.status === 'completed' && event.data.toolName === 'file.write') { entered = true; await gate }
      } })
    close = f.close
    const client = await f.connect()
    const write = client.callTool({ name: 'file.write', arguments: { mode: 'create', path: 'received.md', content: 'received before stop' } }).catch(() => undefined)
    await expect.poll(() => entered).toBe(true)
    let finished = false
    const stopping = f.service.close().then(() => { finished = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(finished).toBe(false)
    release()
    await stopping; await write
    expect(await readFile(path.join(workspace, 'received.md'), 'utf8')).toBe('received before stop')
  } finally { release(); await close?.(); await rm(directory, { recursive: true, force: true }) }
})
