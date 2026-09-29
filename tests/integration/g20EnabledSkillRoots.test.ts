// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { EnabledSkillRootStore } from '../../src/main/workbench/skills/EnabledSkillRootStore'
import { ScopedSkillService, type SkillRoot } from '../../src/main/workbench/skills/ScopedSkillService'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }) })

it('M27 defaults to bundled Skills, enables explicit user/workspace roots, then revokes without touching source files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-skill-roots-')); roots.push(root)
  const userHome = path.join(root, 'app'), workspace = path.join(root, 'workspace')
  const candidates: SkillRoot[] = [
    { source: 'user', authorizedRoot: userHome, directory: path.join(userHome, 'skills') },
    { source: 'workspace', authorizedRoot: workspace, directory: path.join(workspace, '.agents', 'skills') },
  ]
  for (const [index, candidate] of candidates.entries()) {
    const folder = path.join(candidate.directory, `method-${index}`)
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'SKILL.md'), `---\nname: method-${index}\ndescription: Explicit skill ${index}\n---\nBODY_${index}`)
  }
  const store = new EnabledSkillRootStore(path.join(userHome, 'settings', 'enabled-skill-roots.json'))
  const bundled = new BundledSkillService({ manifest: { skills: [{ name: 'built-in', description: 'Bundled', path: 'skills/built-in/SKILL.md', references: [], version: 'one' }] },
    files: { 'skills/built-in/SKILL.md': 'bundled body' } })
  const skills = new ScopedSkillService(bundled, async () => (await store.enabledRoots(candidates)).roots)
  expect((await store.enabledRoots(candidates)).roots).toEqual([])
  expect((await skills.list('r')).entries.map(item => item.name)).toEqual(['built-in'])
  expect(await store.setEnabled(candidates[0]!, true)).toEqual({ revision: 1, enabled: true })
  expect((await skills.list('r', true)).entries.map(item => item.name)).toEqual(['built-in', 'user/method-0'])
  expect(await skills.read({ skill: 'user/method-0', path: 'SKILL.md', offset: 0, limit: 200 }, 'r'))
    .toMatchObject({ status: 'read', content: expect.stringContaining('BODY_0') })
  expect(await store.setEnabled(candidates[1]!, true)).toEqual({ revision: 2, enabled: true })
  expect((await skills.list('r', true)).entries.map(item => item.name)).toEqual(['built-in', 'user/method-0', 'workspace/method-1'])
  await expect(store.setEnabled({ source: 'user', authorizedRoot: workspace, directory: candidates[0]!.directory }, true))
    .rejects.toMatchObject({ code: 'skill-root-outside-grant' })
  expect(await store.setEnabled(candidates[0]!, false)).toEqual({ revision: 3, enabled: false })
  await expect(skills.read({ skill: 'user/method-0', path: 'SKILL.md', offset: 0, limit: 200 }, 'r'))
    .rejects.toMatchObject({ code: 'skill-authority-revoked' })
  expect((await store.enabledRoots(candidates)).roots).toEqual([candidates[1]])
  expect(await fs.readFile(path.join(candidates[0]!.directory, 'method-0', 'SKILL.md'), 'utf8')).toContain('BODY_0')
  expect(await fs.readFile(path.join(candidates[1]!.directory, 'method-1', 'SKILL.md'), 'utf8')).toContain('BODY_1')
})
