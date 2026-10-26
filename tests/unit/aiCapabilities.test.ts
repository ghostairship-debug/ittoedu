// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { AI_CAPABILITY_INDEX_RECOMMENDED_BYTES, checkAiCapabilityArtifacts, generateAiCapabilityArtifacts, indexSizeWarning, writeAiCapabilityArtifacts } from '../../scripts/generate-ai-capabilities'
import { describeTools } from '../../src/core/tools/ToolCatalog'
import { agentFileTools } from '../../src/core/tools/AgentFileTools'
import { programmaticTools } from '../../src/core/tools/ProgrammaticTools'
import { createCourseFromHtmlInputSchema, createCourseFromHtmlTool } from '../../src/core/tools/HtmlImportTools'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { publishedCourseV3Schema } from '../../src/shared/contracts/component-platform/published'
import { builtinComponentSourceKeys } from '../../src/core/components/source/builtinSources'
import { queryCourseAgentCapabilities, type CourseAgentCapabilityData } from '../../src/shared/courseAgentCapabilities'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { ScopedSkillService } from '../../src/main/workbench/skills/ScopedSkillService'
import { executeSkillList, executeSkillRead } from '../../src/core/tools/SkillTools'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
async function directory() {
  const value = await fs.mkdtemp(path.join(tmpdir(), 'guoling-capabilities-v11-')); directories.push(value); return value
}
const nativeRead = (source: string) => source.split(/\r?\n/).map(line => line.length > 2000 ? `${line.slice(0, 2000)}... (line truncated to 2000 chars)` : line).join('\n')

it('publishes complete current public tool schemas and V11/V4/API5 contracts readable through native line limits', async () => {
  const generated = await generateAiCapabilityArtifacts()
  const read = (location: string): unknown => JSON.parse(nativeRead(generated.files.get(location)!))
  const tools = [
    ...describeTools().map(tool => ({ name: tool.name, inputSchema: tool.schema })), ...agentFileTools, ...programmaticTools,
    { ...createCourseFromHtmlTool, inputSchema: z.toJSONSchema(createCourseFromHtmlInputSchema) },
  ]
  for (const tool of tools) expect(read(`tools/${tool.name}.json`)).toMatchObject({ name: tool.name, inputSchema: tool.inputSchema })
  const discovery = read('discovery.json') as { tools: { id: string }[]; protocols: { id: string }[] }
  expect(discovery.tools.map(tool => tool.id).sort()).toEqual(tools.map(tool => tool.name).sort())
  expect(discovery.protocols.map(protocol => protocol.id).sort()).toEqual(['component-api5', 'course-project-v11', 'published-course-v4'])
  expect(read('schemas/course-project-v11.json')).toEqual(z.toJSONSchema(courseProjectV10Schema, { io: 'input' }))
  expect(read('schemas/published-course-v4.json')).toEqual(z.toJSONSchema(publishedCourseV3Schema, { io: 'input' }))
  const runtime = JSON.parse(generated.files.get('protocols/component-api5.json')!) as { apiVersion: number; types: Record<string, string> }
  expect(runtime.apiVersion).toBe(5)
  for (const [source, content] of Object.entries(runtime.types)) expect(content).toBe(await fs.readFile(source, 'utf8'))
  expect(read('component-catalog.snapshot.json')).toMatchObject({ status: 'runtime-discovery', builtinSourceKeys: [...builtinComponentSourceKeys].sort() })
  const index = read('index.json') as { protocols: unknown; surfaces: string[] }
  expect(index.protocols).toMatchObject({ project: { version: 11 }, published: { version: 4 }, component: { version: 5 } })
  expect(index.surfaces).toEqual(['slide', 'flow', 'spatial'])
  const program = queryCourseAgentCapabilities(JSON.parse(generated.capabilityBundle) as CourseAgentCapabilityData,
    { ids: ['project.apply'], surface: 'program', owner: 'instance', detail: 'full' })
  expect(program.total).toBe(1)
  expect(program.cards![0]!.content?.description).toContain('program.set')
})

it('serves complete scoped cards from the generated offline CLI and rejects stale discovery while keeping actual method resources', async () => {
  const generated = await generateAiCapabilityArtifacts(), root = await directory()
  await writeAiCapabilityArtifacts(root, generated)
  const data = JSON.parse(generated.capabilityBundle) as CourseAgentCapabilityData
  const run = promisify(execFile)
  const actual = await run(process.execPath, [path.join(root, 'query.mjs'), '--id', 'object.update', '--surface', 'slide', '--owner', 'instance'])
  expect(JSON.parse(actual.stdout)).toEqual(queryCourseAgentCapabilities(data, { ids: ['object.update'], surface: 'slide', owner: 'instance', detail: 'full' }).cards![0])
  await expect(run(process.execPath, [path.join(root, 'query.mjs'), '--semanticVersion', 'stale'])).rejects.toThrow()
  const manifest = JSON.parse(generated.files.get('skills/manifest.json')!) as { skills: { name: string; path: string; references: string[] }[] }
  expect(manifest.skills.length).toBeGreaterThan(0)
  for (const skill of manifest.skills) for (const location of [skill.path, ...skill.references]) {
    const relative = location.slice(`skills/${skill.name}/`.length)
    expect(generated.files.get(location)).toBe(await fs.readFile(path.join('.agents', 'skills', skill.name, relative), 'utf8'))
  }
  expect(indexSizeWarning({ authoredContent: 'x'.repeat(AI_CAPABILITY_INDEX_RECOMMENDED_BYTES) })).toContain('完整能力仍正常生成')
})

it('detects missing, stale and extra persisted capabilities without altering them, and deterministically repairs generated outputs', async () => {
  const generated = await generateAiCapabilityArtifacts(), second = await generateAiCapabilityArtifacts(), root = await directory()
  expect(Object.fromEntries(second.files)).toEqual(Object.fromEntries(generated.files))
  expect(second.capabilityBundle).toBe(generated.capabilityBundle)
  await writeAiCapabilityArtifacts(root, generated)
  await expect(checkAiCapabilityArtifacts(root, generated)).resolves.toBeUndefined()
  await fs.unlink(path.join(root, 'index.json'))
  await fs.writeFile(path.join(root, 'tools/object.update.json'), '{"stale":true}\n')
  await fs.writeFile(path.join(root, 'obsolete.json'), '{}\n')
  await expect(checkAiCapabilityArtifacts(root, generated)).rejects.toThrow(/缺失 index.json[\s\S]*能力生成物过期 tools\/object.update.json[\s\S]*多余 obsolete.json/)
  expect(await fs.readFile(path.join(root, 'tools/object.update.json'), 'utf8')).toBe('{"stale":true}\n')
  expect(await fs.readFile(path.join(root, 'obsolete.json'), 'utf8')).toBe('{}\n')
  await writeAiCapabilityArtifacts(root, generated)
  await expect(checkAiCapabilityArtifacts(root, generated)).resolves.toBeUndefined()
  await expect(fs.stat(path.join(root, 'obsolete.json'))).rejects.toThrow()
})

// These are the shipped consumer inputs, not a second generated copy in a temporary directory.
it('keeps persisted discovery and bundled GUI/Agent Skill consumers aligned with the current sources', async () => {
  const generated = await generateAiCapabilityArtifacts()
  await checkAiCapabilityArtifacts(path.resolve('artifacts/ai-capabilities'), generated)
  const capabilitySource = await fs.readFile('src/shared/generated/courseAgentCapabilities.json', 'utf8')
  const skillSource = await fs.readFile('src/shared/generated/bundledSkills.json', 'utf8')
  expect(capabilitySource).toBe(generated.capabilityBundle)
  expect(skillSource).toBe(generated.bundledSkillBundle)

  const bundle = JSON.parse(skillSource)
  const service = new ScopedSkillService(new BundledSkillService(bundle), async () => [])
  const catalog = bundle.manifest.skills.map(({ name, description }: { name: string; description: string }) => ({ name, description }))
  // The desktop menu asks this same service for roots, without creating a model run.
  expect(await service.catalogForRoots([])).toEqual({ entries: catalog, warnings: [] })
  expect(await executeSkillList(service, 's1-consumer-check', {})).toMatchObject({ kind: 'read', data: { entries: catalog, warnings: [] } })
  for (const resource of ['SKILL.md', 'references/creation-method.md']) {
    expect(await executeSkillRead(service, { skill: 'orchestrate-courseware', path: resource, limit: 64_000 }, 's1-consumer-check'))
      .toMatchObject({ kind: 'read', data: { status: 'read', content: await fs.readFile(`.agents/skills/orchestrate-courseware/${resource}`, 'utf8'), truncated: false } })
  }
  // The host composite is exposed by ExecutionEngine from HtmlImportTools;
  // it is not in the file/programmatic or document-scoped Gateway catalogs.
  const selectedNames = new Set(['course.createFromHtml', 'skills.read'])
  const live = [
    ...describeTools().map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema })),
    ...agentFileTools,
    ...programmaticTools,
    { ...createCourseFromHtmlTool, inputSchema: z.toJSONSchema(createCourseFromHtmlInputSchema) },
  ].filter(tool => selectedNames.has(tool.name))
  expect(live.map(tool => tool.name).sort()).toEqual([...selectedNames].sort())
  const persisted = JSON.parse(capabilitySource) as CourseAgentCapabilityData
  for (const tool of live) {
    const query = queryCourseAgentCapabilities(persisted, { ids: [tool.name], detail: 'full' })
    expect(query.total).toBe(1)
    expect(query.cards).toHaveLength(1)
    expect(query.cards![0]!.content).toMatchObject({ description: tool.description, inputSchema: tool.inputSchema })
  }
  const definition = live.find(tool => tool.name === 'course.createFromHtml')!
  expect(definition.inputSchema).toMatchObject({ properties: { path: { description: expect.stringContaining('输出目录') } } })
  const source = await fs.readFile('.agents/skills/build-courseware-project/SKILL.md', 'utf8')
  const example = JSON.parse(/```json\r?\n([^`]+)```/.exec(source)![1]!)
  expect(example.path).toBe('D:/课例')
  expect(example.name).toBe('斜抛运动')
})
