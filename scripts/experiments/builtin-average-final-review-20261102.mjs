// Read-only verification; writes one NEW compact review next to the evidence.
// Run from repository root. No test, model, checkpoint or artifact is modified.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd(), base = 'output/goal-correction-20261102/builtin-average-0418'
const paths = {
  creation: `${base}/creation-complete.json`, qualification: `${base}/initial-qualified-review.json`,
  local: `${base}/local-edit-result.json`, trace: `${base}/local-edit-complete-trace.json`,
  intent: `${base}/builtin-average-local-edit-0434/intent.json`, htmlResult: `${base}/html-acceptance-local/result.json`,
  coldResult: `${base}/glx-cold-local-runtime-r4/result.json`,
  glx: `${base}/workspace/平均数会被谁拉走.glx`, html: `${base}/workspace/平均数会被谁拉走-局改版.html`,
  coldImage: `${base}/glx-cold-local-runtime-r4/cold-page2-playback-reset.png`,
  image900a: `${base}/html-acceptance-local/900x650-01.png`,
  image900b: `${base}/html-acceptance-local/900x650-02-70.png`,
  image1440b: `${base}/html-acceptance-local/1440x900-02-70.png`,
}
const expected = { glx: '1d62bf2e573a1e848ae4fbfa51f0444c4164aa27d22bd4c205a56082abfddc7e', html: '7b90dd08b51242d6c682dc7659f72d3a5be781a7c8db8ece8cbb55619959ea92' }
const hash = data => createHash('sha256').update(data).digest('hex')
const bytes = {}, sha256 = {}, json = {}
for (const [key, file] of Object.entries(paths)) {
  bytes[key] = await readFile(path.resolve(root, file)); sha256[key] = hash(bytes[key])
  if (file.endsWith('.json')) json[key] = JSON.parse(bytes[key].toString('utf8').replace(/^\uFEFF/, ''))
}
assert.equal(sha256.glx, expected.glx, 'Final GLX identity mismatch')
assert.equal(sha256.html, expected.html, 'Final HTML identity mismatch')
const { creation, qualification, local, trace, intent, htmlResult, coldResult } = json
const count = value => Array.isArray(value) ? value.length : value
assert.equal(count(creation.requests), 43, 'creation request count')
assert.equal(count(creation.tools), 51, 'creation tool count')
const time = value => typeof value === 'number' ? value : Date.parse(value)
assert.equal(time(creation.updatedAt) - time(creation.createdAt), 338065, 'creation elapsed; check timestamp semantics before accepting')
assert.equal(qualification.wallToQualifiedMs, 637934)
assert.equal(qualification.withinTenMinutes, false)
assert.equal(count(local.requests), 8, 'local request count')
assert.equal(local.updatedAt-local.createdAt,171659)
assert(local.usage && typeof local.usage === 'object', 'local usage missing')
function contains(value, expectedValue) {
  if (value === expectedValue) return true
  if (Array.isArray(value)) return value.some(item => contains(item, expectedValue))
  return value && typeof value === 'object' ? Object.values(value).some(item => contains(item, expectedValue)) : false
}
for (const n of [201801, 978, 170368]) assert(contains(local.usage, n), `usage missing ${n}`)
assert(contains(local.usage, 8) && contains(local.usage, 0), 'known/unknown usage counts missing')
assert(local.inputDocuments, 'target and writable scope missing')
assert(local.checks && typeof local.checks === 'object' && Object.keys(local.checks).length, 'local checks missing')
const checkValues = Object.entries(local.checks).filter(([key]) => key !== 'savedRevision')
assert(checkValues.length > 0 && checkValues.every(([, value]) => value === true), 'local boolean checks are not all true; inspect actual schema and failure')
assert.equal(local.checks.savedRevision, 6, 'saved revision mismatch')
assert(Array.isArray(trace.requests) && trace.requests.length === 8, 'trace requests missing or count mismatch')
assert.equal(trace.requests[0].inputTokens, 21719)
assert(Array.isArray(trace.tools) && trace.tools.length === 7, 'trace tool count mismatch')
const toolName = item => item.name ?? item.call?.name ?? item.call?.tool ?? ''
const replace = trace.tools.find(item => /text\.replace/.test(toolName(item)))
const save = trace.tools.find(item => /file\.save/.test(toolName(item)))
const ask = trace.tools.find(item => /ask_user/.test(toolName(item)))
assert(replace && save && ask, 'Expected text.replace, file.save and ask_user tool receipts')
assert.equal(time(replace.receiptTime), 1793594101080, 'first replace receipt time')
assert.equal(time(save.receiptTime), 1793594109775, 'save receipt time')
assert.equal(time(ask.receiptTime), 1793594257191, 'ask_user receipt time')
const askRequest = trace.requests.find(item => item.requestId === ask.requestId)
assert(askRequest, 'ask_user request not found')
assert.equal(time(askRequest.timing?.provider?.terminalEventAt), 1793594127820, 'ask_user provider terminal time mismatch')
assert.equal(time(intent.at), 1793594094828, 'UI send intent time mismatch')
assert(contains(trace, 1793594267381) || contains(trace, new Date(1793594267381).toISOString()) || contains(local, 1793594267381) || contains(local, new Date(1793594267381).toISOString()), 'run terminal timestamp missing')
const htmlChecks = Object.values(htmlResult.checks ?? {})
assert.equal(htmlChecks.length, 186, 'HTML check count differs')
assert(htmlChecks.every(item => item?.passed === true), 'HTML functional checks did not all pass')
assert.equal(htmlResult.status, 'passed-functional-awaiting-visual-review', 'HTML functional result status mismatch')
assert.equal(htmlResult.sourceSha256, expected.html, 'HTML functional evidence belongs to another file')
assert.deepEqual(htmlResult.externalRequests, []); assert.deepEqual(htmlResult.pageErrors, [])
assert.equal(coldResult.status, 'passed'); assert.equal(coldResult.closed, true); assert.equal(coldResult.pid, 32824)
assert(typeof local.oldHtmlSha === 'string' && /^[0-9a-f]{64}$/i.test(local.oldHtmlSha), 'old HTML hash missing')
const workspace = path.join(root, base, 'workspace')
const oldMatches = []
for (const entry of await readdir(workspace, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.html$/i.test(entry.name)) continue
  const file = path.join(workspace, entry.name)
  if (hash(await readFile(file)) === local.oldHtmlSha.toLowerCase()) oldMatches.push(path.relative(root, file).split(path.sep).join('/'))
}
assert(oldMatches.length === 1, 'Exactly one original HTML must match oldHtmlSha')
const output = path.join(root, base, 'final-review.json')
const review = {
  status: 'passed-final-functional-and-visual-review', generatedAtUtc: new Date().toISOString(), evidence: paths, sha256,
  creation: { elapsedMs: 338065, requests: 43, tools: 51, usage: creation.usage ?? null, firstQualifiedMs: 637934, tenMinuteBudgetMs: 600000, withinTenMinutes: false },
  localEdit: { requests: 8, tools: 7, usage: local.usage, firstRequestInputTokens: 21719, inputDocuments: local.inputDocuments,
    uiSendIntentAt: 1793594094828, firstReplaceReceiptAt: 1793594101080, saveReceiptAt: 1793594109775, runFinishedAt: 1793594267381,
    uiToFirstReplaceMs: 6252, uiToSaveMs: 14947, runTotalMs: 172553, modelRunMs: local.updatedAt - local.createdAt,
    askUserProviderTerminalAt: 1793594127820, askUserReceiptAt: 1793594257191, askUserWaitMs: 129371,
    timingBoundary: '首写入与保存不是任务最终回复完成；等待区间按事件时间差记载，不假设与其他阶段互不重叠。', checks: local.checks },
  delivery: { glxSha256: sha256.glx, htmlSha256: sha256.html, oldHtmlSha256: local.oldHtmlSha, oldHtmlPath: oldMatches[0], htmlFunctionalChecks: htmlChecks.length,
    coldStatus: coldResult.status, coldClosed: coldResult.closed, coldPid: coldResult.pid,
    visualReview: 'root已在本次连续会话中直接审阅所列三张导出图和冷开图；本脚本绑定实际图像与回执哈希。标题、数值、实验和重置可读且无新遮挡。',
    priorFailures: 'r1/r2/r3为测试定位及嵌套iframe缩放坐标换算失败，须保留原始结果；r4真实鼠标路径通过，不将测试定位错误归因产品。' },
  goals: { 'G02.first-qualified': '本次首次合格超600秒，保留失败及同质量比较要求，不以生成时间代替首次合格。',
    'G02.local-edit': '真实局改计时和保全条件由上述来源独立核对；无可信因果前后对照不声称持续提速。',
    'G02.parallel': '单对象窄改不适合并行收益检验；保留适合真实重任务的条件。',
    'G05.narrow-context': '历史精确回读源码已修复，改进效果仍待下一真实模型验证；不据单次时长断言全局提速。' },
  limitations: ['已核对实际inputDocuments含P2与标题selection，但writable也包含document；精确选中不等于写授权只限标题。', '旧雨水、MCP和独立HTML基线保留；不同brief不能直接计算同质量因果提速比。', '当前历史精确回读修复已通过确定性测试，仍以随后新包真实任务补齐效果证据。']
}
await writeFile(output, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ output, status: review.status, sha256: hash(await readFile(output)) }))

