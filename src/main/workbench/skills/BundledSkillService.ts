import type { SkillReadResult, SkillServicePort } from '../../../shared/workbench/toolPorts'
import { createHash } from 'node:crypto'

/** The generator embeds this data in the application; Main never opens authoring files. */
export interface BundledSkillBundle {
  manifest: {
    skills: readonly {
      name: string
      description: string
      path: string
      references: readonly string[]
      version: string
    }[]
  }
  files: Readonly<Record<string, string>>
}

const validRelativePath = (value: string): boolean =>
  value.length > 0 && value.length <= 512 && !value.includes('\\') && !value.includes('\0')
  && !value.startsWith('/') && !value.includes(':')
  && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')

interface SkillEntry {
  description: string
  version: string
  readable: ReadonlyMap<string, { source: string; version: string }>
}

/** Reads only manifest-registered keys from the generated in-memory bundle. */
export class BundledSkillService implements SkillServicePort {
  private readonly entries = new Map<string, SkillEntry>()

  constructor(bundle: BundledSkillBundle) {
    for (const entry of bundle.manifest.skills) {
      if (!validRelativePath(entry.name) || entry.name.includes('/') || !entry.description.trim()
        || !entry.version.trim() || this.entries.has(entry.name)) throw new Error('Invalid bundled Skill manifest')
      const prefix = `skills/${entry.name}/`
      const readable = new Map<string, { source: string; version: string }>()
      for (const key of [entry.path, ...entry.references]) {
        if (!key.startsWith(prefix)) throw new Error('Bundled Skill key crosses its root')
        const relative = key.slice(prefix.length)
        if (!validRelativePath(relative) || readable.has(relative) || typeof bundle.files[key] !== 'string')
          throw new Error('Invalid bundled Skill file key')
        const source = bundle.files[key]
        readable.set(relative, { source, version: `sha256:${createHash('sha256').update(key).update(source).digest('hex')}` })
      }
      if (entry.path !== `${prefix}SKILL.md`) throw new Error('Missing bundled SKILL.md')
      this.entries.set(entry.name, { description: entry.description.replace(/\s+/g, ' ').trim(), version: entry.version, readable })
    }
  }

  async catalog(): Promise<readonly { name: string; description: string }[]> {
    return [...this.entries].map(([name, entry]) => ({ name, description: entry.description }))
  }

  async read(input: { skill: string; path: string; offset: number; limit: number; version?: string }): Promise<SkillReadResult> {
    const entry = this.entries.get(input.skill)
    if (!entry) return { status: 'unknown-skill', skill: input.skill }
    if (!validRelativePath(input.path) || !entry.readable.has(input.path))
      return { status: 'unknown-path', skill: input.skill, path: input.path }
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.limit)
      || input.limit < 1 || input.limit > 64_000) throw new RangeError('Invalid Skill page range')
    const { source, version } = entry.readable.get(input.path)!
    if (input.version && input.version !== version) throw Object.assign(new Error('当前 Skill 文件已改变，请重新读取，不能拼接旧页'), { code: 'skill-file-changed' })
    const characters = Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(source), item => item.segment)
    const end = Math.min(characters.length, input.offset + input.limit)
    const truncated = end < characters.length
    return {
      status: 'read', skill: input.skill, path: input.path, version,
      content: characters.slice(input.offset, end).join(''),
      ...(truncated ? { nextOffset: end } : {}), truncated,
    }
  }
}
