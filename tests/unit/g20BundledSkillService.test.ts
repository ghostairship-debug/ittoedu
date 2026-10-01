// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BundledSkillService, type BundledSkillBundle } from '../../src/main/workbench/skills/BundledSkillService'

const bundle: BundledSkillBundle = {
  manifest: { skills: [{
    name: 'orchestrate-courseware', description: 'Plan a lesson.', version: 'sha256:one',
    path: 'skills/orchestrate-courseware/SKILL.md',
    references: ['skills/orchestrate-courseware/references/guide.md'],
  }, {
    name: 'build-courseware-project', description: 'Build a project.', version: 'sha256:two',
    path: 'skills/build-courseware-project/SKILL.md', references: [],
  }] },
  files: {
    'skills/orchestrate-courseware/SKILL.md': 'A😀e\u0301B',
    'skills/orchestrate-courseware/references/guide.md': 'direct reference',
    'skills/orchestrate-courseware/references/not-listed.md': 'hidden',
    'skills/build-courseware-project/SKILL.md': 'second skill',
  },
}

describe('BundledSkillService', () => {
  it('reads only embedded, registered Skill and direct reference files', async () => {
    const service = new BundledSkillService(bundle)
    expect(await service.catalog()).toEqual([
      { name: 'orchestrate-courseware', description: 'Plan a lesson.' },
      { name: 'build-courseware-project', description: 'Build a project.' },
    ])
    expect(await service.read({ skill: 'orchestrate-courseware', path: 'references/guide.md', offset: 0, limit: 100 }))
      .toEqual({ status: 'read', skill: 'orchestrate-courseware', path: 'references/guide.md', version: 'sha256:one', content: 'direct reference', truncated: false })
    for (const path of ['references/not-listed.md', '../build-courseware-project/SKILL.md', '/etc/passwd', 'C:/secret', 'references\\guide.md', 'references/./guide.md', 'references//guide.md', 'references/../references/guide.md']) {
      expect(await service.read({ skill: 'orchestrate-courseware', path, offset: 0, limit: 1 }))
        .toEqual({ status: 'unknown-path', skill: 'orchestrate-courseware', path })
    }
    expect(await service.read({ skill: 'missing', path: 'SKILL.md', offset: 0, limit: 1 }))
      .toEqual({ status: 'unknown-skill', skill: 'missing' })
  })

  it('pages by grapheme without dividing emoji or combining characters', async () => {
    const service = new BundledSkillService(bundle)
    let offset = 0
    const chunks: string[] = []
    for (let page = 0; page < 4; page += 1) {
      const result = await service.read({ skill: 'orchestrate-courseware', path: 'SKILL.md', offset, limit: 1 })
      expect(result.status).toBe('read')
      if (result.status !== 'read') break
      chunks.push(result.content)
      if (result.nextOffset === undefined) {
        expect(result.truncated).toBe(false)
        break
      }
      expect(result.truncated).toBe(true)
      offset = result.nextOffset
    }
    expect(chunks).toEqual(['A', '😀', 'e\u0301', 'B'])
    expect(chunks.join('')).toBe(bundle.files['skills/orchestrate-courseware/SKILL.md'])
  })

  it('fails closed for malformed generated manifests and invalid page ranges', async () => {
    const missing = { ...bundle, files: {} }
    expect(() => new BundledSkillService(missing)).toThrow('Invalid bundled Skill file key')
    const crossing = { ...bundle, manifest: { skills: [{ ...bundle.manifest.skills[0], references: ['skills/build-courseware-project/SKILL.md'] }] } }
    expect(() => new BundledSkillService(crossing)).toThrow('Bundled Skill key crosses its root')
    const service = new BundledSkillService(bundle)
    await expect(service.read({ skill: 'orchestrate-courseware', path: 'SKILL.md', offset: -1, limit: 1 })).rejects.toThrow(RangeError)
    await expect(service.read({ skill: 'orchestrate-courseware', path: 'SKILL.md', offset: 0, limit: 64_001 })).rejects.toThrow(RangeError)
  })
})
