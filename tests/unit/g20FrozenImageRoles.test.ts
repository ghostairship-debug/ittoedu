// @vitest-environment node
import { expect, it } from 'vitest'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import type { ExecutionSelectionSnapshot } from '../../src/shared/workbench/executionSettings'

it('freezes each image role before tools run and never borrows a later profile for an unconfigured role', async () => {
  const connection = { id: 'oauth', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    auth: { kind: 'oauth', credentialRef: 'encrypted-reference' }, accountId: 'account',
    billing: { kind: 'unknown' }, capabilities: { stream: 'unknown', tools: 'unknown', vision: 'unknown', reasoning: 'unknown' } } as const
  let model = 'image-before', editReady = false
  const roles = frozenImageRoles(async role => {
    if (role === 'imageEdit' && !editReady) throw new Error('unconfigured')
    return { role, profileRevision: 1, profileUpdatedAt: '', connection, model, parameters: {} } as ExecutionSelectionSnapshot
  })
  await roles.beginRun('first')
  model = 'image-after'; editReady = true
  expect(roles.selection('first', 'generate').imageModel).toBe('image-before')
  expect(() => roles.selection('first', 'edit')).toThrow('开始时图片连接')
  const exposed = roles.selection('first', 'generate'); exposed.imageModel = 'tampered'
  expect(roles.selection('first', 'generate').imageModel).toBe('image-before')
  await roles.beginRun('second')
  expect(roles.selection('second', 'edit').imageModel).toBe('image-after')
  expect(() => roles.selection('unfrozen', 'generate')).toThrow('没有冻结')
})

it('keeps an old frozen API image snapshot without an explicit Images protocol unavailable', async () => {
  const enabled = { id: 'legacy-image-account', revision: 1, provider: 'teamorouter', protocol: 'openai-chat',
    imageProtocol: 'openai-images', baseURL: 'https://api.teamorouter.com/v1', accountId: 'account',
    auth: { kind: 'api-key', credentialRef: 'encrypted-reference' }, billing: { kind: 'metered' },
    capabilities: { stream: 'unknown', tools: 'unknown', vision: 'unknown', reasoning: 'unknown' } } as const
  const { imageProtocol: _oldProtocol, ...legacy } = enabled
  let current: ExecutionSelectionSnapshot['connection'] = legacy
  const roles = frozenImageRoles(async role => ({ role, profileRevision: 1, profileUpdatedAt: '',
    connection: current, model: 'gpt-image-2', parameters: {} }))

  await roles.beginRun('suspended-old-run')
  current = enabled
  await roles.beginRun('new-run')

  expect(() => roles.selection('suspended-old-run', 'generate')).toThrow('需要已接通的 GPT OAuth 或已启用 OpenAI Images API')
  expect(() => roles.selection('suspended-old-run', 'edit')).toThrow('需要已接通的 GPT OAuth 或已启用 OpenAI Images API')
  expect(roles.selection('new-run', 'generate').connection.imageProtocol).toBe('openai-images')
})
