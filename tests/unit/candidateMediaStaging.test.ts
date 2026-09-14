// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { CandidateStaging } from '../../src/main/localAgent/candidateStaging'
import { candidateMediaDeliveryAccess, candidateMediaDeliveryFiles } from '../../src/main/localAgent/candidateMediaDelivery'
import { generationCandidateSchema, generationRequestSchema, type GenerationRequest } from '../../src/shared/generationContract'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-media-'$ 空格-")); temporary.push(directory)
  const staging = new CandidateStaging(directory)
  const workspace = createWorkspaceIdentity('project', path.join(directory, 'lesson.h5lesson'))
  const request = generationRequestSchema.parse({ version: 1, requestId: randomUUID(), workspace, documentRevision: 1, sessionGeneration: 1,
    purpose: 'local-edit', intent: 'edit', instruction: '替换图片', allowedCarriers: ['native'], context: {},
    destinations: [{ kind: 'update', target: { projectId: workspace.projectId, documentRevision: 1, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
      surfaceType: 'slide', surfaceId: 'slides', locationId: 'page', stateId: null, owner: 'scene', ownerKey: 'scene:page', itemId: 'image', authoringAddress: 'page/image' } }],
  })
  const task = { taskId: randomUUID(), deadlineAt: Date.now() + 60_000 }
  const root = await staging.create(request, task)
  const bytes = await fs.readFile(path.resolve('examples/sample-counter-component/thumbnail.png'))
  await fs.mkdir(path.join(root, 'resources'), { recursive: true })
  return { directory, staging, request, root, task, bytes }
}
function candidate(request: GenerationRequest, reference: unknown = { $candidateFile: 'resources/dog.png' }) {
  return generationCandidateSchema.parse({ version: 1, requestId: request.requestId, candidateId: randomUUID(), summary: '替换图片',
    steps: [{ id: 'replace', carrier: 'native', tool: 'media.apply', destination: request.destinations[0], input: { kind: 'image', source: reference } }],
  })
}

describe('candidate media delivery and logical-task retention', () => {
  it('loads a project result JSON only from the current candidate root', async () => {
    const f = await fixture(), value = candidate(f.request)
    value.steps[0]!.tool = 'project.document'
    value.steps[0]!.input = { artifact: { $candidateFile: 'resources/result.json' } }
    await fs.writeFile(path.join(f.root, 'resources/result.json'), JSON.stringify({ document: { id: 'project' } }))
    expect((await f.staging.resolveMediaFiles(value, f.task)).steps[0]!.input).toEqual({ artifact: { document: { id: 'project' } } })
    const next = await f.staging.create({ ...f.request, requestId: randomUUID() }, f.task)
    const staged = JSON.parse(await fs.readFile(path.join(next, 'request.json'), 'utf8'))
    expect(staged.reusableArtifacts).toHaveLength(1)
    expect(staged).not.toHaveProperty('reusableMedia')
    expect(JSON.parse(await fs.readFile(path.join(next, staged.reusableArtifacts[0].source.$candidateFile), 'utf8'))).toEqual({ document: { id: 'project' } })
    value.steps[0]!.input = { artifact: { $candidateFile: '../other/result.json' } }
    await expect(f.staging.resolveMediaFiles(value)).rejects.toThrow()
  })
  it('runs the supplied launcher with spaces, Unicode, apostrophes and dollar signs without caller copy/encoding code', async () => {
    const f = await fixture(), source = path.join(f.directory, "工具'图片 $结果.png"), name = "小狗'结果 $1.png"
    await fs.writeFile(source, f.bytes)
    const executable = createRequire(import.meta.url)('electron') as string
    for (const [filename, content] of Object.entries(candidateMediaDeliveryFiles(executable))) await fs.writeFile(path.join(f.root, filename), content)
    const access = candidateMediaDeliveryAccess(f.root)
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    const output = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-Command', `${access.command} ${quote(source)} ${quote(name)}`], { windowsHide: true, encoding: 'utf8' })
      : execFileSync('sh', [access.launcher, source, name], { encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual({ $candidateFile: `resources/${name}` })
    expect(await fs.readFile(path.join(f.root, 'resources', name))).toEqual(f.bytes)
    expect(await fs.readFile(source)).toEqual(f.bytes)
    expect(access.command).toContain(process.platform === 'win32' ? "''" : "'\\''")
    // A syntactically broken candidate must not force the image tool to run again.
    await fs.writeFile(path.join(f.root, 'candidate.json'), '{broken candidate')
    expect(await f.staging.retainDeliveredMedia(f.request.requestId, f.task)).toBe(1)
    await f.staging.remove(f.request.requestId)
    const nextRoot = await f.staging.create({ ...f.request, requestId: randomUUID() }, f.task)
    const next = JSON.parse(await fs.readFile(path.join(nextRoot, 'request.json'), 'utf8'))
    expect(next.reusableMedia).toMatchObject([{ filename: name, mimeType: 'image/png' }])
  })

  it('retains only referenced media, rematerializes fresh references after rejection, and releases at task end', async () => {
    const f = await fixture()
    await fs.writeFile(path.join(f.root, 'resources/dog.png'), f.bytes)
    await fs.writeFile(path.join(f.root, 'resources/unrelated.txt'), 'not a referenced asset')
    const first = await f.staging.resolveMediaFiles(candidate(f.request), f.task)
    expect(first.steps[0]!.input).toMatchObject({ source: { filename: 'dog.png', mimeType: 'image/png', base64: f.bytes.toString('base64') } })
    await f.staging.resolveMediaFiles(candidate(f.request), f.task)
    await f.staging.remove(f.request.requestId)
    const nextRequest = { ...f.request, requestId: randomUUID() }, nextRoot = await f.staging.create(nextRequest, f.task)
    const next = JSON.parse(await fs.readFile(path.join(nextRoot, 'request.json'), 'utf8'))
    expect(next.reusableMedia).toHaveLength(1)
    expect(next.reusableMedia[0]).toMatchObject({ filename: 'dog.png', mimeType: 'image/png' })
    expect(next.reusableMedia[0].source.$candidateFile).toMatch(/^resources\/reused\//)
    expect(next.reusableMedia[0].source.$candidateFile).not.toBe('resources/dog.png')
    const reused = await f.staging.resolveMediaFiles(candidate(nextRequest, next.reusableMedia[0].source), f.task)
    expect(reused.steps[0]!.input).toEqual(first.steps[0]!.input)
    await f.staging.releaseTaskMedia(f.task.taskId)
    const otherRoot = await f.staging.create({ ...f.request, requestId: randomUUID() }, { ...f.task, taskId: randomUUID() })
    expect(JSON.parse(await fs.readFile(path.join(otherRoot, 'request.json'), 'utf8')).reusableMedia).toBeUndefined()
    await expect(fs.access(path.join(f.directory, 'task-media', f.task.taskId))).rejects.toThrow()
  })

  it.each(['missing', 'oversize', 'linked-directory', 'format'] as const)('rejects %s media with step-local diagnostics and no retained file', async scenario => {
    const f = await fixture()
    let ref = 'resources/dog.png'
    if (scenario === 'oversize') { await fs.writeFile(path.join(f.root, ref), f.bytes); await fs.truncate(path.join(f.root, ref), 12 * 1024 * 1024 + 1) }
    if (scenario === 'format') await fs.writeFile(path.join(f.root, ref), 'not image bytes')
    if (scenario === 'linked-directory') {
      const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'dog.png'), f.bytes)
      await fs.symlink(outside, path.join(f.root, 'resources/link'), process.platform === 'win32' ? 'junction' : 'dir'); ref = 'resources/link/dog.png'
    }
    await expect(f.staging.resolveMediaFiles(candidate(f.request, { $candidateFile: ref }), f.task)).rejects.toMatchObject({ failure: {
      stepId: 'replace', tool: 'media.apply', diagnostics: [{ code: 'candidate-media-file', path: ['steps', 0, 'input', 'source'] }],
    } })
    await expect(fs.access(path.join(f.directory, 'task-media', f.task.taskId))).rejects.toThrow()
  })

  it('does not reuse expired task media or follow a replaced retention directory', async () => {
    const f = await fixture()
    await fs.writeFile(path.join(f.root, 'resources/dog.png'), f.bytes)
    await f.staging.resolveMediaFiles(candidate(f.request), f.task)
    await expect(f.staging.create({ ...f.request, requestId: randomUUID() }, { ...f.task, deadlineAt: Date.now() })).rejects.toThrow('到期')
    await f.staging.releaseTaskMedia(f.task.taskId)
    const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'keep')
    await fs.symlink(outside, path.join(f.directory, 'task-media', f.task.taskId), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(f.staging.releaseTaskMedia(f.task.taskId)).rejects.toThrow('链接')
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('requires a strict delivery manifest, rejects expired retention, and never follows manifest file references outside this root', async () => {
    const f = await fixture(), manifest = path.join(f.root, 'delivered-media.jsonl')
    await fs.writeFile(path.join(f.root, 'resources/dog.png'), f.bytes)
    expect(await f.staging.retainDeliveredMedia(f.request.requestId, f.task)).toBe(0)
    await fs.writeFile(manifest, JSON.stringify({ version: 1, source: { $candidateFile: 'resources/dog.png' }, extra: true }) + '\n')
    await expect(f.staging.retainDeliveredMedia(f.request.requestId, f.task)).rejects.toThrow()
    await fs.writeFile(manifest, JSON.stringify({ version: 1, source: { $candidateFile: 'resources/../request.json' } }) + '\n')
    await expect(f.staging.retainDeliveredMedia(f.request.requestId, f.task)).rejects.toThrow()
    await fs.writeFile(manifest, JSON.stringify({ version: 1, source: { $candidateFile: 'resources/dog.png' } }) + '\n')
    await expect(f.staging.retainDeliveredMedia(f.request.requestId, { ...f.task, deadlineAt: Date.now() })).rejects.toThrow('到期')
    await expect(fs.access(path.join(f.directory, 'task-media', f.task.taskId))).rejects.toThrow()
  })
})
