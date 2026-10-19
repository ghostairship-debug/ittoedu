import { strict as assert } from 'node:assert'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { DocumentRegistry } from '../../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../../src/core/tools/DocumentToolGateway'
import { ProgrammaticToolRunner, readProgrammaticResult } from '../../../src/main/workbench/execution/ProgrammaticToolRunner'
import { ChromiumProgrammaticRuntime } from '../../../src/main/workbench/execution/ProgrammaticToolRuntime'
import type { ProgrammaticJournalEntry } from '../../../src/shared/workbench/programmatic'
import type { ToolResult } from '../../../src/shared/workbench/tools'

async function verify() {
  const driver = new MarkdownDriver(), durable: unknown[] = []
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { append: async state => { durable.push(structuredClone(state)) }, save: async () => { throw new Error('No physical save requested') } } })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const sources = ['alpha 10\n' + 'unabridged-source-A '.repeat(80), 'beta 20\n' + 'unabridged-source-B '.repeat(80), 'gamma 30\n' + 'unabridged-source-C '.repeat(80)]
  const sessions = await Promise.all(sources.map((text, index) => registry.create(driver.load(Buffer.from(text)), `input-${index}.md`)))
  const runId = 'programmatic-carrier'
  await gateway.beginRun({ runId, actor: 'agent', documents: sessions.map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' }] })) })
  const handles = await Promise.all(sessions.map(session => gateway.issueTarget(runId, session.documentId, { kind: 'document' })))
  const editHandles = await Promise.all(sessions.map((session, index) => gateway.issueTarget(runId, session.documentId, { kind: 'markdown-range', from: 0, to: sources[index].length })))
  const definitions = (await gateway.describeRun(runId)).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema }))
  const runner = new ProgrammaticToolRunner(new ChromiumProgrammaticRuntime({ preloadPath: process.argv[2] }))
  const records: ProgrammaticJournalEntry[] = []
  let simultaneous = 0, peak = 0
  const execute = async (callId: string, code: string, signal?: AbortSignal): Promise<ToolResult> => {
    const parent: ProgrammaticJournalEntry = { callId, call: { name: 'programmatic.execute', input: { code } } }
    records.push(parent)
    parent.result = await runner.execute({ runId, callId, code, definitions, signal, executeTool: async (childId, call) => {
      const entry: ProgrammaticJournalEntry = { callId: childId, call }; records.push(entry)
      if (call.name === 'read') { simultaneous++; peak = Math.max(peak, simultaneous); await new Promise(resolve => setTimeout(resolve, 15)) }
      try { return entry.result = await gateway.execute(runId, childId, call) }
      finally { if (call.name === 'read') simultaneous-- }
    } })
    return parent.result
  }
  const aggregate = await execute('aggregate', `
    const signatures = await tools.describe(['read']);
    const rows = await Promise.all(${JSON.stringify(handles)}.map(target => tools.call('read', {target})));
    let total = 0;
    for (const row of rows) { const amount = Number(row.data.text.split('\\n')[0].split(' ')[1]); if (amount >= 20) total += amount; }
    return {total, count: rows.length, signatures: signatures.map(item => item.name)};
  `)
  assert.equal(aggregate.kind, 'read')
  assert.deepEqual((aggregate as { data: { value: unknown } }).data.value, { total: 50, count: 3, signatures: ['read'] })
  assert.equal(peak, 3)
  assert.equal(JSON.stringify(aggregate).includes('unabridged-source'), false)
  const exact = readProgrammaticResult({ callId: 'aggregate:ptc:2', path: ['data', 'text'] }, records)
  assert.equal((exact as { data: { value: string } }).data.value, sources[1])
  const page = readProgrammaticResult({ callId: 'aggregate:ptc:2', path: ['data', 'text'], offset: 5, limit: 11 }, records)
  assert.deepEqual((page as { data: unknown }).data, { callId: 'aggregate:ptc:2', path: ['data', 'text'], value: sources[1].slice(5, 16), offset: 5, total: sources[1].length, nextOffset: 16 })

  const partial = await execute('partial', `
    await tools.call('text.replace', {target:${JSON.stringify(editHandles[0])}, content:'first committed'});
    try { await tools.call('read', {target:'forged-target'}); } catch {}
    return {handled:true};
  `)
  assert.equal(partial.kind, 'error')
  assert.equal((partial as { data: { status: string } }).data.status, 'partial', JSON.stringify(partial))
  assert.equal(sessions[0].read().undoDepth, 1)
  assert.equal((sessions[0].read().model as { source: string }).source, 'first committed')
  assert.equal((readProgrammaticResult({ callId: 'partial:ptc:1' }, records) as { data: { value: ToolResult } }).data.value.kind, 'document-operation')
  assert.ok((partial as { data: { failures: unknown[] } }).data.failures.length === 1)
  // Explicit continuation only executes remaining work; the first write is not replayed.
  await execute('continue', `await tools.call('text.replace',{target:${JSON.stringify(editHandles[1])}, content:'second committed'}); return {continued:true};`)
  assert.equal(sessions[0].read().undoDepth, 1)
  assert.equal(sessions[1].read().undoDepth, 1)

  const blockedWrite = await execute('dependency-failed', `await Promise.all([
    tools.call('read',{target:'forged-target'}),
    tools.call('text.replace',{target:${JSON.stringify(editHandles[1])},content:'must not start'})
  ]); return null;`)
  assert.equal(blockedWrite.kind, 'error')
  assert.equal(sessions[1].read().undoDepth, 1)
  assert.equal((blockedWrite as { data: { children: { status: string }[] } }).data.children[1].status, 'cancelled')
  assert.equal(records.some(record => record.callId === 'dependency-failed:ptc:2'), false)

  const before = sessions.map(session => session.read().undoDepth)
  await execute('batch-rejected', `await tools.call('batch',{operations:[
    {name:'text.replace',input:{target:${JSON.stringify(editHandles[0])},content:'wrong A'}},
    {name:'text.replace',input:{target:${JSON.stringify(editHandles[1])},content:'wrong B'}}]}); return null;`)
  assert.deepEqual(sessions.map(session => session.read().undoDepth), before)
  const left = await gateway.issueTarget(runId, sessions[2].documentId, { kind: 'markdown-range', from: 0, to: 5 })
  const right = await gateway.issueTarget(runId, sessions[2].documentId, { kind: 'markdown-range', from: 6, to: 8 })
  const batched = await execute('batch-valid', `await tools.call('batch',{operations:[
    {name:'text.replace',input:{target:${JSON.stringify(left)},content:'delta'}},
    {name:'text.replace',input:{target:${JSON.stringify(right)},content:'40'}}]}); return {batched:true};`)
  assert.equal(batched.kind, 'read')
  assert.equal(sessions[2].read().undoDepth, 1)

  const isolation = await execute('isolation', `let blocked=false;try{await fetch('https://ptc-network.invalid/')}catch{blocked=true}return {process:typeof process, require:typeof require, blocked};`)
  assert.deepEqual((isolation as { data: { value: unknown } }).data.value, { process: 'undefined', require: 'undefined', blocked: true })
  const controller = new AbortController()
  const timer = setTimeout(() => { void gateway.stop(runId); controller.abort() }, 350)
  const stopped = await execute('stopped', `await tools.call('read',{target:${JSON.stringify(handles[2])}}); while(true) {}`, controller.signal)
  clearTimeout(timer)
  assert.equal(stopped.kind, 'error')
  assert.equal((stopped as { code: string }).code, 'programmatic-cancelled')
  assert.equal(records.find(record => record.callId === 'stopped:ptc:1')?.result?.kind, 'read')
  assert.equal((readProgrammaticResult({ callId: 'stopped:ptc:1', path: ['data', 'text'] }, records) as { data: { value: string } }).data.value.startsWith('delta 40'), true)
  assert.ok(durable.length > 0)
  console.log('PTC_CARRIER_OK')
  writeFileSync(process.argv[3], JSON.stringify({ status: 'PTC_CARRIER_OK' }))
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(verify).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
