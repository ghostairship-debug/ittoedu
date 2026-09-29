import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import type { SkillServicePort, SkillReadResult } from '../../../shared/workbench/toolPorts'

export interface SkillRoot { source: 'user' | 'workspace'; directory: string; authorizedRoot: string }
interface LocalSkill { name: string; description: string; version: string; source: SkillRoot['source']; directory: string; root: SkillRoot }
interface Index { entries: LocalSkill[]; warnings: string[] }
const inside = (root: string, filename: string) => { const relative = path.relative(root, filename); return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative) }
const relativeFile = (value: string) => value.length > 0 && value.length <= 512 && !value.includes('\\') && !value.includes(':')
  && !value.includes(String.fromCharCode(0)) && value.split('/').every(part => part && part !== '.' && part !== '..')
const failure = (code: string, message: string) => Object.assign(new Error(message), { code })
export async function resolveAuthorizedSkillRoot(root: SkillRoot): Promise<{ authority: string; directory: string }> {
  const authority = await fs.realpath(root.authorizedRoot), directory = await fs.realpath(root.directory)
  if (!inside(authority, directory)) throw failure('skill-root-outside-grant', 'Skill 根目录不在当前已有授权内')
  return { authority, directory }
}

/** User/workspace Skills are read-only files under existing grants, never a new authority or executable configuration. */
export class ScopedSkillService implements SkillServicePort {
  private readonly indexes = new Map<string, Promise<Index>>()
  constructor(private readonly bundled: SkillServicePort & { catalog(): Promise<readonly { name: string; description: string }[]> },
    private readonly rootsFor: (runId: string) => Promise<readonly SkillRoot[]>) {}
  release(runId: string) { this.indexes.delete(runId) }
  private async allowedRoot(root: SkillRoot): Promise<string> {
    return (await resolveAuthorizedSkillRoot(root)).directory
  }
  private async metadata(root: SkillRoot, folder: string): Promise<LocalSkill> {
    const base = await this.allowedRoot(root), directory = await fs.realpath(path.join(base, folder))
    if (!inside(base, directory) || directory === base) throw failure('skill-path-outside-root', 'Skill 路径越出本根目录')
    const filename = await fs.realpath(path.join(directory, 'SKILL.md'))
    if (!inside(directory, filename)) throw failure('skill-path-outside-root', 'SKILL.md 越出本 Skill 根目录')
    const file = await fs.open(filename, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 1024 * 1024) throw failure('skill-metadata-unavailable', 'Skill 正文超过读取上限或不是普通文件')
      const bytes = await file.readFile()
      if (bytes.byteLength !== stat.size) throw failure('skill-file-changed', 'Skill 正文在读取时改变')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.slice(0, 8192))
      if (!front) throw failure('skill-metadata-unavailable', 'Skill 开头需要有界 YAML 元数据 name/description')
      const doc = parseDocument(front[1], { schema: 'failsafe', uniqueKeys: true, prettyErrors: false })
      if (doc.errors.length || doc.warnings.length) throw failure('skill-metadata-invalid', 'Skill YAML 元数据无法明确解析')
      const data = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>
      if (!data || typeof data.name !== 'string' || data.name !== folder || typeof data.description !== 'string' || !data.description.trim())
        throw failure('skill-metadata-invalid', 'Skill name 必须与目录名一致，并提供 description')
      const version = createHash('sha256').update(filename).update(bytes).digest('hex')
      return { name: `${root.source}/${folder}`, description: data.description.replace(/\s+/g, ' ').trim().slice(0, 600),
        version: `sha256:${version}`, source: root.source, directory, root }
    } finally { await file.close() }
  }
  private async scan(runId: string): Promise<Index> {
    const entries: LocalSkill[] = [], warnings: string[] = []
    for (const root of await this.rootsFor(runId)) {
      let folders
      try { folders = await fs.readdir(await this.allowedRoot(root), { withFileTypes: true }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`${root.source}: 根目录未能读取或不在授权内`); continue }
      for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!folder.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(folder.name)) continue
        if (entries.length >= 100) { warnings.push('Skill 元数据目录已截断到 100 项，请缩小根目录'); break }
        try { entries.push(await this.metadata(root, folder.name)) }
        catch (error) { warnings.push(`${root.source}/${folder.name}: ${(error as { code?: string }).code ?? 'metadata-unavailable'}`) }
      }
    }
    return { entries, warnings }
  }
  private index(runId: string, refresh = false): Promise<Index> {
    let index = this.indexes.get(runId)
    if (!index || refresh) { index = this.scan(runId); this.indexes.set(runId, index) }
    return index
  }
  async catalog(runId?: string) {
    const builtIn = await this.bundled.catalog()
    if (!runId) return builtIn
    return [...builtIn, ...(await this.index(runId)).entries.map(({ name, description, source }) => ({ name, description, source }))]
  }
  async list(runId: string, refresh = false) {
    const index = await this.index(runId, refresh)
    return { entries: await this.catalog(runId), warnings: index.warnings, scripts: '只读内容；执行需走作业的隔离后端与独立授权，读取 Skill 不授予执行权。' }
  }
  async read(input: { skill: string; path: string; offset: number; limit: number; version?: string }, runId?: string): Promise<SkillReadResult> {
    if (!input.skill.startsWith('user/') && !input.skill.startsWith('workspace/')) return this.bundled.read(input)
    if (!runId) return { status: 'unknown-skill', skill: input.skill }
    const entry = (await this.index(runId)).entries.find(skill => skill.name === input.skill)
    if (!entry) return { status: 'unknown-skill', skill: input.skill }
    if (!relativeFile(input.path)) return { status: 'unknown-path', skill: input.skill, path: input.path }
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 8000)
      throw failure('invalid-input', 'Skill 分页范围无效')
    const roots = await this.rootsFor(runId)
    if (!roots.some(root => root.source === entry.root.source && root.directory === entry.root.directory && root.authorizedRoot === entry.root.authorizedRoot))
      throw failure('skill-authority-revoked', 'Skill 根目录的任务授权已撤销')
    const current = await this.metadata(entry.root, entry.name.slice(entry.name.indexOf('/') + 1))
    if (current.version !== entry.version || current.directory !== entry.directory)
      throw failure('skill-changed', 'Skill 已改变；请刷新 skills.list 并重新核对内容，旧内容不能沿用执行授权')
    const filename = await fs.realpath(path.join(current.directory, input.path))
    if (!inside(current.directory, filename)) throw failure('skill-path-outside-root', '资料路径越出本 Skill 根目录')
    const file = await fs.open(filename, 'r')
    let bytes: Buffer
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 1024 * 1024) throw failure('skill-file-too-large', 'Skill 资料不是普通文件或超过单次读取上限')
      const buffer = Buffer.alloc(stat.size + 1), result = await file.read(buffer, 0, buffer.length, 0)
      if (result.bytesRead !== stat.size || (await file.stat()).mtimeMs !== stat.mtimeMs) throw failure('skill-file-changed', 'Skill 资料在读取时改变，请重新核对')
      bytes = buffer.subarray(0, result.bytesRead)
    } finally { await file.close() }
    const version = `sha256:${createHash('sha256').update(current.version).update(input.path).update(bytes).digest('hex')}`
    if (input.version && input.version !== version) throw failure('skill-file-changed', 'Skill 资料版本已改变，不能拼接旧页或复用旧脚本批准')
    let source: string
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (source.includes(String.fromCharCode(0))) throw new Error('binary') }
    catch { throw failure('skill-binary-resource', '该资源不是 UTF-8 文本；原文件保留，需通过素材/文件接口使用，未执行或伪装为已读文本') }
    const characters = Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(source), item => item.segment)
    if (input.offset > characters.length) throw failure('invalid-input', 'Skill 读取位置超出原文范围')
    const end = Math.min(characters.length, input.offset + input.limit), truncated = end < characters.length
    return { status: 'read', skill: input.skill, path: input.path, version, content: characters.slice(input.offset, end).join(''),
      ...(truncated ? { nextOffset: end } : {}), truncated }
  }
}
