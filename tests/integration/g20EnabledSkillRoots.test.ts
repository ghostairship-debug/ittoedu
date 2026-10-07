// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { ScopedSkillService } from '../../src/main/workbench/skills/ScopedSkillService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'

const electronHome = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronHome.directory, getAppPath: () => process.cwd(), getVersion: () => '0.0.1' },
  shell: {}, dialog: {}, BrowserWindow: class {}, session: {}, WebContentsView: class {}, net: {}, protocol: {}, ipcMain: {},
  safeStorage: { isEncryptionAvailable: () => false }, clipboard: {}, screen: {}, webContents: {} }))

it('Main derives existing user and authorized workspace Skill roots without extra opt-in and scoped Gateway stop preserves originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-main-skill-roots-'))
  try {
    const userHome = path.join(root, 'home'), workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
    electronHome.directory = userHome
    const sources: string[] = []
    for (const [owner, name] of [[userHome, '用户方法'], [workspace, '工作空间方法'], [outside, '无授权方法']] as const) {
      const folder = path.join(owner, '.agents', 'skills', name); await fs.mkdir(folder, { recursive: true })
      const filename = path.join(folder, 'SKILL.md'); sources.push(filename)
      await fs.writeFile(filename, `---\nname: metadata-label\ndescription: ${name}\n---\nBODY_${name}`)
    }
    vi.stubEnv('COURSEWARE_SKILLS_DESTINATION', '')
    const { workbenchSkillRootsForGrant } = await import('../../src/main/workbench/workbenchToolServices')
    const grant: ToolRunGrant = { runId: 'roots-run', actor: 'agent', documents: [], fileAccess: { permission: 'read-only', workspaceRoot: workspace } }
    const roots = workbenchSkillRootsForGrant(grant)
    expect(roots).toEqual([{ source: 'user', directory: path.join(userHome, '.agents', 'skills'), authorizedRoot: path.join(userHome, '.agents', 'skills') },
      { source: 'workspace', directory: path.join(workspace, '.agents', 'skills'), authorizedRoot: workspace }])
    expect(workbenchSkillRootsForGrant({ runId: 'user-only', actor: 'agent', documents: [] })).toEqual([roots[0]])
    const bundled = new BundledSkillService({ manifest: { skills: [{ name: 'built-in', description: 'Bundled', path: 'skills/built-in/SKILL.md', references: [], version: 'one' }] },
      files: { 'skills/built-in/SKILL.md': 'bundled body' } })
    let active = true
    const skills = new ScopedSkillService(bundled, async () => active ? workbenchSkillRootsForGrant(grant) : workbenchSkillRootsForGrant({ ...grant, fileAccess: undefined }))
    const host = new DocumentHostService(path.join(root, 'documents')); host.tools.configureHostServices({ skills })
    await host.tools.beginRun(grant)
    const listed = await host.tools.execute(grant.runId, 'list', { name: 'skills.list', input: {} })
    expect(listed).toMatchObject({ kind: 'read', data: { entries: [expect.objectContaining({ name: 'built-in' }),
      expect.objectContaining({ name: 'user/用户方法' }), expect.objectContaining({ name: 'workspace/工作空间方法' })] } })
    expect(JSON.stringify(listed)).not.toContain('BODY_'); expect(JSON.stringify(listed)).not.toContain('无授权方法')
    expect(await host.tools.execute(grant.runId, 'read', { name: 'skills.read', input: { skill: 'workspace/工作空间方法' } }))
      .toMatchObject({ kind: 'read', data: { content: expect.stringContaining('BODY_工作空间方法') } })
    active = false
    await expect(skills.read({ skill: 'workspace/工作空间方法', path: 'SKILL.md', offset: 0, limit: 200 }, grant.runId)).rejects.toMatchObject({ code: 'skill-authority-revoked' })
    expect(await skills.read({ skill: 'user/用户方法', path: 'SKILL.md', offset: 0, limit: 200 }, grant.runId))
      .toMatchObject({ status: 'read', content: expect.stringContaining('BODY_用户方法') })
    await host.tools.stop(grant.runId)
    expect(await host.tools.execute(grant.runId, 'late', { name: 'skills.read', input: { skill: 'user/用户方法' } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
    for (const filename of sources) expect(await fs.readFile(filename, 'utf8')).toContain('BODY_')
  } finally {
    vi.unstubAllEnvs()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
