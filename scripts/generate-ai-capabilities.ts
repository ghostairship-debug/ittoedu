import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { z } from 'zod'
import { describeTools } from '../src/core/tools/ToolCatalog'
import { agentFileTools } from '../src/core/tools/AgentFileTools'
import { officeContentTools } from '../src/core/tools/OfficeContentTools'
import { skillReadTool } from '../src/core/tools/SkillTools'
import { builtinComponentSourceKeys } from '../src/core/components/source/builtinSources'
import { courseAgentMethodSkills } from '../src/shared/courseAgentSkills'
import { courseAgentCapabilityDiskIndex, courseAgentCapabilityQueryHelp, type CourseAgentCapabilityData, type CourseAgentCapabilityEntry } from '../src/shared/courseAgentCapabilities'
import { componentDefinitionSchema, componentImplementationSchema, componentSurfaceSchema, courseProjectV10Schema } from '../src/shared/contracts/component-platform/schema'
import { publishedCourseV3Schema } from '../src/shared/contracts/component-platform/published'

export const AI_CAPABILITY_INDEX_RECOMMENDED_BYTES = 16_384
export const AI_CAPABILITY_DISCOVERY_MAX_BYTES = 8_192
export const AI_CAPABILITY_MANIFEST_VERSION = 1 as const

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export interface AiCapabilityGenerationOptions { projectRoot?: string }
export interface AiCapabilityGenerationResult {
  files: ReadonlyMap<string, string>
  capabilityBundle: string
  bundledSkillBundle: string
  indexBytes: number
  componentCatalogStatus: 'runtime-discovery'
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, nested]) => [key, normalizeJson(nested)]),
  )
}

/** Canonical UTF-8 JSON used for deterministic artifacts and their semantic identity. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalizeJson(value))}\n`
}

export function canonicalJsonByteLength(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8')
}

/** Native file readers can cap each physical line; keep on-demand JSON navigable. */
function readableResourceJson(value: unknown): string {
  return `${JSON.stringify(normalizeJson(value), null, 2)}\n`
}

export function indexSizeWarning(index: unknown): string | undefined {
  const byteLength = canonicalJsonByteLength(index)
  if (byteLength > AI_CAPABILITY_INDEX_RECOMMENDED_BYTES) {
    return `AI 能力索引规范化后为 ${byteLength} 字节，超过建议 ${AI_CAPABILITY_INDEX_RECOMMENDED_BYTES} 字节；完整能力仍正常生成，按需读取。`
  }
  return undefined
}

/** Package the maintained method entry and its optional support files; model reads remain task scoped. */
async function methodSkillResourceFiles(projectRoot: string, skillName: string): Promise<Map<string, string>> {
  const skillRoot = await fs.realpath(path.join(projectRoot, '.agents', 'skills', skillName))
  const resources = new Map<string, string>()
  const read = async (relative: string) => {
    const filename = await fs.realpath(path.join(skillRoot, ...relative.split('/')))
    const difference = path.relative(skillRoot, filename)
    if (!difference || difference === '..' || difference.startsWith(`..${path.sep}`) || path.isAbsolute(difference)
      || !(await fs.stat(filename)).isFile()) throw new Error(`Bundled Skill file escapes root: ${skillName}/${relative}`)
    resources.set(relative, await fs.readFile(filename, 'utf8'))
  }
  const walk = async (relative: string): Promise<void> => {
    const entries = await fs.readdir(path.join(skillRoot, ...relative.split('/')), { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(child)
      else if (/\.(?:md|mjs|py|ps1)$/.test(entry.name)) await read(child)
    }
  }
  await read('SKILL.md')
  await walk('references')
  await walk('scripts')
  return resources
}

/** Rebuild only method resources when their real tool entry changes. */
export async function generateBundledSkillArtifacts(projectRoot: string) {
  const files = new Map<string, string>()
  const manifest = { skills: await Promise.all(courseAgentMethodSkills.map(async skill => {
    const resources = await methodSkillResourceFiles(projectRoot, skill.name)
    const entryKey = `skills/${skill.name}/SKILL.md`
    const entry = resources.get('SKILL.md')!
    const references = [...resources.keys()].filter(relative => relative !== 'SKILL.md').sort().map(relative => `skills/${skill.name}/${relative}`)
    for (const [relative, content] of resources) files.set(`skills/${skill.name}/${relative}`, content)
    const description = entry.match(/^description: (.+)$/m)?.[1]?.split('。')[0]?.trim()
    if (!description) throw new Error(`Bundled Skill missing description: ${entryKey}`)
    const version = createHash('sha256').update(canonicalJson(Object.fromEntries([entryKey, ...references].map(key => [key, files.get(key)])))).digest('hex')
    return { name: skill.name, description: `${description}。`, path: entryKey, references, version }
  })) }
  return { files, manifest, bundle: canonicalJson({ manifest, files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) }) }
}

/** Static documentation is projected from public registrations, never from retired authoring writers. */
export async function generateAiCapabilityArtifacts(
  options: AiCapabilityGenerationOptions = {},
): Promise<AiCapabilityGenerationResult> {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot)
  const skills = await generateBundledSkillArtifacts(projectRoot)
  const resources = new Map<string, string>(skills.files)
  resources.set('skills/manifest.json', readableResourceJson(skills.manifest))
  const entries: CourseAgentCapabilityEntry[] = []
  const surfaces = componentSurfaceSchema.shape.kind.options
  const allScopes = surfaces.flatMap(surface => ['surface', 'global', 'instance'].map(owner => `${surface}:${owner}`))
  const carriers = ['component']
  const scopeNote = '静态目录只说明已登记接口；当前运行是否可调用、文档范围、写权限、短句柄和服务配置，以宿主本轮发现与实际回执为准。'

  // Refresh the description from the same SOURCE manifest being emitted now.
  // The runtime catalog normally reads the previously generated bundled manifest.
  const currentSkillReader = skillReadTool(skills.manifest.skills)
  const registeredTools = [
    ...describeTools().map(tool => ({ name: tool.name,
      description: tool.name === currentSkillReader.name ? currentSkillReader.description : tool.description,
      inputSchema: tool.schema, manual: tool.manual })),
    ...agentFileTools,
    ...officeContentTools,
  ]
  for (const tool of registeredTools) {
    const location = `tools/${tool.name}.json`
    resources.set(location, readableResourceJson({ version: 1, ...tool, invocation: scopeNote }))
    entries.push({ id: tool.name, kind: 'tool', label: tool.name, path: location,
      scopes: allScopes, carriers, summary: tool.description })
  }

  const schemaResources = [
    { id: 'course-project-v10', path: 'schemas/course-project-v10.json', schema: courseProjectV10Schema,
      source: 'src/shared/contracts/component-platform/schema.ts', summary: '正式 Project V10 作者数据结构；修改通过当前工程工具和文档事务提交。' },
    { id: 'published-course-v3', path: 'schemas/published-course-v3.json', schema: publishedCourseV3Schema,
      source: 'src/shared/contracts/component-platform/published.ts', summary: 'Published V3 播放数据结构；由正式工程生成，包含实际运行资源。' },
  ]
  for (const protocol of schemaResources) {
    resources.set(protocol.path, readableResourceJson(z.toJSONSchema(protocol.schema)))
    entries.push({ id: protocol.id, kind: 'protocol', label: protocol.id, path: protocol.path,
      scopes: allScopes, carriers, summary: protocol.summary })
  }
  const runtimeSources = [
    'src/shared/contracts/component-platform/runtime.ts',
    'src/shared/contracts/component-platform/project.ts',
    'src/shared/contracts/component-platform/frame.ts',
    'src/shared/contracts/component-platform/motion.ts',
    'src/shared/contracts/component-platform/teacherController.ts',
    'src/shared/contracts/interaction-v1/types.ts',
  ]
  resources.set('protocols/component-api5.json', readableResourceJson({
    apiVersion: 5,
    definitionSchema: z.toJSONSchema(componentDefinitionSchema),
    implementationSchema: z.toJSONSchema(componentImplementationSchema),
    types: Object.fromEntries(await Promise.all(runtimeSources.map(async source => [source, await fs.readFile(path.join(projectRoot, source), 'utf8')]))),
    source: 'src/shared/contracts/component-platform/runtime.ts',
    note: '组件 mount/update/dispose 和 scope、目标、事件、状态、媒体、互动、教师控制器端口取自正式合同。相关类型保留原源码引用路径；实际端口由当前宿主提供。',
  }))
  entries.push({ id: 'component-api5', kind: 'protocol', label: 'Component API 5', path: 'protocols/component-api5.json',
    scopes: allScopes, carriers, summary: '统一组件源码运行接口、生命周期和实际宿主端口；作者数据使用 Project V10。', dependencies: ['course-project-v10'] })
  resources.set('component-catalog.snapshot.json', readableResourceJson({
    version: 1, status: 'runtime-discovery', builtinSourceKeys: [...builtinComponentSourceKeys].sort(),
    tools: ['asset.search', 'asset.use', 'asset.save'],
    note: '列出的 key 来自本次构建的默认组件源码登记。已安装资产库、授权、可用资源和宿主句柄须通过本轮公共工具发现，不由静态快照声明。',
  }))
  entries.push({ id: 'component-catalog', kind: 'reference', label: '组件源码与资产目录', path: 'component-catalog.snapshot.json',
    scopes: allScopes, carriers, summary: '当前默认源码 key 及资产发现入口；目录可用性以当前宿主为准。', dependencies: ['asset.search', 'asset.use', 'asset.save'] })

  for (const [location, content] of skills.files) {
    const [, skillName, ...relativeParts] = location.split('/')
    const sourcePath = relativeParts.join('/')
    const label = content.match(/^# (.+)$/m)?.[1] ?? sourcePath
    const isEntry = sourcePath === 'SKILL.md'
    entries.push({ id: isEntry ? `skill:${skillName}` : `reference:${skillName}/${sourcePath.startsWith('scripts/') ? 'script-' : ''}${path.posix.basename(sourcePath, path.posix.extname(sourcePath))}`,
      kind: isEntry ? 'skill' : 'reference', label, path: location, scopes: allScopes, carriers,
      summary: isEntry ? content.match(/^description: (.+)$/m)?.[1]?.slice(0, 300) ?? label : label,
      keywords: content.split('\n').filter(line => /^#{1,3} /.test(line)).join(' '),
    })
  }
  resources.set('query-core.mjs', stripTypeScriptTypes(await fs.readFile(path.join(projectRoot, 'src/shared/courseAgentCapabilities.ts'), 'utf8')).split('\n').map(line => line.trimEnd()).join('\n'))
  resources.set('query.mjs', [
    "import {readFile} from 'node:fs/promises';",
    "import {readFileSync} from 'node:fs';",
    "import {runCourseAgentCapabilityQuery} from './query-core.mjs';",
    "const data=JSON.parse(await readFile(new URL('./discovery-data.json',import.meta.url),'utf8'));",
    "data.files=new Proxy({}, {get:(_target,name)=>typeof name==='string' && data.resourcePaths.includes(name) ? readFileSync(new URL(name,import.meta.url),'utf8') : undefined});",
    "try {const result=runCourseAgentCapabilityQuery(data,process.argv.slice(2));console.log(typeof result==='string'?result:JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}",
  ].join('\n') + '\n')
  entries.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const semanticVersion = createHash('sha256').update(canonicalJson({ version: 1, entries,
    files: Object.fromEntries([...resources].sort(([a], [b]) => a.localeCompare(b, 'en'))) })).digest('hex')
  const protocols = { project: { version: 10, schema: 'schemas/course-project-v10.json' },
    published: { version: 3, schema: 'schemas/published-course-v3.json' }, component: { version: 5, source: 'protocols/component-api5.json' } }
  const discovery = { version: 1, semanticVersion, query: 'query.mjs', data: 'discovery-data.json',
    usage: courseAgentCapabilityQueryHelp, scope: scopeNote,
    groups: { tools: 'query --kind tool', components: 'query --id component-catalog', skills: 'query --kind skill', references: 'query --kind reference' },
    tools: entries.filter(entry => entry.kind === 'tool').map(entry => ({ id: entry.id, path: entry.path })),
    protocols: entries.filter(entry => entry.kind === 'protocol').map(entry => ({ id: entry.id, path: entry.path })),
    cache: 'Reuse only with the same semanticVersion and the same query scope; source/material/observation versions are separate.',
  }
  resources.set('discovery.json', readableResourceJson(discovery))
  const data: CourseAgentCapabilityData = { version: 1, semanticVersion, entries, files: Object.fromEntries(resources) }
  const files = new Map(resources)
  files.set('discovery-data.json', courseAgentCapabilityDiskIndex(data))
  const index = { manifestVersion: AI_CAPABILITY_MANIFEST_VERSION, semanticVersion, protocols,
    surfaces, componentRoles: componentDefinitionSchema.shape.role.options,
    discovery: 'discovery.json', skills: 'skills/manifest.json', componentCatalog: 'component-catalog.snapshot.json',
    tools: discovery.tools, scope: scopeNote }
  files.set('index.json', readableResourceJson(index))
  const sizeWarning = indexSizeWarning(index)
  if (sizeWarning) console.warn(sizeWarning)
  return { files, capabilityBundle: canonicalJson(data), bundledSkillBundle: skills.bundle,
    indexBytes: Buffer.byteLength(files.get('index.json')!, 'utf8'), componentCatalogStatus: 'runtime-discovery' }
}

async function listJsonFiles(rootPath: string): Promise<string[]> {
  const output: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && /\.(json|md|mjs|py|ps1)$/.test(entry.name)) {
        output.push(path.relative(rootPath, absolute).replaceAll('\\', '/'))
      }
    }
  }
  await visit(rootPath)
  return output.sort((left, right) => left.localeCompare(right, 'en'))
}

export async function writeAiCapabilityArtifacts(
  outputRoot: string,
  generated: AiCapabilityGenerationResult,
): Promise<void> {
  for (const [relativePath, content] of generated.files) {
    const absolute = path.join(outputRoot, ...relativePath.split('/'))
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, 'utf8')
  }
  const expectedPaths = new Set(generated.files.keys())
  for (const relativePath of await listJsonFiles(outputRoot)) {
    if (expectedPaths.has(relativePath)) continue
    await fs.rm(path.join(outputRoot, ...relativePath.split('/')), { force: true })
  }
}

export async function checkAiCapabilityArtifacts(
  outputRoot: string,
  generated: AiCapabilityGenerationResult,
): Promise<void> {
  const failures: string[] = []
  const stalePaths: string[] = []
  for (const [relativePath, expected] of generated.files) {
    const absolute = path.join(outputRoot, ...relativePath.split('/'))
    let actual: string
    try {
      actual = await fs.readFile(absolute, 'utf8')
    } catch {
      failures.push(`缺失 ${relativePath}`)
      continue
    }
    if (actual !== expected) stalePaths.push(relativePath)
  }
  const staleCapabilityPaths = stalePaths.filter(
    (relativePath) => relativePath !== 'generation-evidence.json',
  )
  if (staleCapabilityPaths.length > 0) {
    failures.push(
      ...staleCapabilityPaths.map(
        (relativePath) => `能力生成物过期 ${relativePath}`,
      ),
    )
  } else if (stalePaths.includes('generation-evidence.json')) {
    failures.push('来源溯源证据过期 generation-evidence.json')
  }
  const expectedPaths = new Set(generated.files.keys())
  for (const relativePath of await listJsonFiles(outputRoot)) {
    if (!expectedPaths.has(relativePath)) failures.push(`多余 ${relativePath}`)
  }
  if (failures.length > 0) {
    throw new Error(
      `AI 能力清单生成检查失败：\n${failures.map((item) => `- ${item}`).join('\n')}\n` +
      '请运行 npm run generate:ai-capabilities 后重试。',
    )
  }
}

interface CliOptions {
  check: boolean
  projectRoot: string
  outputRoot: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let check = false
  let projectRoot = defaultProjectRoot
  let outputRoot: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--project-root' || argument === '--output-root') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} 缺少路径参数。`)
      index += 1
      if (argument === '--project-root') projectRoot = path.resolve(value)
      else if (argument === '--output-root') outputRoot = path.resolve(value)
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return {
    check,
    projectRoot,
    outputRoot: outputRoot ?? path.join(projectRoot, 'artifacts', 'ai-capabilities'),
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const generated = await generateAiCapabilityArtifacts({
    projectRoot: options.projectRoot,
  })
  if (options.check) {
    await checkAiCapabilityArtifacts(options.outputRoot, generated)
    if (options.outputRoot === path.join(options.projectRoot, 'artifacts', 'ai-capabilities')) {
      const bundle = await fs.readFile(path.join(options.projectRoot, 'src/shared/generated/courseAgentCapabilities.json'), 'utf8').catch(() => '')
      if (bundle !== generated.capabilityBundle) throw new Error('打包能力资源过期，请运行 generate:ai-capabilities')
      const skills = await fs.readFile(path.join(options.projectRoot, 'src/shared/generated/bundledSkills.json'), 'utf8').catch(() => '')
      if (skills !== generated.bundledSkillBundle) throw new Error('打包 Skill 资源过期，请运行 generate:ai-capabilities')
    }
    console.log(
      `AI 能力清单已是最新状态；索引 ${generated.indexBytes} 字节（建议 ${AI_CAPABILITY_INDEX_RECOMMENDED_BYTES} 字节），组件目录 ${generated.componentCatalogStatus}。`,
    )
    return
  }
  await writeAiCapabilityArtifacts(options.outputRoot, generated)
  if (options.outputRoot === path.join(options.projectRoot, 'artifacts', 'ai-capabilities')) {
    const target = path.join(options.projectRoot, 'src/shared/generated/courseAgentCapabilities.json')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, generated.capabilityBundle, 'utf8')
    await fs.writeFile(path.join(options.projectRoot, 'src/shared/generated/bundledSkills.json'), generated.bundledSkillBundle, 'utf8')
  }
  console.log(
    `已生成 ${generated.files.size} 个 AI 能力文件；索引 ${generated.indexBytes} 字节（建议 ${AI_CAPABILITY_INDEX_RECOMMENDED_BYTES} 字节），组件目录 ${generated.componentCatalogStatus}。`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
