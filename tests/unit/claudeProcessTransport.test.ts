import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  CLAUDE_CLI_ARGS,
  discoverClaudeCapabilities,
  ClaudeProcessTransportAdapter,
  parseClaudeModels,
  buildClaudeCapabilities,
} from '../../src/main/localAgent/claudeProcessTransport'
import type { AgentExecutable } from '../../src/main/localAgent/process'
import { localAgentCapabilitiesSchema } from '../../src/shared/localAgentContract'
import { configureNativeSystemProxy } from '../../src/main/localAgent/nativeProxy'

afterEach(() => {
  vi.restoreAllMocks()
})

async function nativeFixture(onRequest: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-native-control-'))
  const fixture = path.join(directory, 'native.cjs')
  await fs.writeFile(fixture, `
    const fs = require('node:fs');
    if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
    const emit = value => console.log(JSON.stringify(value));
    const reply = (wire, response = {}) => emit({ type: 'control_response', response: { subtype: 'success', request_id: wire.request_id, response } });
    fs.writeFileSync('argv.json', JSON.stringify(process.argv));
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const wire = JSON.parse(line);
      fs.appendFileSync('requests.jsonl', JSON.stringify(wire) + '\\n');
      if (wire.request?.subtype === 'initialize') {
        reply(wire, { models: [{ value: 'default', resolvedModel: 'claude-opus-5[1m]', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] });
        return;
      }
      ${onRequest}
    });
  `)
  const adapter = new ClaudeProcessTransportAdapter(async () => ({ executable: process.execPath, prefix: [fixture] }))
  return { directory, adapter, async cleanup() {
    await adapter.close()
    await fs.rm(directory, { recursive: true, force: true })
  } }
}

function nativeTurn() {
  return {
    taskId: randomUUID(), epoch: 0,
    workspace: { version: 1 as const, projectId: 'test-p', normalizedPath: 'c:/test' },
    runId: randomUUID(), observationId: randomUUID(), text: 'test', imageFileIds: [],
  }
}

describe('Claude initialization failure reasons', () => {
  it('does not launch a native process after Stop during system proxy resolution', async () => {
    const test = await nativeFixture('')
    let release!: (value: string) => void, entered!: () => void
    const waiting = new Promise<string>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(key, undefined)
    configureNativeSystemProxy(async () => { entered(); return waiting })
    try {
      const opening = test.adapter.open({ cwd: test.directory, externalSessionId: null }).catch(error => error as Error)
      await started; await test.adapter.close(); release('DIRECT')
      expect(await opening).toBeInstanceOf(Error)
      await expect(fs.access(path.join(test.directory, 'argv.json'))).rejects.toThrow()
    } finally {
      release('DIRECT'); configureNativeSystemProxy(async () => 'DIRECT'); vi.unstubAllEnvs(); await test.cleanup()
    }
  })
  it.each([
    { stderr: 'authentication failed', code: 1, message: 'CLI 认证失效，请重新登录' },
    { stderr: 'unrecognized native failure', code: 7, message: 'Claude process exited 7' },
  ])('preserves the actionable reason before initialize: $stderr', async ({ stderr, code, message }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-initialize-failure-'))
    const fixture = path.join(directory, 'native.cjs')
    await fs.writeFile(fixture, `
      if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
      process.stderr.write(${JSON.stringify(stderr)});
      process.exitCode = ${code};
    `)
    const adapter = new ClaudeProcessTransportAdapter(async () => ({ executable: process.execPath, prefix: [fixture] }))
    try {
      await expect(adapter.open({ cwd: directory, externalSessionId: null })).rejects.toThrow(message)
    } finally {
      await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})

function questionAnswer(question: import('../../src/main/localAgent/claudeProcessTransport').AiQuestion, values: string[]) {
  return {
    version: 1 as const, taskId: question.taskId, epoch: question.epoch, workspace: question.workspace,
    inputId: randomUUID(), turnId: question.turnId, kind: 'answer' as const, questionId: question.questionId,
    answers: [{ id: question.questions[0]!.id, values }],
  }
}

describe('Claude candidate environment anchor', () => {
  it('launches each native session with the current candidate root and clears a stale inherited root', async () => {
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        fs.writeFileSync('environment.json', JSON.stringify({
          cwd: process.cwd(), candidateRoot: process.env.COURSEWARE_CANDIDATE_ROOT ?? null,
          nativeSetting: process.env.COURSEWARE_NATIVE_ENV_TEST,
        }));
        emit({type:'result', is_error:false, session_id:${JSON.stringify(randomUUID())}});
      }
    `)
    vi.stubEnv('COURSEWARE_CANDIDATE_ROOT', 'stale-parent-root')
    vi.stubEnv('COURSEWARE_NATIVE_ENV_TEST', 'keep-native-setting')
    try {
      for (const candidateRoot of [path.join(test.directory, '候选 A'), path.join(test.directory, '候选 B'), undefined]) {
        await test.adapter.open({ cwd: test.directory, externalSessionId: null, candidateRoot })
        await test.adapter.startTurn(nativeTurn(), new Map())
        for await (const _ of test.adapter.events()) { /* wait for the native read */ }
        expect(JSON.parse(await fs.readFile(path.join(test.directory, 'environment.json'), 'utf8'))).toEqual({
          cwd: test.directory, candidateRoot: candidateRoot ?? null, nativeSetting: 'keep-native-setting',
        })
        expect(process.env.COURSEWARE_CANDIDATE_ROOT).toBe('stale-parent-root')
        await test.adapter.close()
      }
    } finally { await test.cleanup(); vi.unstubAllEnvs() }
  })
})

describe('Claude native text block identity', () => {
  it('preserves initial text block content and marks only an explicit end_turn snapshot as final', async () => {
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        emit({type:'system', subtype:'init', session_id:${JSON.stringify(randomUUID())}});
        emit({type:'stream_event', event:{type:'message_start', message:{id:'visible-message'}}});
        emit({type:'stream_event', event:{type:'content_block_start', index:0, content_block:{type:'text', text:'Initial words. '}}});
        emit({type:'stream_event', event:{type:'content_block_delta', index:0, delta:{type:'text_delta', text:'Complete reply.'}}});
        emit({type:'assistant', message:{id:'visible-message', stop_reason:'end_turn', content:[{type:'text', text:'Initial words. Complete reply.'}]}});
        emit({type:'result', is_error:false});
      }
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []; for await (const event of test.adapter.events()) if (event.kind === 'text') events.push(event)
      expect(events.map(event => [event.itemId, event.operation, event.phase, event.text])).toEqual([
        ['visible-message:0', 'append', 'body', 'Initial words. '],
        ['visible-message:0', 'append', 'body', 'Complete reply.'],
        ['visible-message:0', 'replace', 'final', 'Initial words. Complete reply.'],
      ])
    } finally { await test.cleanup() }
  })

  it('replaces streamed text after a non-text block using its native index, preserving every raw text event', async () => {
    const text = '<courseware-candidate-v1>{"candidate":"unit"}</courseware-candidate-v1>'
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        const text = ${JSON.stringify(text)};
        emit({type:'system', subtype:'init', session_id:${JSON.stringify(randomUUID())}});
        emit({type:'stream_event', event:{type:'message_start', message:{id:'native-message'}}});
        emit({type:'stream_event', event:{type:'content_block_start', index:0, content_block:{type:'thinking'}}});
        emit({type:'stream_event', event:{type:'content_block_start', index:1, content_block:{type:'text', text:''}}});
        emit({type:'stream_event', event:{type:'content_block_delta', index:1, delta:{type:'text_delta', text:text.slice(0, 19)}}});
        emit({type:'stream_event', event:{type:'content_block_delta', index:1, delta:{type:'text_delta', text:text.slice(19)}}});
        emit({type:'assistant', message:{id:'native-message', content:[{type:'text', text}]}});
        emit({type:'result', is_error:false});
      }
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) if (event.kind === 'text') events.push(event)
      expect(events.map(event => [event.itemId, event.operation, event.text])).toEqual([
        ['native-message:1', 'append', text.slice(0, 19)],
        ['native-message:1', 'append', text.slice(19)],
        ['native-message:1', 'replace', text],
      ])
    } finally { await test.cleanup() }
  })

  it('keeps separate text blocks and separate native messages distinct, with final-position fallback when no stream was observed', async () => {
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        emit({type:'system', subtype:'init', session_id:${JSON.stringify(randomUUID())}});
        emit({type:'stream_event', event:{type:'message_start', message:{id:'two-blocks'}}});
        emit({type:'stream_event', event:{type:'content_block_start', index:0, content_block:{type:'thinking'}}});
        emit({type:'stream_event', event:{type:'content_block_start', index:1, content_block:{type:'text', text:''}}});
        emit({type:'stream_event', event:{type:'content_block_delta', index:1, delta:{type:'text_delta', text:'First'}}});
        emit({type:'stream_event', event:{type:'content_block_start', index:3, content_block:{type:'text', text:''}}});
        emit({type:'stream_event', event:{type:'content_block_delta', index:3, delta:{type:'text_delta', text:'Second'}}});
        emit({type:'assistant', message:{id:'two-blocks', content:[{type:'text', text:'First'}, {type:'text', text:'Second'}]}});
        emit({type:'assistant', message:{id:'another-message', content:[{type:'text', text:'First'}, {type:'text', text:'Second'}]}});
        emit({type:'assistant', message:{id:'final-only', content:[{type:'thinking'}, {type:'text', text:'First'}]}});
        emit({type:'result', is_error:false});
      }
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) if (event.kind === 'text') events.push(event)
      expect(events.map(event => [event.itemId, event.operation, event.text])).toEqual([
        ['two-blocks:1', 'append', 'First'], ['two-blocks:3', 'append', 'Second'],
        ['two-blocks:1', 'replace', 'First'], ['two-blocks:3', 'replace', 'Second'],
        ['another-message:0', 'replace', 'First'], ['another-message:1', 'replace', 'Second'],
        ['final-only:1', 'replace', 'First'],
      ])
    } finally { await test.cleanup() }
  })
})

describe('Claude native permissions and questions', () => {
  it.each(['correct', 'supplement'] as const)('queues %s only for the live matching turn without sending a native mid-turn message', async kind => {
    const fixture = await nativeFixture(`
      if (wire.type === 'user') emit({type:'assistant', message:{content:[{type:'text', text:'working'}]}});
      if (wire.request?.subtype === 'interrupt') {
        reply(wire);
        emit({type:'result', is_error:true, terminal_reason:'aborted_streaming'});
      }
    `)
    try {
      await fixture.adapter.open({ cwd: fixture.directory, externalSessionId: null })
      const turn = nativeTurn()
      await fixture.adapter.startTurn(turn, new Map())
      const events = fixture.adapter.events()[Symbol.asyncIterator]()
      while (true) {
        const event = await events.next()
        if (event.done) throw new Error('Fixture must remain in a live native turn')
        if (event.value.kind === 'text') break
      }
      const input = { version: 1 as const, taskId: turn.taskId, epoch: turn.epoch, workspace: turn.workspace,
        inputId: randomUUID(), turnId: turn.runId, kind, text: 'Preserve the existing title and picture' }
      for (const wrong of [
        { ...input, taskId: randomUUID() }, { ...input, epoch: turn.epoch + 1 },
        { ...input, workspace: { ...turn.workspace, projectId: 'other-project' } },
        { ...input, workspace: { ...turn.workspace, normalizedPath: 'c:/other' } },
        { ...input, turnId: randomUUID() },
      ]) expect((await fixture.adapter.input(wrong)).status).toBe('rejected')
      expect(await fixture.adapter.input(input)).toMatchObject({ status: 'queued', taskId: turn.taskId,
        epoch: turn.epoch, workspace: turn.workspace, inputId: input.inputId, turnId: turn.runId })
      const wires = (await fs.readFile(path.join(fixture.directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(wires.filter(wire => wire.type === 'user')).toHaveLength(1)
      expect(wires.some(wire => JSON.stringify(wire).includes(input.text))).toBe(false)
      await fixture.adapter.interrupt()
      while (!(await events.next()).done) { /* consume the actual interrupted result */ }
      expect((await fixture.adapter.input(input)).status).toBe('rejected')
    } finally { await fixture.cleanup() }
  })

  it('preserves native tool availability and sends independent allow/deny decisions for concurrent requests', async () => {
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        emit({type:'system', subtype:'init', session_id:${JSON.stringify(randomUUID())}});
        emit({type:'assistant', message:{content:[{type:'tool_use', id:'read-tool', name:'Read'}, {type:'tool_use', id:'bash-tool', name:'Bash'}]}});
        emit({type:'control_request', request_id:'read-outside', request:{subtype:'can_use_tool', tool_name:'Read', input:{file_path:'../native-context.txt'}}});
        emit({type:'control_request', request_id:'terminal-action', request:{subtype:'can_use_tool', tool_name:'Bash', input:{command:'pwd'}}});
      }
      if (wire.type === 'control_response') {
        globalThis.replies = (globalThis.replies || 0) + 1;
        emit({type:'user', message:{content:[{type:'tool_result', tool_use_id:wire.response.request_id === 'read-outside' ? 'read-tool' : 'bash-tool', is_error:wire.response.response.behavior === 'deny', content:wire.response.response.behavior}]}});
        if (globalThis.replies === 2) emit({type:'result', is_error:false});
      }
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      const argv: string[] = JSON.parse(await fs.readFile(path.join(test.directory, 'argv.json'), 'utf8'))
      expect(argv).not.toContain('--tools')
      expect(argv).not.toContain('--disable-slash-commands')
      expect(argv).toContain('--permission-prompt-tool')
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      const questions: import('../../src/main/localAgent/claudeProcessTransport').AiQuestion[] = []
      for await (const event of test.adapter.events()) {
        events.push(event)
        if (event.kind !== 'question') continue
        questions.push(event.question)
        expect(event.question.purpose).toBe('permission')
        if (questions.length !== 2) continue
        const read = questions.find(question => question.questionId === 'read-outside')!
        const bash = questions.find(question => question.questionId === 'terminal-action')!
        expect(read.questions[0]!.title).toContain('../native-context.txt')
        expect(bash.questions[0]!.title).toContain('pwd')
        expect((await test.adapter.input({ ...questionAnswer(read, ['允许这次操作']), workspace: { ...read.workspace, normalizedPath: 'c:/different' } })).status).toBe('rejected')
        expect((await test.adapter.input(questionAnswer(read, ['maybe']))).status).toBe('rejected')
        expect((await test.adapter.input(questionAnswer(bash, ['拒绝这次操作']))).status).toBe('accepted')
        expect((await test.adapter.input(questionAnswer(read, ['允许这次操作']))).status).toBe('accepted')
        expect((await test.adapter.input(questionAnswer(read, ['允许这次操作']))).status).toBe('rejected')
      }
      const wireRequests = (await fs.readFile(path.join(test.directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(wireRequests.filter(wire => wire.type === 'control_response').map(wire => wire.response)).toEqual([
        { subtype: 'success', request_id: 'terminal-action', response: { behavior: 'deny', message: '用户拒绝了这次工具操作' } },
        { subtype: 'success', request_id: 'read-outside', response: { behavior: 'allow', updatedInput: { file_path: '../native-context.txt' } } },
      ])
      expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', itemId: 'bash-tool', name: 'Bash', status: 'failed' }))
      expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', itemId: 'read-tool', name: 'Read', status: 'completed' }))
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
    } finally { await test.cleanup() }
  })

  it('leaves an already authorized native tool result to the CLI without creating an extra permission gate', async () => {
    const test = await nativeFixture(`if (wire.type === 'user') {
      emit({type:'assistant', session_id:${JSON.stringify(randomUUID())}, message:{content:[{type:'tool_use', id:'skill', name:'Skill', input:{skill:'native-user-skill'}}]}});
      emit({type:'user', message:{content:[{type:'tool_result', tool_use_id:'skill', content:'native tool result'}]}});
      emit({type:'result', is_error:false});
    }`)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) events.push(event)
      expect(events.some(event => event.kind === 'question')).toBe(false)
      expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', name: 'Skill', status: 'completed' }))
    } finally { await test.cleanup() }
  })

  it('cancels every pending authorization and rejects a late answer before continuing the same process', async () => {
    const sessionId = randomUUID()
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        globalThis.turn = (globalThis.turn || 0) + 1;
        emit({type:'system', subtype:'init', session_id:${JSON.stringify(sessionId)}});
        if (globalThis.turn > 1) { emit({type:'result', is_error:false}); return; }
        for (const id of ['permission-one','permission-two']) emit({type:'control_request', request_id:id, request:{subtype:'can_use_tool', tool_name:'Edit', input:{file_path:id}}});
      }
      if (wire.request?.subtype === 'interrupt') {
        reply(wire);
        emit({type:'result', is_error:true, terminal_reason:'aborted_streaming'});
      }
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      const turn = nativeTurn()
      await test.adapter.startTurn(turn, new Map())
      const events = []
      let firstQuestion: import('../../src/main/localAgent/claudeProcessTransport').AiQuestion | undefined
      for await (const event of test.adapter.events()) {
        events.push(event)
        if (event.kind === 'question') {
          firstQuestion ??= event.question
          if (event.question.questionId === 'permission-two') await test.adapter.interrupt()
        }
      }
      expect(events.at(-1)).toMatchObject({ status: 'cancelled' })
      expect((await test.adapter.input(questionAnswer(firstQuestion!, ['允许这次操作']))).status).toBe('rejected')
      const wireRequests = (await fs.readFile(path.join(test.directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(wireRequests.filter(wire => wire.type === 'control_response').map(wire => [wire.response.request_id, wire.response.response.behavior])).toEqual([
        ['permission-one', 'deny'], ['permission-two', 'deny'],
      ])
      await test.adapter.startTurn({ ...turn, runId: randomUUID(), text: 'continue' }, new Map())
      const continued = []
      for await (const event of test.adapter.events()) continued.push(event)
      expect(continued.at(-1)).toMatchObject({ status: 'completed' })
      expect(test.adapter.getExternalSessionId()).toBe(sessionId)
    } finally { await test.cleanup() }
  })

  it('maps stable question IDs back to the complete native question text and keeps free-form answers', async () => {
    const fullQuestion = 'Select a direction. '.repeat(20)
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        emit({type:'system', subtype:'init', session_id:${JSON.stringify(randomUUID())}});
        emit({type:'control_request', request_id:'question-long', request:{subtype:'can_use_tool', tool_name:'AskUserQuestion', input:{questions:[{question:${JSON.stringify(fullQuestion)}, options:[{label:'Left'},{label:'Right'}]}]}}});
      }
      if (wire.type === 'control_response') emit({type:'result', is_error:false});
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      for await (const event of test.adapter.events()) {
        if (event.kind === 'question') {
          expect(event.question.purpose).toBe('clarification')
          expect(event.question.questions[0]!.id).toBe('question-1')
          expect((await test.adapter.input(questionAnswer(event.question, ['A different direction']))).status).toBe('accepted')
        }
      }
      const requests = (await fs.readFile(path.join(test.directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const answer = requests.find(wire => wire.type === 'control_response')
      expect(answer.response.response.updatedInput.answers).toEqual({ [fullQuestion]: 'A different direction' })
    } finally { await test.cleanup() }
  })
})

describe('Claude native session and configuration confirmation', () => {
  it.each(['system', 'result'])('records only the native session identity from %s', async source => {
    const sessionId = randomUUID()
    const test = await nativeFixture(`
      if (wire.type === 'user') {
        ${source === 'system' ? `emit({type:'system', subtype:'init', model:'claude-opus-5[1m]', session_id:${JSON.stringify(sessionId)}});` : ''}
        emit({type:'result', is_error:false, ${source === 'result' ? `session_id:${JSON.stringify(sessionId)}` : ''}});
      }
    `)
    try {
      const opened = await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      expect(opened.externalSessionId).toBeNull()
      expect(test.adapter.getExternalSessionId()).toBeNull()
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'completed' })
      expect(test.adapter.getExternalSessionId()).toBe(sessionId)
      if (source === 'system') expect(events).toContainEqual(expect.objectContaining({ kind: 'configuration', capabilities: expect.objectContaining({ current: { model: 'default', resolvedModel: 'claude-opus-5[1m]', effort: null } }) }))
    } finally { await test.cleanup() }
  })

  it.each([true, false])('requires a native echo of the requested resume ID (matching=%s)', async matching => {
    const requested = randomUUID()
    const emitted = matching ? requested : randomUUID()
    const test = await nativeFixture(`if (wire.type === 'user') emit({type:'result', is_error:false, session_id:${JSON.stringify(emitted)}});`)
    try {
      const opened = await test.adapter.open({ cwd: test.directory, externalSessionId: requested })
      expect(opened.externalSessionId).toBeNull()
      expect(test.adapter.getExternalSessionId()).toBeNull()
      const argv = JSON.parse(await fs.readFile(path.join(test.directory, 'argv.json'), 'utf8'))
      expect(argv.slice(argv.indexOf('--resume'), argv.indexOf('--resume') + 2)).toEqual(['--resume', requested])
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: matching ? 'completed' : 'failed' })
      expect(test.adapter.getExternalSessionId()).toBe(matching ? requested : null)
      if (!matching) {
        expect(events.at(-1)).toMatchObject({ failure: { category: 'protocol' } })
        await expect(test.adapter.startTurn(nativeTurn(), new Map())).rejects.toThrow('会话不匹配')
      }
    } finally { await test.cleanup() }
  })

  it('does not report a resumable success when the native process omits its identity', async () => {
    const test = await nativeFixture(`if (wire.type === 'user') emit({type:'result', is_error:false});`)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', status: 'failed', failure: { category: 'protocol' } })
      expect(test.adapter.getExternalSessionId()).toBeNull()
    } finally { await test.cleanup() }
  })

  it('rejects a changed native identity without replacing the already confirmed one', async () => {
    const confirmed = randomUUID()
    const test = await nativeFixture(`if (wire.type === 'user') {
      emit({type:'system', subtype:'init', session_id:${JSON.stringify(confirmed)}});
      emit({type:'result', is_error:false, session_id:${JSON.stringify(randomUUID())}});
    }`)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) events.push(event)
      expect(events.at(-1)).toMatchObject({ status: 'failed', failure: { category: 'protocol' } })
      expect(test.adapter.getExternalSessionId()).toBe(confirmed)
    } finally { await test.cleanup() }
  })

  it.each(['set_model', 'apply_flag_settings'])('surfaces a rejected native %s instead of a configured success', async rejected => {
    const test = await nativeFixture(`if (wire.type === 'control_request') {
      if (wire.request.subtype === ${JSON.stringify(rejected)}) emit({type:'control_response', response:{subtype:'error', request_id:wire.request_id, error:'native policy rejection'}});
      else reply(wire);
    }`)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await expect(test.adapter.configure({ model: 'default', effort: 'high' })).rejects.toThrow('native policy rejection')
      const requests = (await fs.readFile(path.join(test.directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(requests.some(wire => wire.request?.subtype === rejected)).toBe(true)
      expect(requests.some(wire => wire.type === 'user')).toBe(false)
    } finally { await test.cleanup() }
  })

  it('rejects pending configuration promptly when the native process exits', async () => {
    const test = await nativeFixture(`if (wire.request?.subtype === 'set_model') process.exit(7);`)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      await expect(test.adapter.configure({ model: 'default', effort: 'high' })).rejects.toThrow('exited 7')
    } finally { await test.cleanup() }
  })

  it('publishes configuration after native acknowledgments and reflects the actual init model', async () => {
    const test = await nativeFixture(`
      if (wire.type === 'control_request') reply(wire);
      if (wire.type === 'user') {
        emit({type:'system', subtype:'init', model:'different-native-model', session_id:${JSON.stringify(randomUUID())}});
        emit({type:'result', is_error:false});
      }
    `)
    try {
      await test.adapter.open({ cwd: test.directory, externalSessionId: null })
      const configured = await test.adapter.configure({ model: 'default', effort: 'high' })
      expect(configured.current).toEqual({ model: 'default', resolvedModel: 'claude-opus-5[1m]', effort: 'high' })
      await test.adapter.startTurn(nativeTurn(), new Map())
      const events = []
      for await (const event of test.adapter.events()) events.push(event)
      const configurations = events.filter(event => event.kind === 'configuration')
      expect(configurations[0]).toMatchObject({ capabilities: { current: configured.current } })
      expect(configurations.at(-1)).toMatchObject({ capabilities: { current: { model: null, resolvedModel: 'different-native-model', effort: null } } })
    } finally { await test.cleanup() }
  })
})

describe('Claude capabilities discovery and model parsing', () => {
  it('parses raw models into valid LocalAgentCapabilities', () => {
    const rawModels = [
      {
        value: 'default',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Default (recommended)',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        value: 'sonnet',
        resolvedModel: 'claude-sonnet-5',
        displayName: 'Sonnet',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        value: 'haiku',
        resolvedModel: 'claude-haiku-4-5-20251001',
        displayName: 'Haiku',
      },
    ]

    const caps = buildClaudeCapabilities('2.1.263', rawModels)
    expect(caps.adapter).toBe('claude')
    expect(caps.cliVersion).toBe('2.1.263')
    expect(caps.input).toEqual({
      image: 'supported',
      readFile: 'supported',
      question: 'structured',
      correction: 'turn-boundary',
      cancel: 'supported',
    })
    expect(caps.current).toEqual({
      model: null,
      resolvedModel: null,
      effort: null,
    })
    expect(caps.models).toHaveLength(3)
    expect(caps.models[0]?.effort).toEqual({
      kind: 'supported',
      values: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: null,
    })
    expect(caps.models[2]?.effort).toEqual({ kind: 'unsupported' })
    expect(localAgentCapabilitiesSchema.parse(caps)).toBeDefined()
    expect(parseClaudeModels([])).toEqual([])
  })

  it('discoverClaudeCapabilities starts Claude, handshakes initialize, and stops', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-discovery-'))
    const fixture = path.join(directory, 'mock-claude.cjs')

    // Script that handles --version and initialize control_request
    const script = `
      const readline = require('node:readline');
      if (process.argv.includes('--version')) {
        console.log('2.1.263 (Claude Code)');
        process.exit(0);
      }
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', line => {
        try {
          const wire = JSON.parse(line);
          if (wire.type === 'control_request' && wire.request && wire.request.subtype === 'initialize') {
            const resp = {
              type: 'control_response',
              response: {
                subtype: 'success',
                request_id: wire.request_id,
                response: {
                  models: [
                    {
                      value: 'default',
                      resolvedModel: 'claude-opus-5[1m]',
                      displayName: 'Default (recommended)',
                      supportsEffort: true,
                      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
                    },
                    {
                      value: 'haiku',
                      resolvedModel: 'claude-haiku-4-5-20251001',
                      displayName: 'Haiku'
                    }
                  ]
                }
              }
            };
            console.log(JSON.stringify(resp));
          }
        } catch {}
      });
    `
    await fs.writeFile(fixture, script)
    const binary: AgentExecutable = { executable: process.execPath, prefix: [fixture] }

    try {
      const caps = await discoverClaudeCapabilities(binary, directory)
      expect(caps.adapter).toBe('claude')
      expect(caps.cliVersion).toBe('2.1.263')
      expect(caps.models).toHaveLength(2)
      expect(caps.models[0]?.id).toBe('default')
      expect(caps.models[0]?.resolvedModel).toBe('claude-opus-5[1m]')
      expect(caps.current.model).toBeNull()
      expect(caps.input.question).toBe('structured')
      expect(caps.input.correction).toBe('turn-boundary')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})

describe('ClaudeProcessTransportAdapter', () => {
  it('probes ready, unauthenticated, unsupported-version, and missing', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-probe-'))
    const fixture = path.join(directory, 'probe.cjs')
    const writeScript = (code: string) => fs.writeFile(fixture, code)

    const adapter = new ClaudeProcessTransportAdapter(async () => ({
      executable: process.execPath,
      prefix: [fixture],
    }))

    try {
      // Missing
      const missingAdapter = new ClaudeProcessTransportAdapter(async () => null)
      expect((await missingAdapter.probe()).status).toBe('missing')

      // Unsupported version
      await writeScript('if (process.argv.includes("--version")) console.log("3.0.0");')
      expect((await adapter.probe()).status).toBe('unsupported-version')

      // Unauthenticated
      await writeScript(`
        if (process.argv.includes("--version")) console.log("2.1.263");
        else if (process.argv.includes("auth")) {
          console.log('{"loggedIn":false}');
          process.exit(1);
        }
      `)
      expect((await adapter.probe()).status).toBe('unauthenticated')

      // Ready
      await writeScript(`
        if (process.argv.includes("--version")) console.log("2.1.263");
        else if (process.argv.includes("auth")) {
          console.log('{"loggedIn":true}');
          process.exit(0);
        }
      `)
      expect((await adapter.probe()).status).toBe('ready')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('confirms native model and effort controls, clears unsupported effort, and rejects unknown model', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-config-'))
    const fixture = path.join(directory, 'dummy.cjs')
    await fs.writeFile(
      fixture,
      `
      const readline = require('node:readline');
      const fs = require('node:fs');
      if (process.argv.includes('--version')) { console.log('2.1.0'); process.exit(0); }
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', line => {
        const wire = JSON.parse(line);
        fs.appendFileSync('requests.jsonl', JSON.stringify(wire) + '\\n');
        if (wire.type === 'control_request' && wire.request?.subtype === 'initialize') {
          console.log(JSON.stringify({
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: wire.request_id,
              response: {
                models: [
                  { value: 'default', resolvedModel: 'claude-opus-5[1m]', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
                  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
                  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001' }
                ]
              }
            }
          }));
        } else if (wire.type === 'control_request') {
          console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: wire.request_id } }));
        }
      });
    `,
    )

    const adapter = new ClaudeProcessTransportAdapter(async () => ({
      executable: process.execPath,
      prefix: [fixture],
    }))

    try {
      const opened = await adapter.open({ cwd: directory, externalSessionId: null })
      expect(opened.capabilities.current.model).toBeNull()
      expect(opened.externalSessionId).toBeNull()
      expect(adapter.getExternalSessionId()).toBeNull()

      // Configure to sonnet with high effort
      const configured = await adapter.configure({ model: 'sonnet', effort: 'high' })
      expect(configured.current.model).toBe('sonnet')
      expect(configured.current.resolvedModel).toBe('claude-sonnet-5')
      expect(configured.current.effort).toBe('high')

      // Configure to haiku (no effort support) clears effort to null
      const haikuConfig = await adapter.configure({ model: 'haiku', effort: 'high' })
      expect(haikuConfig.current.model).toBe('haiku')
      expect(haikuConfig.current.effort).toBeNull()

      // Unknown model throws
      await expect(adapter.configure({ model: 'gpt-4', effort: null })).rejects.toThrow('不在 Claude 原生目录中')
      const requests = (await fs.readFile(path.join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).request)
      expect(requests.slice(1)).toEqual([
        { subtype: 'set_model', model: 'sonnet' },
        { subtype: 'apply_flag_settings', settings: { effortLevel: 'high' } },
        { subtype: 'set_model', model: 'haiku' },
        { subtype: 'apply_flag_settings', settings: { effortLevel: null } },
      ])
    } finally {
      await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('runs startTurn with image, keeps stdin open, handles tool calls, AskUserQuestion, and completes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-turn-'))
    const fixture = path.join(directory, 'server.cjs')
    const obsPath = path.join(directory, 'observation.txt')
    await fs.writeFile(obsPath, 'TOKEN-1234')

    const imagePath = path.join(directory, 'sample.png')
    await fs.writeFile(imagePath, Buffer.from('fake-png-data'))

    // Full interactive Claude simulator
    const serverScript = `
      const readline = require('node:readline');
      if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
      const rl = readline.createInterface({ input: process.stdin });
      
      let sessionId = 'ea54bf7d-093a-4687-b31e-c1fe24dbbb1c';
      let turnCount = 0;

      rl.on('line', line => {
        try {
          const wire = JSON.parse(line);
          if (wire.type === 'control_request' && wire.request?.subtype === 'initialize') {
            console.log(JSON.stringify({
              type: 'control_response',
              response: {
                subtype: 'success',
                request_id: wire.request_id,
                response: {
                  models: [{ value: 'default', resolvedModel: 'claude-opus-5[1m]', supportsEffort: true, supportedEffortLevels: ['low'] }]
                }
              }
            }));
            return;
          }

          if (wire.type === 'user') {
            turnCount++;
            console.log(JSON.stringify({
              type: 'command_lifecycle',
              command_uuid: wire.uuid,
              state: 'started',
              session_id: sessionId
            }));
            console.log(JSON.stringify({
              type: 'system',
              subtype: 'init',
              session_id: sessionId
            }));

            if (turnCount === 1) {
              // First turn: streams text, requests Read tool, then completes
              console.log(JSON.stringify({
                type: 'stream_event',
                event: { type: 'message_start', message: { id: 'msg-1' } }
              }));
              console.log(JSON.stringify({
                type: 'stream_event',
                event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
              }));
              console.log(JSON.stringify({
                type: 'stream_event',
                event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '正在' } }
              }));
              console.log(JSON.stringify({
                type: 'stream_event',
                event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '读取' } }
              }));
              console.log(JSON.stringify({
                type: 'assistant',
                message: {
                  id: 'msg-1',
                  content: [
                    { type: 'text', text: '正在读取' },
                    { type: 'tool_use', id: 'tool-read-1', name: 'Read', input: { file_path: 'observation.txt' } }
                  ]
                }
              }));
              // Send can_use_tool control_request
              console.log(JSON.stringify({
                type: 'control_request',
                request_id: 'ctrl-req-1',
                request: {
                  subtype: 'can_use_tool',
                  tool_name: 'Read',
                  input: { file_path: 'observation.txt' }
                }
              }));
            } else if (turnCount === 2) {
              // Second turn: asks AskUserQuestion
              console.log(JSON.stringify({
                type: 'assistant',
                message: {
                  id: 'msg-2',
                  content: [
                    { type: 'tool_use', id: 'tool-q-1', name: 'AskUserQuestion', input: {
                      questions: [{ question: 'Color?', options: ['Green', 'Blue'] }]
                    }}
                  ]
                }
              }));
              console.log(JSON.stringify({
                type: 'control_request',
                request_id: 'ctrl-req-2',
                request: {
                  subtype: 'can_use_tool',
                  tool_name: 'AskUserQuestion',
                  input: { questions: [{ question: 'Color?', options: ['Green', 'Blue'] }] }
                }
              }));
            }
            return;
          }

          if (wire.type === 'control_response') {
            if (wire.response?.request_id === 'ctrl-req-1') {
              // Read allowed
              console.log(JSON.stringify({
                type: 'user',
                message: {
                  content: [{ type: 'tool_result', tool_use_id: 'tool-read-1', content: 'TOKEN-1234' }]
                }
              }));
              console.log(JSON.stringify({
                type: 'result',
                subtype: 'success',
                terminal_reason: 'completed',
                is_error: false,
                usage: { input_tokens: 10, output_tokens: 20 }
              }));
            } else if (wire.response?.request_id === 'ctrl-req-2') {
              // AskUserQuestion answered
              console.log(JSON.stringify({
                type: 'user',
                message: {
                  content: [{ type: 'tool_result', tool_use_id: 'tool-q-1', content: 'Answered: Green' }]
                }
              }));
              console.log(JSON.stringify({
                type: 'stream_event',
                event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '已选绿色' } }
              }));
              console.log(JSON.stringify({
                type: 'result',
                subtype: 'success',
                terminal_reason: 'completed',
                is_error: false,
                usage: { input_tokens: 15, output_tokens: 25 },
                modelUsage: {
                  'claude-opus-5[1m]': { inputTokens: 15, outputTokens: 25 }
                }
              }));
            }
            return;
          }
        } catch {}
      });
    `
    await fs.writeFile(fixture, serverScript)

    const adapter = new ClaudeProcessTransportAdapter(async () => ({
      executable: process.execPath,
      prefix: [fixture],
    }))

    try {
      const opened = await adapter.open({ cwd: directory, externalSessionId: null })
      expect(opened.capabilities.adapter).toBe('claude')

      const workspace = { version: 1 as const, projectId: 'test-p', normalizedPath: 'c:/test' }
      const files = new Map<string, string>([
        ['observation.txt', obsPath],
        ['sample.png', imagePath],
      ])

      // Turn 1
      const turn1 = await adapter.startTurn(
        {
          taskId: randomUUID(),
          epoch: 0,
          workspace,
          runId: randomUUID(),
          observationId: randomUUID(),
          text: 'Read observation file',
          imageFileIds: ['sample.png'],
        },
        files,
      )
      expect(turn1.nativeTurnId).toBeDefined()

      const turn1Events: any[] = []
      for await (const event of adapter.events()) {
        turn1Events.push(event)
        if (event.kind === 'question') {
          expect(event.question.purpose).toBe('permission')
          const delivery = await adapter.input({
            version: 1, taskId: event.question.taskId, epoch: event.question.epoch, workspace,
            inputId: randomUUID(), turnId: event.question.turnId, kind: 'answer', questionId: event.question.questionId,
            answers: [{ id: event.question.questions[0]!.id, values: ['允许这次操作'] }],
          })
          expect(delivery.status).toBe('accepted')
        }
        if (event.kind === 'turn-ended') break
      }

      // Check text events: delta appended, final replaced
      const textEvents = turn1Events.filter(e => e.kind === 'text')
      expect(textEvents.some(e => e.operation === 'append' && e.text === '正在')).toBe(true)
      expect(textEvents.some(e => e.operation === 'replace' && e.text === '正在读取')).toBe(true)

      // Tool event for Read
      const toolEvents = turn1Events.filter(e => e.kind === 'tool')
      expect(toolEvents.some(e => e.status === 'running' && e.name === 'Read')).toBe(true)
      expect(toolEvents.some(e => e.status === 'completed')).toBe(true)

      // Usage event
      const usage1 = turn1Events.find(e => e.kind === 'usage')
      expect(usage1?.inputTokens).toBe(10)
      expect(usage1?.outputTokens).toBe(20)

      // Completed
      const end1 = turn1Events.find(e => e.kind === 'turn-ended')
      expect(end1?.status).toBe('completed')
      expect(end1?.failure).toBeNull()

      // Turn 2 on the SAME session (stdin kept open!)
      const turn2 = await adapter.startTurn(
        {
          taskId: randomUUID(),
          epoch: 1,
          workspace,
          runId: randomUUID(),
          observationId: randomUUID(),
          text: 'Ask question',
          imageFileIds: [],
        },
        files,
      )

      // Iterate events until question event
      const eventsGen = adapter.events()[Symbol.asyncIterator]()
      const firstEvent = await eventsGen.next()
      expect(firstEvent.value.kind).toBe('question')
      const question = firstEvent.value.question
      expect(question.questions[0].title).toBe('Color?')

      // Answer question via input()
      const delivery = await adapter.input({
        version: 1,
        taskId: question.taskId,
        epoch: question.epoch,
        workspace,
        inputId: randomUUID(),
        turnId: turn2.nativeTurnId,
        kind: 'answer',
        questionId: question.questionId,
        answers: [{ id: question.questions[0].id, values: ['Green'] }],
      })
      expect(delivery.status).toBe('accepted')

      // Next events after answer
      const turn2Remainder: any[] = []
      while (true) {
        const next = await eventsGen.next()
        if (next.done) break
        turn2Remainder.push(next.value)
        if (next.value.kind === 'turn-ended') break
      }

      const end2 = turn2Remainder.find(e => e.kind === 'turn-ended')
      expect(end2?.status).toBe('completed')
    } finally {
      await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('handles user interrupt and maps aborted_streaming to cancelled', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cancel-'))
    const fixture = path.join(directory, 'cancel-server.cjs')

    const serverScript = `
      const readline = require('node:readline');
      if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
      const rl = readline.createInterface({ input: process.stdin });
      
      rl.on('line', line => {
        const wire = JSON.parse(line);
        if (wire.type === 'control_request' && wire.request?.subtype === 'initialize') {
          console.log(JSON.stringify({
            type: 'control_response',
            response: { subtype: 'success', request_id: wire.request_id, response: { models: [] } }
          }));
          return;
        }

        if (wire.type === 'user') {
          console.log(JSON.stringify({
            type: 'stream_event',
            event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Working...' } }
          }));
          return;
        }

        if (wire.type === 'control_request' && wire.request?.subtype === 'interrupt') {
          console.log(JSON.stringify({
            type: 'control_response',
            response: { subtype: 'success', request_id: wire.request_id, response: { still_queued: [] } }
          }));
          console.log(JSON.stringify({
            type: 'result',
            subtype: 'error_during_execution',
            terminal_reason: 'aborted_streaming',
            is_error: true,
            modelUsage: {
              'claude-opus-5[1m]': { inputTokens: 100, outputTokens: 5 }
            }
          }));
          return;
        }
      });
    `
    await fs.writeFile(fixture, serverScript)

    const adapter = new ClaudeProcessTransportAdapter(async () => ({
      executable: process.execPath,
      prefix: [fixture],
    }))

    try {
      await adapter.open({ cwd: directory, externalSessionId: null })
      const workspace = { version: 1 as const, projectId: 'test-p', normalizedPath: 'c:/test' }
      const runId = randomUUID()
      const taskId = randomUUID()

      await adapter.startTurn(
        {
          taskId,
          epoch: 0,
          workspace,
          runId,
          observationId: randomUUID(),
          text: 'Start long work',
          imageFileIds: [],
        },
        new Map(),
      )

      const eventsGen = adapter.events()[Symbol.asyncIterator]()
      const textEvent = await eventsGen.next()
      expect(textEvent.value.kind).toBe('text')

      // Stop turn via input({ kind: 'stop' })
      const delivery = await adapter.input({
        version: 1,
        taskId,
        epoch: 0,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'stop',
      })
      expect(delivery.status).toBe('accepted')

      const remainingEvents: any[] = []
      while (true) {
        const next = await eventsGen.next()
        if (next.done) break
        remainingEvents.push(next.value)
        if (next.value.kind === 'turn-ended') break
      }

      // Usage from modelUsage
      const usage = remainingEvents.find(e => e.kind === 'usage')
      expect(usage?.inputTokens).toBe(100)
      expect(usage?.outputTokens).toBe(5)

      // Turn ended with cancelled status
      const turnEnded = remainingEvents.find(e => e.kind === 'turn-ended')
      expect(turnEnded?.status).toBe('cancelled')
      expect(turnEnded?.failure).toBeNull()
    } finally {
      await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('maps unexpected aborted_streaming without user interrupt to failed with transport category (D-01)', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-abort-'))
    const fixture = path.join(directory, 'abort-server.cjs')

    const serverScript = `
      const readline = require('node:readline');
      if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
      const rl = readline.createInterface({ input: process.stdin });
      
      rl.on('line', line => {
        const wire = JSON.parse(line);
        if (wire.type === 'control_request' && wire.request?.subtype === 'initialize') {
          console.log(JSON.stringify({
            type: 'control_response',
            response: { subtype: 'success', request_id: wire.request_id, response: { models: [] } }
          }));
          return;
        }

        if (wire.type === 'user') {
          // Stream aborts unexpectedly without user interrupt
          console.log(JSON.stringify({
            type: 'result',
            subtype: 'error_during_execution',
            terminal_reason: 'aborted_streaming',
            is_error: false
          }));
          return;
        }
      });
    `
    await fs.writeFile(fixture, serverScript)

    const adapter = new ClaudeProcessTransportAdapter(async () => ({
      executable: process.execPath,
      prefix: [fixture],
    }))

    try {
      await adapter.open({ cwd: directory, externalSessionId: null })
      const workspace = { version: 1 as const, projectId: 'test-p', normalizedPath: 'c:/test' }
      const runId = randomUUID()
      const taskId = randomUUID()

      await adapter.startTurn(
        {
          taskId,
          epoch: 0,
          workspace,
          runId,
          observationId: randomUUID(),
          text: 'Trigger unexpected stream abort',
          imageFileIds: [],
        },
        new Map(),
      )

      const events: any[] = []
      for await (const ev of adapter.events()) {
        events.push(ev)
        if (ev.kind === 'turn-ended') break
      }

      const turnEnded = events.find(e => e.kind === 'turn-ended')
      expect(turnEnded?.status).toBe('failed')
      expect(turnEnded?.failure).toEqual({
        category: 'transport',
        message: 'Claude stream aborted unexpectedly',
      })
    } finally {
      await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('queues mid-turn edits while rejecting identity mismatch and unmatched questions (D-03, D-05, D-06)', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-input-checks-'))
    const fixture = path.join(directory, 'input-server.cjs')

    const serverScript = `
      const readline = require('node:readline');
      if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
      const rl = readline.createInterface({ input: process.stdin });
      
      rl.on('line', line => {
        const wire = JSON.parse(line);
        if (wire.type === 'control_request' && wire.request?.subtype === 'initialize') {
          console.log(JSON.stringify({
            type: 'control_response',
            response: { subtype: 'success', request_id: wire.request_id, response: { models: [] } }
          }));
          return;
        }

        if (wire.type === 'user') {
          console.log(JSON.stringify({
            type: 'stream_event',
            event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Processing...' } }
          }));
          return;
        }
      });
    `
    await fs.writeFile(fixture, serverScript)

    const adapter = new ClaudeProcessTransportAdapter(async () => ({
      executable: process.execPath,
      prefix: [fixture],
    }))

    try {
      await adapter.open({ cwd: directory, externalSessionId: null })
      const workspace = { version: 1 as const, projectId: 'test-p', normalizedPath: 'c:/test' }
      const taskId = randomUUID()
      const runId = randomUUID()

      // 1. D-06: Before startTurn (missing currentTurnContext)
      const prematureDelivery = await adapter.input({
        version: 1,
        taskId,
        epoch: 0,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'stop',
      })
      expect(prematureDelivery.status).toBe('rejected')
      expect(prematureDelivery.reason).toContain('任务或 Epoch 不匹配')

      // Start turn
      await adapter.startTurn(
        {
          taskId,
          epoch: 0,
          workspace,
          runId,
          observationId: randomUUID(),
          text: 'Running turn',
          imageFileIds: [],
        },
        new Map(),
      )

      // 2. D-06: Task ID mismatch
      const wrongTaskDelivery = await adapter.input({
        version: 1,
        taskId: randomUUID(),
        epoch: 0,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'stop',
      })
      expect(wrongTaskDelivery.status).toBe('rejected')
      expect(wrongTaskDelivery.reason).toContain('任务或 Epoch 不匹配')

      // 3. D-06: Epoch mismatch
      const wrongEpochDelivery = await adapter.input({
        version: 1,
        taskId,
        epoch: 5,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'stop',
      })
      expect(wrongEpochDelivery.status).toBe('rejected')
      expect(wrongEpochDelivery.reason).toContain('任务或 Epoch 不匹配')

      // 4. D-03: Mid-turn correction is queued for the harness turn boundary.
      const correctDelivery = await adapter.input({
        version: 1,
        taskId,
        epoch: 0,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'correct',
        text: 'Change direction',
      })
      expect(correctDelivery.status).toBe('queued')
      expect(correctDelivery.reason).toContain('下一回合消息')

      // 5. D-03: Mid-turn supplement follows the same queued contract.
      const supplementDelivery = await adapter.input({
        version: 1,
        taskId,
        epoch: 0,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'supplement',
        text: 'Additional info',
      })
      expect(supplementDelivery.status).toBe('queued')
      expect(supplementDelivery.reason).toContain('下一回合消息')

      // 6. D-05: Answer with no pending question / unmatched questionId rejected
      const unmatchedAnswerDelivery = await adapter.input({
        version: 1,
        taskId,
        epoch: 0,
        workspace,
        inputId: randomUUID(),
        turnId: runId,
        kind: 'answer',
        questionId: 'non-existent-question',
        answers: [{ id: 'q1', values: ['val1'] }],
      })
      expect(unmatchedAnswerDelivery.status).toBe('rejected')
      expect(unmatchedAnswerDelivery.reason).toContain('未找到匹配的提问或已超时')
    } finally {
      await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
