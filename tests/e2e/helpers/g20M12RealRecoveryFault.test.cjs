const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRecoveryFault } = require('./g20M12RealRecoveryFault.cjs')

for (const [route, url, model] of [
  ['teamorouter', 'https://api.teamorouter.com/v1/chat/completions', 'deepseek-flash'],
  ['official', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-flash'],
  ['oauth', 'https://chatgpt.com/backend-api/codex/responses', 'gpt-6-luna'],
]) test(`${route}: fault and pre-continue block make zero native calls, explicit continuation permits tool turns`, async () => {
  const nativeCalls = []
  const gate = createRecoveryFault(route, async (...args) => { nativeCalls.push(args); return { ok: true } })
  const request = { method: 'POST', body: JSON.stringify({ model }) }
  await assert.rejects(gate.fetch(url, request), error => error.cause?.code === 'ECONNRESET')
  await assert.rejects(gate.fetch(url, request), /blocked model POST outside explicit continuation/)
  assert.equal(nativeCalls.length, 0)
  assert.throws(() => gate.allowPaidContinuation(), /preflight is incomplete/)
  const clean = createRecoveryFault(route, async (...args) => { nativeCalls.push(args); return { ok: true } })
  await assert.rejects(clean.fetch(url, request), error => error.cause?.code === 'ECONNRESET')
  clean.allowPaidContinuation()
  assert.equal((await clean.fetch(url, request)).ok, true)
  assert.equal((await clean.fetch(url, request)).ok, true)
  clean.closePaidContinuation()
  await assert.rejects(clean.fetch(url, request), /blocked model POST outside explicit continuation/)
  assert.equal(nativeCalls.length, 2)
  assert.deepEqual(clean.state(), { route, armed: false, allowPaid: false,
    faulted: 1, forwarded: 2, blockedBeforeContinue: 0, blockedAfterContinue: 1, unrelated: 0 })
})
