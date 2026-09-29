// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { ScopedSkillService } from '../../src/main/workbench/skills/ScopedSkillService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })
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
  await fs.appendFile(path.join(h.directory, 'SKILL.md'), '\nChanged instructions\n')
  await expect(h.service.read({ ...input, path: 'SKILL.md' }, 'skills-run')).rejects.toMatchObject({ code: 'skill-changed' })
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
  await h.service.read({ skill: 'workspace/prepare-table', path: 'SKILL.md', offset: 0, limit: 100 }, 'skills-run')
  await fs.writeFile(filename, changed)
  await fs.utimes(filename, stat.atime, stat.mtime)
  await expect(h.service.read({ skill: 'workspace/prepare-table', path: 'SKILL.md', offset: 0, limit: 100 }, 'skills-run'))
    .rejects.toMatchObject({ code: 'skill-changed' })
})
