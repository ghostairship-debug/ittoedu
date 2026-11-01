// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import { artifactDeliverySource, delegationArtifactSource } from '../../src/core/tools/HostArtifactTools'
import type { AgentFileContext } from '../../src/core/tools/AgentFileTools'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'
import { persistedToolWork } from '../../src/main/workbench/execution/executionOutcome'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })

it('uses internal default assembly, keeps group-relative files, and leaves explicit user destinations and file.write defaults unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-assembly-')); roots.push(root)
  const workspaceRoot = path.join(root, 'user'), directory = path.join(root, 'runs')
  await fs.mkdir(workspaceRoot)
  const runs = new ExecutionRunStore(directory), assemblyRoot = await runs.assemblyDirectory('a')
  const host = new DocumentHostService(path.join(root, 'documents')), deliveries = host.artifactDeliveries
  const grant: ToolRunGrant = { runId: 'a', actor: 'agent', documents: [], fileAccess: { workspaceRoot, permission: 'workspace', assemblyRoot } }
  await host.tools.beginRun(grant)
  const artifacts = new Map<string, Uint8Array>([
    ['pages/index.html', Buffer.from('<link rel="stylesheet" href="../style.css"><h1>Assembled</h1>')],
    ['style.css', Buffer.from('h1 { color: #195d6a; }')],
  ])
  const services: HostToolServices = {
    artifacts: {
      assemblyDestination: ({ grant, job, name }) => deliveries.assemblyDestination({ assemblyRoot: grant.fileAccess!.assemblyRoot!, job, name }),
      lookup: (runId, operationId) => deliveries.lookup(operationId, runId),
      preflight: ({ grant, destination }) => deliveries.preflight({ workspaceRoot: grant.fileAccess!.workspaceRoot!,
        assemblyRoot: grant.fileAccess!.assemblyRoot, permission: grant.fileAccess!.permission, destination }),
      save: ({ grant, operationId, source, bytes, assertActive }) => deliveries.deliver({ runId: grant.runId, operationId,
        workspaceRoot: grant.fileAccess!.workspaceRoot!, assemblyRoot: grant.fileAccess!.assemblyRoot,
        permission: grant.fileAccess!.permission, destination: source.destination, ...artifactDeliverySource(source), bytes, assertActive }),
    },
    delegation: { availability: () => ({ ready: false, reason: 'No model in fixture' }),
      startManaged: async () => { throw new Error('Unused') }, cancel: async () => { throw new Error('Unused') }, cancelRun: async () => undefined,
      readArtifact: async (runId, _jobId, name) => {
        if (runId !== 'a' || !artifacts.has(name)) throw new Error('Not authorized')
        const bytes = artifacts.get(name)!
        return { artifact: { name, digest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength }, bytes }
      } },
  }
  const coordinator = new HostToolCoordinator(services, host.registry, {} as never)
  await coordinator.beginRun(grant)
  const save = async (job: string, name: string, operation: string, destination?: string) => {
    const input = { source: delegationArtifactSource(job, name), ...(destination ? { destination } : {}) }
    const preflight = await coordinator.preflightArtifactSave('a', input)
    expect(preflight.approvalRequired).toBe(false)
    const result = await coordinator.saveArtifact('a', operation, operation, input)
    expect(result).toMatchObject({ kind: 'read', data: { status: 'written', path: preflight.path } })
    if (!destination) {
      expect(result).toMatchObject({ data: { purpose: 'assembly' } })
      expect(persistedToolWork('artifact.save', result)).toBe(false)
      expect(await deliveries.lookup(operation, 'a')).toMatchObject({ purpose: 'assembly' })
    } else expect(persistedToolWork('artifact.save', result)).toBe(true)
    return preflight.path
  }
  const entry = await save('delegate-one', 'pages/index.html', 'entry'), css = await save('delegate-one', 'style.css', 'css')
  expect(path.resolve(path.dirname(entry), '../style.css')).toBe(css)
  expect(path.relative(assemblyRoot, entry)).not.toMatch(/^\.\./)
  const second = await save('delegate-two', 'pages/index.html', 'other-entry')
  expect(second).not.toBe(entry)
  expect(await fs.readdir(workspaceRoot)).toEqual([])
  const context: AgentFileContext = { runId: 'a', workspaceRoot, permission: 'workspace', assemblyRoot }
  expect(Buffer.from((await host.agentFiles.readAuthorizedFile(context, entry)).bytes)).toEqual(Buffer.from(artifacts.get('pages/index.html')!))
  expect(await host.agentFiles.resolveReadPath(context, entry)).toBe(entry)
  const userFile = await save('delegate-one', 'pages/index.html', 'deliver', 'result.html')
  expect(userFile).toBe(path.join(workspaceRoot, 'result.html'))
  const write = { mode: 'create' as const, path: 'notes.md', content: 'User-requested file' }
  expect(await host.agentFiles.execute({ ...context, operationCall: { name: 'file.write', input: write } }, 'file.write', write, 'user-write'))
    .toMatchObject({ data: { saved: true, path: path.join(workspaceRoot, 'notes.md') } })
  expect(await fs.readFile(path.join(workspaceRoot, 'notes.md'), 'utf8')).toBe('User-requested file')
  const internalWrite = { mode: 'create' as const, path: path.join(assemblyRoot, 'merge.html'), content: '<h1>Mechanical assembly</h1>' }
  const internal = await host.agentFiles.execute(context, 'file.write', internalWrite, 'internal-write')
  expect(internal).toMatchObject({ data: { saved: true, purpose: 'assembly' } })
  expect(persistedToolWork('file.write', { kind: 'read', data: internal.data })).toBe(false)
  await deliveries.stopRun('a')
  expect(await new ExecutionRunStore(directory).readAssemblyDirectory('a')).toBe(assemblyRoot)
  expect(await fs.readFile(entry)).toEqual(artifacts.get('pages/index.html'))
  expect(await runs.readAssemblyDirectory('historical-without-assembly')).toBeNull()
})

it('grants only the current assembly for writes and preserves a predecessor as read-only even in full mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-assembly-scope-')); roots.push(root)
  const workspaceRoot = path.join(root, 'user'); await fs.mkdir(workspaceRoot)
  const runs = new ExecutionRunStore(path.join(root, 'runs')), oldRoot = await runs.assemblyDirectory('old'), currentRoot = await runs.assemblyDirectory('current')
  const original = path.join(oldRoot, 'recover.txt'); await fs.writeFile(original, 'Recovery input')
  const host = new DocumentHostService(path.join(root, 'documents'))
  const current: AgentFileContext = { runId: 'current', workspaceRoot, assemblyRoot: currentRoot,
    readOnlyRoots: [oldRoot], permission: 'workspace' }
  await host.tools.beginRun({ runId: current.runId, actor: 'agent', documents: [],
    fileAccess: { workspaceRoot, assemblyRoot: currentRoot, assemblyReadRoots: [oldRoot], permission: 'workspace' } })
  expect(Buffer.from((await host.agentFiles.readAuthorizedFile(current, original)).bytes).toString()).toBe('Recovery input')
  const mutation = { mode: 'replace' as const, path: original, content: 'Must not replace recovery input' }
  await expect(host.agentFiles.execute({ ...current, permission: 'full', operationCall: { name: 'file.write', input: mutation } },
    'file.write', mutation, 'no-ancestor-write')).rejects.toThrow('明确批准')
  await expect(host.agentFiles.readAuthorizedFile({ ...current, readOnlyRoots: [] }, original)).rejects.toThrow('工作空间外')
  await expect(host.artifactDeliveries.preflight({ workspaceRoot, assemblyRoot: currentRoot, readOnlyRoots: [oldRoot],
    permission: 'full', destination: path.join(oldRoot, 'late.txt') })).rejects.toThrow('只读来源目录')
  const target = path.join(currentRoot, 'new.txt')
  expect(await host.agentFiles.preflightMutation(current, 'file.write', { mode: 'create', path: target, content: 'new' }))
    .toMatchObject({ paths: [target], outside: false })
  await expect(host.agentFiles.preflightMutation({ ...current, permission: 'read-only' }, 'file.write',
    { mode: 'create', path: target, content: 'new' })).rejects.toThrow('只读')
  expect(await fs.readFile(original, 'utf8')).toBe('Recovery input')
  // A swapped directory cannot turn this root into another run's authority.
  const alias = path.join(currentRoot, 'escaped')
  try { await fs.symlink(oldRoot, alias, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return; throw error }
  await expect(host.artifactDeliveries.preflight({ workspaceRoot, assemblyRoot: currentRoot, permission: 'workspace',
    destination: path.join(alias, 'escaped.txt') })).rejects.toThrow('符号链接')
})
