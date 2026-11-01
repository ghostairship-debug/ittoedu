// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { computeArtifactSource, delegationArtifactSource } from '../../src/core/tools/HostArtifactTools'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import { fileResourceMime } from '../../src/shared/document/fileResourceMime'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { testContainerInstance } from '../helpers/glxWorkFixture'

const encode = (text: string) => new TextEncoder().encode(text)
function model(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}

async function fixture(kind: 'delegation' | 'compute') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-artifact-route-'))
  const host = new DocumentHostService(path.join(root, 'documents'))
  const project = createBlankCourseProjectV10('Direct sealed group')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.teacher = { id: 'teacher', definitionId: TEXT_DEFINITION.id,
    data: textDataEdit('teacher', createTextComponentData('保留人工标题')).value,
    frame: { width: 300, height: 70, transform: [1, 0, 0, 1, 40, 30] } }
  testContainerInstance(project, 0).childIds.push('teacher')
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'source.glx')
  const jobId = kind === 'delegation' ? 'delegate-sealed-fixture' : 'compute-sealed-fixture'
  const source = (name: string) => (kind === 'delegation' ? delegationArtifactSource : computeArtifactSource)(jobId, name)
  const imageBytes = await fs.readFile(path.resolve('tests/fixtures/g20M17/local-media.png'))
  const files = new Map<string, Uint8Array>([
    ['pages/experiment.html', encode('<!doctype html><html><head><link rel="stylesheet" href="../style.css"></head><body><h2>子任务实验</h2><img src="../moon.png" alt="月球"><button id="result">运行实验</button><script type="module" src="../main.js"></script></body></html>')],
    ['style.css', encode('body{margin:0;padding:20px;color:#194f68}button{padding:12px}')],
    ['main.js', encode('import {label} from "./helper.js";document.getElementById("result").onclick=()=>document.getElementById("result").textContent=label;')],
    ['helper.js', encode('export const label="sealed-helper-label-v1";')],
    ['moon.png', imageBytes],
  ])
  const artifacts = [...files].map(([name, bytes]) => ({ name, digest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, mimeType: fileResourceMime(name) }))
  let status = 'ready', stopped = false, readFailure: Error | undefined
  const authorized = (runId: string, requestedJob: string) => {
    if (runId !== 'owner' || requestedJob !== jobId) throw Object.assign(new Error('fixture job not authorized'), { code: 'job-not-authorized' })
  }
  const readArtifact = vi.fn(async (runId: string, requestedJob: string, name: string) => {
    authorized(runId, requestedJob)
    if (readFailure) throw readFailure
    if (status !== 'ready' || stopped) throw new Error('fixture artifact not ready')
    const artifact = artifacts.find(file => file.name === name)
    if (!artifact) throw new Error('fixture artifact not sealed')
    return { artifact, bytes: files.get(name)! }
  })
  const unused = async (): Promise<never> => { throw new Error('No generation or job mutation in this fixture') }
  const services: HostToolServices = {
    jobs: { status: async ref => {
      authorized(ref.runId, ref.jobId)
      if (ref.kind !== kind) throw new Error('fixture job kind mismatch')
      return { kind, jobId, status, terminal: true, snapshot: { jobId, status, stopped, artifacts } }
    }, wait: unused, logs: unused, cancel: unused },
    ...(kind === 'delegation'
      ? { delegation: { availability: () => ({ ready: false, reason: 'No model in fixture' }), startManaged: unused, readArtifact, cancel: unused, cancelRun: async () => undefined } }
      : { compute: { start: unused, readArtifact, cancel: unused, cancelRun: async () => undefined } }),
  }
  host.tools.configureHostServices(services)
  let serial = 0
  const tool = (name: string, input: unknown, runId = 'owner') => host.tools.execute(runId, `route-${++serial}`, { name, input })
  const current = () => host.internalAPI.read(initial.documentId)
  const pagePath = async () => {
    const snapshot = await current(), entry = componentProjectFiles(model(snapshot).project, model(snapshot).resources).find(file => file.kind === 'structure')!
    return entry.path
  }
  const begin = async (runId: string) => {
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies(runId, ['content'])
    await tool('project.read', { path: await pagePath() }, runId)
  }
  await begin('owner')
  return { root, host, initial, source, files, tool, current, pagePath, begin, readArtifact,
    setOutcome: (next: string, isStopped = false) => { status = next; stopped = isStopped },
    failRead: (error: Error | undefined) => { readFailure = error },
    close: async () => {
      await Promise.allSettled(['owner', 'stranger'].map(runId => host.tools.stop(runId)))
      await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
    },
  }
}

it.each(['delegation', 'compute'] as const)('inserts %s HTML directly with its sealed relative dependencies and still inserts its real image as an image', async kind => {
  const f = await fixture(kind)
  try {
    const applied = await f.tool('project.apply', { path: await f.pagePath(), intent: 'insert', from: f.source('pages/experiment.html') })
    expect(applied, JSON.stringify(applied)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const inserted = await f.current(), content = model(inserted)
    expect(inserted.undoDepth).toBe((f.initial.undoDepth ?? 0) + 1)
    expect(content.project.instances.teacher).toEqual(model(f.initial).project.instances.teacher)
    const savedText = [JSON.stringify(content.project), ...Object.values(content.resources.components).flatMap(files => Object.values(files).map(bytes => new TextDecoder().decode(bytes)))].join('\n')
    expect(savedText).toContain('子任务实验')
    expect(savedText).toContain('sealed-helper-label-v1')
    expect(savedText).toContain('#194f68')
    expect(Object.values(content.resources.assets).some(bytes => Buffer.from(bytes).equals(Buffer.from(f.files.get('moon.png')!)))).toBe(true)
    expect(new Set(f.readArtifact.mock.calls.map(call => call[2]))).toEqual(new Set(f.files.keys()))
    await expect(fs.stat(path.join(f.root, 'pages', 'experiment.html'))).rejects.toMatchObject({ code: 'ENOENT' })

    const beforeImages = Object.values(content.project.instances).filter(instance => instance.definitionId === IMAGE_DEFINITION.id).length
    f.readArtifact.mockClear()
    await f.tool('project.read', { path: await f.pagePath() })
    const image = await f.tool('project.apply', { path: await f.pagePath(), intent: 'insert', from: f.source('moon.png') })
    expect(image, JSON.stringify(image)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const finished = model(await f.current())
    expect(Object.values(finished.project.instances).filter(instance => instance.definitionId === IMAGE_DEFINITION.id)).toHaveLength(beforeImages + 1)
    expect(f.readArtifact.mock.calls.every(call => call[2] === 'moon.png')).toBe(true)
    const filename = path.join(f.root, 'delivered.glx')
    await f.host.internalAPI.save(f.initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(f.root, 'cold')).internalAPI.open(filename)
    expect(model(reopened)).toEqual(finished)
  } finally { await f.close() }
})

it.each(['delegation', 'compute'] as const)('keeps %s foreign, unknown, stopped and unreadable owners rejected without fallback writes', async kind => {
  const f = await fixture(kind)
  try {
    const before = await f.current(), input = { path: await f.pagePath(), intent: 'insert', from: f.source('pages/experiment.html') }
    await f.begin('stranger')
    expect(await f.tool('project.apply', input, 'stranger')).toMatchObject({ kind: 'error', message: expect.stringContaining('not authorized') })
    expect(f.readArtifact).not.toHaveBeenCalled()
    f.setOutcome('unknown')
    expect(await f.tool('project.apply', input)).toMatchObject({ kind: 'error' })
    expect(f.readArtifact).not.toHaveBeenCalled()
    f.setOutcome('ready', true)
    expect(await f.tool('project.apply', input)).toMatchObject({ kind: 'error' })
    expect(f.readArtifact).not.toHaveBeenCalled()
    f.setOutcome('ready')
    f.failRead(new Error('fixture media read outcome unknown'))
    expect(await f.tool('project.apply', { ...input, from: f.source('moon.png') }))
      .toMatchObject({ kind: 'error', message: expect.stringContaining('fixture media read outcome unknown') })
    expect(await f.current()).toEqual(before)
  } finally { await f.close() }
})
