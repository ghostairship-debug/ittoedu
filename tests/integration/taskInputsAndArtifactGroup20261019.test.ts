// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { freezeTaskInputs, freezeComputeInputs, type TaskInputFreezePorts } from '../../src/main/workbench/delegation/freezeTaskInputs'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { artifactGroupInput } from '../../src/core/tools/artifactGroup'
import { HostToolCoordinator } from '../../src/core/tools/HostToolServices'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { TextDriver } from '../../src/core/drivers/TextDriver'

const encode = (text: string) => new TextEncoder().encode(text)
const ports = (overrides: Partial<TaskInputFreezePorts> = {}): TaskInputFreezePorts => ({ assertActive() {}, isMaterial: () => false,
  material: vi.fn(), authorize: async source => path.resolve(source), opened: async () => undefined,
  disk: vi.fn(async () => ({ name: 'disk.txt', bytes: encode('disk'), version: 'disk-v1' })), ...overrides })
const snapshot = (model: DocumentSnapshot['model']): DocumentSnapshot => ({ documentId: 'doc', epoch: 'epoch', revision: 4,
  model, binding: { kind: 'file', path: path.resolve('deleted.md'), version: 'old', bindingVersion: 1 }, dirty: true } as DocumentSnapshot)

it('authorizes then captures an opened current source even after the disk file disappeared, retaining resources', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'task-current-'))
  try {
    const file = path.join(root, 'deleted.md')
    const files = new AgentFileService({} as never)
    const context = { runId: 'run', workspaceRoot: root, permission: 'workspace' as const }
    const disk = vi.fn(async () => { throw new Error('disk must not be required') })
    const opened = vi.fn(async () => snapshot({ kind: 'markdown', source: 'UNSAVED\n![img](assets/a.svg)',
      resources: { assets: { 'assets/a.svg': encode('<svg/>') }, components: {} } }))
    const inputs = await freezeTaskInputs([file], ports({ authorize: source => files.authorizeTaskInput(context, source), opened, disk }))
    expect(new TextDecoder().decode(inputs[0]!.bytes)).toContain('UNSAVED')
    expect(inputs.map(input => input.name)).toEqual(['deleted.md.current/deleted.md', 'deleted.md.current/assets/a.svg'])
    expect(inputs[1]?.modelRepresentation?.text).toBe('<svg/>')
    expect(opened).toHaveBeenCalledWith(file)
    expect(disk).not.toHaveBeenCalled()
    const forbidden = path.resolve(root, '..', 'forbidden.md')
    await expect(files.authorizeTaskInput(context, forbidden)).rejects.toThrow('当前权限')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('freezes current V10 formal projection and resources, while explicit disk selection uses the file owner', async () => {
  const project = createBlankCourseProjectV10('CURRENT TITLE', () => 'fixture')
  project.assets['asset'] = { id: 'asset', path: 'assets/a.svg', mimeType: 'image/svg+xml' }
  const opened = vi.fn(async () => snapshot({ kind: 'course-v10', project, resources: { assets: { asset: encode('<svg/>') }, components: {} } }))
  const owner = ports({ opened })
  const current = await freezeTaskInputs(['course.glx'], owner)
  expect(current.some(input => input.name.endsWith('/project.json') && new TextDecoder().decode(input.bytes).includes('CURRENT TITLE'))).toBe(true)
  expect(current.find(input => input.name.endsWith('/assets/a.svg'))?.bytes).toEqual(encode('<svg/>'))
  expect(owner.disk).not.toHaveBeenCalled()
  const disk = await freezeTaskInputs(['course.glx'], owner, { sourceVersion: 'disk' })
  expect(new TextDecoder().decode(disk[0]!.bytes)).toBe('disk')
  expect(opened).toHaveBeenCalledTimes(1)
})

it('retains the complete attachment original separately from its bounded model representation and supports cancellation', async () => {
  const original = new Uint8Array(90_000).fill(13); original[89_999] = 41
  const owner = ports({ isMaterial: () => true, material: async () => ({ name: 'book.pdf', mimeType: 'application/pdf',
    bytes: original, version: 'attachment-v1', representation: '{"range":"first page","omissions":["later pages"]}' }) })
  const result = await freezeTaskInputs(['attachment-id'], owner)
  expect(result[0]!.bytes).toEqual(original)
  expect(result[0]!.name).toBe('book.pdf')
  expect(result[0]!.modelRepresentation).toMatchObject({ text: expect.stringContaining('omissions'), read: { source: 'attachment-id' } })
  const controller = new AbortController(); controller.abort()
  await expect(freezeTaskInputs(['attachment-id'], owner, { signal: controller.signal })).rejects.toThrow()
})

it('passes the current dirty Source to computation through the shared freeze owner without saving', async () => {
  let nextId = 0
  const save = vi.fn(), registry = new DocumentRegistry({ drivers: [new TextDriver()], createId: () => `compute-source-${nextId++}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, save } })
  const session = await registry.open({ kind: 'file', path: path.resolve('numbers.txt'), version: 'disk-v1', bindingVersion: 1 },
    async () => ({ kind: 'text', source: '[1]', resources: { assets: {}, components: {} } }))
  const before = session.read()
  await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, actor: 'human', operationId: 'teacher-draft',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: '[10,20]' } } })
  const dirty = session.read(), inputOwner = ports({ opened: () => session.drain() })
  const start = vi.fn(async (input: { inputs?: readonly { name: string; bytes: Uint8Array }[]; runId: string; jobId: string }) => {
    expect(input.inputs?.[0]?.name).toBe('numbers.txt')
    const numbers = JSON.parse(new TextDecoder().decode(input.inputs![0]!.bytes)) as number[]
    expect(numbers.reduce((sum, value) => sum + value, 0)).toBe(30)
    return { runId: input.runId, jobId: input.jobId, requestDigest: 'fixture', status: 'ready' as const, stopped: false,
      outputNames: [], artifacts: [], createdAt: '', updatedAt: '' }
  })
  const host = new HostToolCoordinator({ computeInputs: { freeze: (_runId, sources) => freezeComputeInputs(sources,
    (selected, options) => freezeTaskInputs(selected, inputOwner, options)) },
    compute: { start, readArtifact: vi.fn(), cancel: vi.fn(), cancelRun: vi.fn() } }, registry, {} as never)
  await host.beginRun({ runId: 'compute-parent', actor: 'agent', documents: [], fileAccess: { permission: 'full', workspaceRoot: path.resolve('.') } })
  expect(await host.runCompute('compute-parent', 'calculate-current', { language: 'python', code: 'print(sum(numbers))', sources: ['numbers.txt'] }))
    .toMatchObject({ kind: 'read', data: { status: 'ready' } })
  expect(start).toHaveBeenCalledOnce()
  expect(inputOwner.disk).not.toHaveBeenCalled()
  expect(session.read()).toMatchObject({ revision: dirty.revision, dirty: true, undoDepth: 1, model: { source: '[10,20]' } })
  expect(save).not.toHaveBeenCalled()
})

it('passes raw group bytes and relative dependencies into the existing content input without saving files', () => {
  const binary = new Uint8Array([0, 255, 7])
  const input = artifactGroupInput('pages/demo.html', [{ name: 'pages/demo.html', bytes: encode('<link href="../style.css"><img src="../assets/a.bin">') },
    { name: 'style.css', bytes: encode('body{color:red}') }, { name: 'assets/a.bin', bytes: binary }])
  expect(input.text).toContain('../style.css')
  expect(input.siblingFiles?.get('../style.css')).toEqual(encode('body{color:red}'))
  expect(input.siblingFiles?.get('../assets/a.bin')).toEqual(binary)
  binary[0] = 9
  expect(input.siblingFiles?.get('../assets/a.bin')?.[0]).toBe(0)
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<html><body>完整原文</body></html>', 'utf16le')])
  expect(artifactGroupInput('encoded.html', [{ name: 'encoded.html', bytes: utf16 }]).text).toContain('完整原文')
})

it('reads a Continue producer group with its original owner and rejects unrelated readers', async () => {
  const registry = new DocumentRegistry({ drivers: [], createId: () => 'unused', bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No document writes') } } })
  const readArtifact = vi.fn(async (runId: string, _job: string, name: string) => {
    expect(runId).toBe('producer')
    return { artifact: { name, digest: name, byteLength: 1 }, bytes: encode(name) }
  })
  const host = new HostToolCoordinator({ jobs: { status: vi.fn(async ref => {
    if (ref.runId !== 'producer') throw Object.assign(new Error('unauthorized'), { code: 'job-not-authorized' })
    return { kind: 'delegation', terminal: true, snapshot: { status: 'ready', stopped: false,
      artifacts: [{ name: 'entry.html', digest: 'a', byteLength: 10 }, { name: 'dep.css', digest: 'b', byteLength: 7 }] } } as never
  }), wait: vi.fn(), logs: vi.fn(), cancel: vi.fn() }, delegation: { availability: () => ({ ready: true, reason: '' }),
    startManaged: vi.fn(), readArtifact, cancel: vi.fn(), cancelRun: vi.fn() } }, registry, {} as never)
  await host.beginRun({ runId: 'continue', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: path.resolve('.') } })
  host.authorizeContinuationReads('continue', ['producer'])
  expect((await host.readArtifactGroup('continue', 'delegate-job@entry.html'))?.siblingFiles?.size).toBe(2)
  expect(readArtifact).toHaveBeenCalledTimes(2)
  expect(await host.readArtifactGroup('continue', 'ordinary/file.html')).toBeNull()
  await host.beginRun({ runId: 'stranger', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: path.resolve('.') } })
  await expect(host.readArtifactGroup('stranger', 'delegate-job@entry.html')).rejects.toThrow('unauthorized')
})
