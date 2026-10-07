// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { ScopedSkillService } from '../../src/main/workbench/skills/ScopedSkillService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { slidePageFiles } from '../../src/core/projectFiles/projectFileView'
const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })

it('reading the course method exposes project files before opening a course and keeps read-only authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-course-method-')); directories.push(root)
  const host = new DocumentHostService(path.join(root, 'journals'))
  const project = createBlankCourseProject({ title: '四季' })
  const controller = createDefaultTeacherControllerPackage()
  const session = await host.registry.create({ kind: 'course-v9', project, resources: { assets: {},
    components: { [`${controller.manifest.id}@${controller.manifest.version}`]: controller.files } } }, '四季.h5lesson')
  const initialRevision = session.read().revision
  const skills = new BundledSkillService({ manifest: { skills: [
    { name: 'orchestrate-courseware', description: '创作', path: 'skills/orchestrate-courseware/SKILL.md', references: [], version: 'one' },
    { name: 'build-courseware-project', description: '导入', path: 'skills/build-courseware-project/SKILL.md', references: [], version: 'one' },
  ] }, files: { 'skills/orchestrate-courseware/SKILL.md': '创作方法', 'skills/build-courseware-project/SKILL.md': '导入方法' } })
  let observations = 0
  host.tools.configureHostServices({ skills, observations: {
    observe: async input => {
      observations++
      expect(input.locationId).toBe(slidePageFiles(project)[0]!.locationId)
      return { source: 'isolated-published', identity: { documentId: input.documentId, epoch: input.epoch,
        revision: input.revision, locationId: input.locationId }, coverage: { width: 1, height: 1 },
        structure: [], diagnostics: [], image: { resourceId: 'page-picture', mimeType: 'image/png', width: 1, height: 1, byteLength: 1 } }
    },
    readResource: async () => ({ mimeType: 'image/png', bytes: new Uint8Array([1]) }),
  }, projectFiles: { parsePage: parseWebComposition,
    openProject: async ({ fileAccess }) => ({ documentId: session.documentId, writable: fileAccess?.permission !== 'read-only' }) } })
  for (const permission of ['workspace', 'read-only'] as const) {
    const runId = `method-${permission}`
    await host.tools.beginRun({ runId, actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot: root } })
    expect((await host.tools.describeRun(runId)).map(tool => tool.name)).not.toContain('project.write')
    expect(await host.tools.execute(runId, 'method', { name: 'skills.read', input: { skill: 'orchestrate-courseware' } }))
      .toMatchObject({ kind: 'read' })
    const names = (await host.tools.describeRun(runId)).map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['project.list', 'project.read']))
    expect(names).not.toContain('html.import')
    expect(names.some(name => name.startsWith('build.'))).toBe(false)
    expect(names.includes('project.write')).toBe(permission !== 'read-only')
    expect(await host.tools.execute(runId, 'list', { name: 'project.list', input: { project: '四季.h5lesson' } }))
      .toMatchObject({ kind: 'read', data: { files: expect.arrayContaining([expect.objectContaining({ path: 'theme.css' })]) } })
    expect(await host.tools.execute(runId, 'observe', { name: 'view.observe', input: { path: slidePageFiles(project)[0]!.path } }))
      .toMatchObject({ kind: 'read', data: { source: 'isolated-published' } })
    expect(await host.tools.execute(runId, 'missing-page', { name: 'view.observe', input: { path: 'slides/99-不存在.html' } }))
      .toMatchObject({ kind: 'error', code: 'target-not-found' })
    if (permission === 'read-only') expect(await host.tools.execute(runId, 'write', { name: 'project.write', input: { path: 'theme.css', content: ':root { color: red }' } }))
      .toMatchObject({ kind: 'error' })
    await host.tools.stop(runId)
  }
  expect(session.read().revision).toBe(initialRevision)
  expect(observations).toBe(2)
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-scoped-skill-')); directories.push(root)
  const workspace = path.join(root, 'workspace'), skills = path.join(workspace, '.agents', 'skills'), directory = path.join(skills, 'prepare-table')
  await fs.mkdir(path.join(directory, 'references'), { recursive: true }); await fs.mkdir(path.join(directory, 'scripts'))
  await fs.mkdir(path.join(directory, 'assets'))
  await fs.writeFile(path.join(directory, 'SKILL.md'), '---\nname: prepare-table\ndescription: >-\n  整理表格\n  并核对来源\n---\nBODY_NOT_INDEXED\n')
  await fs.writeFile(path.join(directory, 'references', 'new.md'), 'A😀e\u0301B')
  await fs.writeFile(path.join(directory, 'scripts', 'run.py'), 'raise RuntimeError("READ_ONLY_NOT_EXECUTED")\n')
  let authorized = true
  const bundled = new BundledSkillService({ manifest: { skills: [{ name: 'prepare-table', description: 'Built-in', path: 'skills/prepare-table/SKILL.md', references: [], version: 'one' }] }, files: { 'skills/prepare-table/SKILL.md': 'built-in body' } })
  const service = new ScopedSkillService(bundled, async () => authorized ? [{ source: 'workspace', directory: skills, authorizedRoot: workspace }] : [])
  const host = new DocumentHostService(path.join(root, 'journals')); host.tools.configureHostServices({ skills: service })
  await host.tools.beginRun({ runId: 'skills-run', actor: 'agent', documents: [] })
  return { root, workspace, directory, skills, service, host, revoke: () => { authorized = false } }
}


it('M27 discovers only metadata without overriding bundled names and reads root resources through the actual Gateway', async () => {
  const h = await fixture()
  expect((await h.host.tools.describeRun('skills-run')).map(tool => tool.name)).toEqual(expect.arrayContaining(['skills.list', 'skills.read']))
  const index = await h.host.tools.execute('skills-run', 'catalog', { name: 'skills.list', input: {} })
  expect(index).toMatchObject({ kind: 'read', data: { warnings: [], entries: [
    { name: 'prepare-table', description: 'Built-in' }, { name: 'workspace/prepare-table', description: '整理表格 并核对来源' },
  ] } })
  expect(JSON.stringify(index)).not.toContain('BODY_NOT_INDEXED')
  const input = { skill: 'workspace/prepare-table', path: 'references/new.md', offset: 0, limit: 2 }
  const first = await h.service.read(input, 'skills-run')
  expect(first).toMatchObject({ status: 'read', content: 'A😀', nextOffset: 2, truncated: true })
  if (first.status !== 'read') throw new Error('read failed')
  expect(await h.service.read({ ...input, offset: 2, version: first.version }, 'skills-run')).toMatchObject({ content: 'e\u0301B', truncated: false })
  expect(await h.host.tools.execute('skills-run', 'script-read', { name: 'skills.read', input: { skill: input.skill, path: 'scripts/run.py' } }))
    .toMatchObject({ kind: 'read', data: { content: 'raise RuntimeError("READ_ONLY_NOT_EXECUTED")\n' } })
  expect(await h.host.internalAPI.list()).toEqual([])
  await h.host.tools.stop('skills-run')
  expect(await h.host.tools.execute('skills-run', 'after-stop', { name: 'skills.list', input: {} })).toMatchObject({ code: 'run-stopped' })
})


it('M27 refuses changed Skill pages, revoked roots, binary-as-text and symlink escapes without losing original files', async () => {
  const h = await fixture(), input = { skill: 'workspace/prepare-table', path: 'references/new.md', offset: 0, limit: 2 }
  const first = await h.service.read(input, 'skills-run')
  if (first.status !== 'read') throw new Error('read failed')
  await fs.writeFile(path.join(h.directory, input.path), 'changed reference')
  await expect(h.service.read({ ...input, offset: 2, version: first.version }, 'skills-run')).rejects.toMatchObject({ code: 'skill-file-changed' })
  await fs.writeFile(path.join(h.directory, 'assets', 'binary.dat'), Buffer.from([1, 0, 2]))
  await expect(h.service.read({ ...input, path: 'assets/binary.dat' }, 'skills-run')).rejects.toMatchObject({ code: 'skill-binary-resource' })
  const outside = path.join(h.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'outside test sentinel')
  await fs.symlink(outside, path.join(h.directory, 'references', 'external'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(h.service.read({ ...input, path: 'references/external/private.txt' }, 'skills-run')).rejects.toMatchObject({ code: 'skill-path-outside-root' })
  expect(await fs.readFile(path.join(outside, 'private.txt'), 'utf8')).toBe('outside test sentinel')
  const bodyPage = await h.service.read({ ...input, path: 'SKILL.md' }, 'skills-run')
  if (bodyPage.status !== 'read') throw new Error('Skill body read failed')
  await fs.appendFile(path.join(h.directory, 'SKILL.md'), '\nChanged instructions\n')
  await expect(h.service.read({ ...input, path: 'SKILL.md', version: bodyPage.version }, 'skills-run')).rejects.toMatchObject({ code: 'skill-file-changed' })
  await h.service.list('skills-run', true)
  expect(await h.service.read({ ...input, path: 'SKILL.md', limit: 8000 }, 'skills-run')).toMatchObject({ status: 'read', content: expect.stringContaining('Changed instructions') })
  h.revoke()
  await expect(h.service.read(input, 'skills-run')).rejects.toMatchObject({ code: 'skill-authority-revoked' })
})

it('M27 invalidates an active Skill when only the body bytes change at the same size and timestamp', async () => {
  const h = await fixture()
  const filename = path.join(h.directory, 'SKILL.md')
  const original = await fs.readFile(filename, 'utf8'), stat = await fs.stat(filename)
  const changed = original.replace('BODY_NOT_INDEXED', 'BODY_HAS_CHANGED')
  expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original))
  const first = await h.service.read({ skill: 'workspace/prepare-table', path: 'SKILL.md', offset: 0, limit: 100 }, 'skills-run')
  if (first.status !== 'read') throw new Error('Skill body read failed')
  await fs.writeFile(filename, changed)
  await fs.utimes(filename, stat.atime, stat.mtime)
  await expect(h.service.read({ skill: 'workspace/prepare-table', path: 'SKILL.md', offset: 100, limit: 100, version: first.version }, 'skills-run'))
    .rejects.toMatchObject({ code: 'skill-file-changed' })
})

it('Chinese folder metadata need not equal its path and unchanged reference pages survive an unrelated Skill body edit', async () => {
  const h = await fixture(), folder = path.join(h.skills, '整理图表')
  await fs.mkdir(path.join(folder, 'references'), { recursive: true })
  await fs.writeFile(path.join(folder, 'SKILL.md'), '---\nname: chart-method\ndescription: 中文目录方法\n---\nFirst instructions')
  await fs.writeFile(path.join(folder, 'references', 'source.md'), '第一页第二页')
  const listed = await h.service.list('skills-run', true)
  expect(listed.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'workspace/整理图表', description: '中文目录方法' })]))
  const input = { skill: 'workspace/整理图表', path: 'references/source.md', offset: 0, limit: 3 }
  const first = await h.service.read(input, 'skills-run')
  expect(first).toMatchObject({ status: 'read', content: '第一页', nextOffset: 3 })
  if (first.status !== 'read') throw new Error('Reference read failed')
  await fs.writeFile(path.join(folder, 'SKILL.md'), '---\nname: another-metadata-name\ndescription: 更新说明\n---\nChanged instructions')
  expect(await h.service.read({ ...input, offset: 3, version: first.version }, 'skills-run')).toMatchObject({ status: 'read', content: '第二页', truncated: false })
  await fs.writeFile(path.join(folder, 'references', 'source.md'), '第一页变更页')
  await expect(h.service.read({ ...input, offset: 3, version: first.version }, 'skills-run')).rejects.toMatchObject({ code: 'skill-file-changed' })
})

it('discovers all enabled Skill metadata beyond one hundred and reads a long reference in one bounded page', async () => {
  const h = await fixture()
  for (let i = 0; i < 101; i++) {
    const folder = path.join(h.skills, `skill-${i}`)
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, 'SKILL.md'), `---\nname: skill-${i}\ndescription: fixture\n---\nnot preloaded\n`)
  }
  const listed = await h.service.list('skills-run', true)
  expect(listed.entries.filter(entry => entry.name.startsWith('workspace/'))).toHaveLength(102)
  expect(listed.warnings).toEqual([])
  const content = 'a'.repeat(9000)
  await fs.writeFile(path.join(h.directory, 'references/long.md'), content)
  expect(await h.service.read({ skill: 'workspace/prepare-table', path: 'references/long.md', offset: 0, limit: 16_000 }, 'skills-run'))
    .toMatchObject({ status: 'read', content, truncated: false })
})
