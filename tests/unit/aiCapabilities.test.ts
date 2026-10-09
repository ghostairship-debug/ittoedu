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
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { publishedCourseV3Schema } from '../../src/shared/contracts/component-platform/published'
import { builtinComponentSourceKeys } from '../../src/core/components/source/builtinSources'
import { queryCourseAgentCapabilities, type CourseAgentCapabilityData } from '../../src/shared/courseAgentCapabilities'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
async function directory() {
  const value = await fs.mkdtemp(path.join(tmpdir(), 'guoling-capabilities-v10-')); directories.push(value); return value
}
const nativeRead = (source: string) => source.split(/\r?\n/).map(line => line.length > 2000 ? `${line.slice(0, 2000)}... (line truncated to 2000 chars)` : line).join('\n')

it('publishes complete current public tool schemas and V10/V3/API5 contracts readable through native line limits', async () => {
  const generated = await generateAiCapabilityArtifacts()
  const read = (location: string): unknown => JSON.parse(nativeRead(generated.files.get(location)!))
  const tools = [...describeTools().map(tool => ({ name: tool.name, inputSchema: tool.schema })), ...agentFileTools]
  for (const tool of tools) expect(read(`tools/${tool.name}.json`)).toMatchObject({ name: tool.name, inputSchema: tool.inputSchema })
  const discovery = read('discovery.json') as { tools: { id: string }[]; protocols: { id: string }[] }
  expect(discovery.tools.map(tool => tool.id).sort()).toEqual(tools.map(tool => tool.name).sort())
  expect(discovery.protocols.map(protocol => protocol.id).sort()).toEqual(['component-api5', 'course-project-v10', 'published-course-v3'])
  expect(read('schemas/course-project-v10.json')).toEqual(z.toJSONSchema(courseProjectV10Schema, { io: 'input' }))
  expect(read('schemas/published-course-v3.json')).toEqual(z.toJSONSchema(publishedCourseV3Schema, { io: 'input' }))
  const runtime = JSON.parse(generated.files.get('protocols/component-api5.json')!) as { apiVersion: number; types: Record<string, string> }
  expect(runtime.apiVersion).toBe(5)
  for (const [source, content] of Object.entries(runtime.types)) expect(content).toBe(await fs.readFile(source, 'utf8'))
  expect(read('component-catalog.snapshot.json')).toMatchObject({ status: 'runtime-discovery', builtinSourceKeys: [...builtinComponentSourceKeys].sort() })
  const index = read('index.json') as { protocols: unknown; surfaces: string[] }
  expect(index.protocols).toMatchObject({ project: { version: 10 }, published: { version: 3 }, component: { version: 5 } })
  expect(index.surfaces).toEqual(['slide', 'flow', 'spatial'])
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
