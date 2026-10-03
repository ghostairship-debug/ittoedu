// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import bundledSkills from '../../src/shared/generated/bundledSkills.json'
import { skillReadInputSchema, skillReadTool } from '../../src/core/tools/SkillTools'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { callTool, residentMcpFixture } from '../helpers/residentMcpFixture'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'
import { courseAgentMethodSkills } from '../../src/shared/courseAgentSkills'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const skill = bundledSkills.manifest.skills[0]!
const files: Readonly<Record<string, string>> = bundledSkills.files
const reference = skill.references[0]!
const referencePath = reference.slice(`skills/${skill.name}/`.length)

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-skill-tools-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const host = new DocumentHostService(path.join(root, 'documents'))
  const skills = new BundledSkillService(bundledSkills)
  host.tools.configureHostServices({ skills })
  const runs = new ExecutionRunStore(path.join(root, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const document = await host.internalAPI.create({ kind: 'markdown', source: '前文 OLD 后文', resources: { assets: {}, components: {} } }, 'lesson.md')
  return { host, skills, runs, events, document }
}

function sseCall(name: string, args: unknown, id: string) {
  return `data: ${JSON.stringify({ id: 'fixture-response', model: 'fixture-model', choices: [{ index: 0, delta: {
    tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
}
function sseStop(content: string) {
  return `data: ${JSON.stringify({ id: 'fixture-response', model: 'fixture-model', choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
}
async function localModel(handler: (body: any) => string) {
  const requests: any[] = []
  const server: Server = createServer(async (request, response) => {
    let raw = ''; for await (const bytes of request) raw += bytes.toString()
    const body = JSON.parse(raw); requests.push(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(handler(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  return { requests, baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }
}
function selection(baseURL: string): ModelSelection {
  return { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL,
    accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
}

describe('M24-T01 bundled Skill through real execution and MCP', () => {
  it('ordinary edit reads no Skill; creative HTTP/SSE run explicitly reads SKILL.md then a direct reference', async () => {
    const h = await fixture()
    let mode: 'edit' | 'creative' = 'edit', turn = 0
    const model = await localModel(body => {
      turn += 1
      if (mode === 'edit' && turn === 1) {
        const refs = JSON.parse(String(body.messages[1].content).split('：')[1])
        const name = body.tools.find((item: any) => item.function.parameters.properties.content)?.function.name
        return sseCall(name, { target: refs[0].writable[0].target, content: 'NEW' }, 'edit-1')
      }
      if (mode === 'edit') return sseStop('修改完成')
      const name = body.tools.find((item: any) => item.function.parameters.properties.skill)?.function.name
      if (turn === 1) return sseCall(name, { skill: skill.name }, 'skill-1')
      if (turn === 2) return sseCall(name, { skill: skill.name, path: referencePath }, 'skill-2')
      return sseStop('已读取创作资料')
    })
    const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' })
    const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, runs: h.runs, events: h.events, provider })
    const base: ExecutionStart = { conversationId: 'conversation', taskId: 'ordinary', instruction: '把局部改成 NEW', selection: selection(model.baseURL),
      documents: [{ documentId: h.document.documentId, writable: [{ kind: 'markdown-range', from: 3, to: 6 }] }] }
    const ordinary = await engine.start(base), ordinaryResult = await engine.wait(ordinary.runId)
    expect(ordinaryResult.tools.map(tool => tool.call.name), JSON.stringify({ status: ordinaryResult.status, failure: ordinaryResult.failure })).toEqual(['text.replace'])
    expect(ordinaryResult.tools[0]?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect((await h.host.internalAPI.read(h.document.documentId)).model).toMatchObject({ source: '前文 NEW 后文' })
    const ordinaryRequests = model.requests.slice()
    expect(ordinaryRequests).toHaveLength(2)
    mode = 'creative'; turn = 0
    const creative = await engine.start({ ...base, taskId: 'creative', instruction: '按随附 Skill 策划一课', documents: [] })
    const creativeResult = await engine.wait(creative.runId)
    expect(creativeResult.tools.map(tool => tool.call.name)).toEqual(['skills.read', 'skills.read'])
    expect(creativeResult.tools.map(tool => tool.result)).toMatchObject([
      { kind: 'read', data: { status: 'read', skill: skill.name, path: 'SKILL.md', version: skill.version, content: files[skill.path], truncated: false } },
      { kind: 'read', data: { status: 'read', skill: skill.name, path: referencePath, version: skill.version, content: files[reference], truncated: false } },
    ])
    const creativeRequests = model.requests.slice(ordinaryRequests.length)
    expect(creativeRequests).toHaveLength(3)
    for (const request of model.requests) {
      const systems = request.messages.filter((message: any) => message.role === 'system').map((message: any) => String(message.content)).join('\n')
      expect(systems).not.toContain(files[skill.path])
      const tool = request.tools.find((item: any) => item.function.parameters.properties.skill)
      expect(tool.function.description).toBe(skillReadTool(bundledSkills.manifest.skills).description)
      expect(tool.function.description).not.toContain(files[skill.path])
      expect(tool.function.description).not.toContain(files[reference])
      expect(tool.function.parameters).toEqual(z.toJSONSchema(skillReadInputSchema))
    }
    expect(bundledSkills.manifest.skills).toHaveLength(courseAgentMethodSkills.length)
    for (const entry of bundledSkills.manifest.skills)
      expect(model.requests[0].tools.find((item: any) => item.function.parameters.properties.skill).function.description)
        .toContain(`${entry.name}：${entry.description}`)
    expect(JSON.stringify(creativeRequests[1].messages)).toContain('SKILL.md')
    expect(JSON.stringify(creativeRequests[2].messages)).toContain(referencePath)
    const timeline = await h.events.snapshot('conversation')
    const reads = timeline.items.filter(item => item.type === 'tool' && item.data?.toolName === 'skills.read')
    expect(reads.length).toBeGreaterThanOrEqual(2)
    expect(reads.some(item => JSON.stringify(item.data).includes(referencePath) && JSON.stringify(item.data).includes(skill.version))).toBe(true)
  })

  it('MCP tools/list exposes the same schema and tools/call returns the bundled read result', async () => {
    const h = await fixture()
    const root = await mkdtemp(path.join(tmpdir(), 'g20-skill-mcp-'))
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
    const mcp = await residentMcpFixture({ host: h.host, directory: root, workspaceRoot: root, appendEvent: event => h.events.append(event) })
    cleanups.push(() => mcp.close())
    const client = await mcp.connect('skill-reader')
    const tools = (await client.listTools()).tools
    const listed = tools.find(tool => tool.name === 'skills.read')!
    const canonical = (await h.host.tools.describe()).find(tool => tool.name === 'skills.read')!
    expect(listed.description).toBe(canonical.description)
    expect(listed.inputSchema.properties!.arguments).toEqual(canonical.schema)
    expect(canonical.schema).toEqual(z.toJSONSchema(skillReadInputSchema))
    const reply = await callTool(client, 'skills.read', { skill: skill.name, path: referencePath })
    expect(reply.structuredContent.result).toMatchObject({ kind: 'read', data: { status: 'read', skill: skill.name,
      path: referencePath, version: skill.version, content: files[reference] } })
  })
})
