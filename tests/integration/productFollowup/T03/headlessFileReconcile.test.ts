// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { DocumentDeliveryService } from '../../../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { connectExplicitMcp, readExplicitMcpConnection } from '../../../../scripts/mcpSdkClient'
import { residentMcpFixture } from '../../../helpers/residentMcpFixture'

it('headless public MCP compares real disk changes, reconciles disk or local then saves in the same task while stale CAS and Stop prevent overwrite', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T03-headless-reconcile-'))
  let fixture: Awaited<ReturnType<typeof residentMcpFixture>> | undefined, client: Awaited<ReturnType<typeof connectExplicitMcp>> | undefined
  let releaseStop: (() => void) | undefined
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const unused = async (): Promise<never> => { throw new Error('Export writer is not used by the real save route') }
    const deliveries = new DocumentDeliveryService({ documents: { read: host.internalAPI.read,
      saveWithFact: (id, filename, identity) => host.saveWithFact(id, filename, identity), lookupSave: (id, identity) => host.lookupSave(id, identity),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
      operations: new DocumentDeliveryOperationStore(path.join(directory, 'delivery')), authorize: async () => undefined,
      resolveSaveDestination: async ({ snapshot }) => snapshot.binding.kind === 'file' ? snapshot.binding.path : undefined,
      resolveExportDestination: async () => null, build: { build: unused }, writer: { writeNew: unused, inspect: unused } })
    host.tools.configureHostServices({ deliveries })
    let reachedStop!: () => void
    const stopping = new Promise<void>(resolve => { reachedStop = resolve })
    const held = new Promise<void>(resolve => { releaseStop = resolve })
    fixture = await residentMcpFixture({ host, directory, workspaceRoot: workspace, files: real => ({
      execute: async (...args) => { if (args[1] === 'file.reconcile' && (args[2] as { path?: string }).path === 'stopped.md') { reachedStop(); await held }
        return real.execute(...args) }, preflightMutation: real.preflightMutation.bind(real), releaseRun: real.releaseRun.bind(real),
    }) })
    client = await connectExplicitMcp(readExplicitMcpConnection({ endpoint: (await fixture.service.status()).endpoint }))
    const data = (reply: Awaited<ReturnType<NonNullable<typeof client>['call']>>) => (reply.structuredContent?.result as { data: any }).data
    const open = async (name: string) => {
      const opened = await client!.call('file.open', { path: name }); expect(opened.isError, JSON.stringify(opened)).toBe(false)
      const target = data(opened).target
      const children = await client!.call('listChildren', { target }); expect(children.isError).toBe(false)
      const range = data(children)[0].target
      const edited = await client!.call('text.replace', { target: range, content: `Local ${name}\n` })
      expect(edited.structuredContent, JSON.stringify(edited)).toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
      return target
    }
    for (const choice of ['disk', 'local'] as const) {
      const name = `${choice}.md`, filename = path.join(workspace, name)
      await fs.writeFile(filename, `Original ${name}\n`)
      const target = await open(name)
      await fs.writeFile(filename, `External ${name}\n`)
      expect((await client.call('file.save', { target })).isError).toBe(true)
      const observed = await client.call('file.observe', { path: name })
      expect(observed.isError, JSON.stringify(observed)).toBe(false)
      expect(data(observed)).toMatchObject({ observation: 'current-and-disk-compared', changed: true, choices: ['disk', 'local'],
        current: { source: `Local ${name}\n`, dirty: true }, disk: { source: `External ${name}\n`, exists: true } })
      expect((await client.call('file.reconcile', { path: name, choice, expectedVersion: 'not-the-observed-version' })).isError).toBe(true)
      await fs.writeFile(filename, `External again ${name}\n`)
      expect((await client.call('file.reconcile', { path: name, choice })).isError).toBe(true)
      expect(await fs.readFile(filename, 'utf8')).toBe(`External again ${name}\n`)
      expect((await client.call('file.observe', { path: name })).isError).toBe(false)
      const reconciled = await client.call('file.reconcile', { path: name, choice })
      expect(reconciled.isError, JSON.stringify(reconciled)).toBe(false)
      expect(data(reconciled)).toMatchObject({ status: 'reconciled', saved: false, choice })
      const saved = await client.call('file.save', { target: data(reconciled).target })
      expect(saved.isError, JSON.stringify(saved)).toBe(false)
      expect(data(saved)).toMatchObject({ status: 'saved', dirty: false })
      const expected = choice === 'disk' ? `External again ${name}\n` : `Local ${name}\n`
      expect(await fs.readFile(filename, 'utf8')).toBe(expected)
      expect((await new DocumentHostService(path.join(directory, `cold-${choice}`)).open(filename)).model).toMatchObject({ kind: 'markdown', source: expected })
    }
    const stopped = path.join(workspace, 'stopped.md'); await fs.writeFile(stopped, 'Original stopped.md\n')
    await open('stopped.md'); await fs.writeFile(stopped, 'External stopped.md\n')
    expect((await client.call('file.observe', { path: 'stopped.md' })).isError).toBe(false)
    const pending = client.call('file.reconcile', { path: 'stopped.md', choice: 'disk' }).then(value => value, error => error)
    await stopping
    const session = (await fixture.service.status()).sessions[0]
    await fixture.service.stopSession(session.sessionId)
    releaseStop!()
    const late = await pending
    expect(late instanceof Error || late.isError, JSON.stringify(late)).toBe(true)
    expect(host.registry.list().find(snapshot => snapshot.binding.kind === 'file' && snapshot.binding.path === stopped)?.model)
      .toMatchObject({ kind: 'markdown', source: 'Local stopped.md\n' })
    expect(await fs.readFile(stopped, 'utf8')).toBe('External stopped.md\n')
  } finally {
    releaseStop?.(); await client?.detach(); await fixture?.close()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
