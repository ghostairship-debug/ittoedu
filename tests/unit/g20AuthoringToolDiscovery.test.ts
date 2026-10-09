// @vitest-environment node
import { expect, it } from 'vitest'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelToolDefinition } from '../../src/shared/workbench/modelProvider'
import { agentFileSchemas, agentFileTools } from '../../src/core/tools/AgentFileTools'

it('serializes the file write create/replace union as an object without changing its canonical branches', () => {
  const write = agentFileTools.find(tool => tool.name === 'file.write')!
  const body = JSON.parse(serializeModelRequest({ selection: {
    model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
      billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', reasoning: 'unknown', vision: 'unknown' } },
  }, messages: [{ role: 'user', content: 'fixture' }], tools: [write as ModelToolDefinition] }))
  expect(body.tools[0].function.parameters).toMatchObject({ type: 'object', oneOf: [{ type: 'object' }, { type: 'object' }] })
  expect(agentFileSchemas['file.write'].parse({ mode: 'create', path: 'lesson.html', content: '<h1>课例</h1>' }).mode).toBe('create')
  // replace no longer needs a prior read; a supplied expectedVersion is still checked when writing.
  expect(agentFileSchemas['file.write'].parse({ mode: 'replace', path: 'lesson.html', content: '<h1>课例</h1>' }).mode).toBe('replace')
})
