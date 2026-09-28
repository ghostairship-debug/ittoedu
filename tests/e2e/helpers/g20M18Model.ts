import { createServer, type ServerResponse } from 'node:http'
import { modelToolWireName } from '../../../src/main/workbench/providers/OpenAIChatProvider'
import { answerG20VisionCapabilityProbe } from '../../helpers/g20CapabilityProbeFixture'

export type M18Mode = 'default' | 'automatic'
type Reply = { kind: string; data?: any; result?: { status?: string } }
type Request = { model?: string; messages?: Array<{ role?: string; content?: unknown; tool_call_id?: string }>;
  tools?: Array<{ function?: { name?: string } }> }
type Step = { name: string; input: () => unknown; receipt?: (result: Reply, request: Request) => void }

export const M18_MODEL = 'fixture-m18-vision'
export const M18_MATERIAL = '# 两节科学课：叶片与光\n对象：初一。先预测叶片受光前后的变化，再观察证据并解释光合作用把光能转化为化学能。学生点击揭示后能够复述证据与结论。\n'
export const M18_PLAN = '# 教学策划\n学习对象：初一，已学植物需要水。\n目标：先预测叶片在光照下的变化，再观察证据，解释光合作用把光能转化为化学能。\n主线：预测 → 观察 → 讲解与证据解释 → 复述。\n困难：不能把揭示答案当成首次讲授；教师先解释证据，再让学生练习。\n评价：学生用证据说出光照的作用。\n依据：教师提供的两节科学课材料。假设：40 分钟课堂。\n'
export const M18_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>叶片与光</title><style>body{margin:0;font:26px sans-serif;color:#17324d;background:#f1f8ed}body>section{box-sizing:border-box;min-height:720px;padding:64px 80px}h1{font-size:48px;margin:0 0 28px}button{font:24px sans-serif;padding:12px 24px}p{max-width:930px;line-height:1.5}</style></head><body><section id="predict"><h1>先预测：叶片与光</h1><p>如果叶片接受光照，会发生什么？先说出你的预测，再到下一页观察证据。</p></section><section id="explain"><h1>观察与解释</h1><p>观察叶片受光前后的现象：光照使植物能够把光能转化为化学能。</p><button type="button" onclick="document.getElementById('conclusion').hidden=false">揭示结论</button><p id="conclusion" hidden>用观察到的证据解释结论，并再次尝试。</p></section></body></html>`
export const M18_SCRIPT = '# 讲解与操作说明\n第 1 页：教师请学生先预测，不立即显示结论。\n第 2 页：学生观察后点击揭示，教师追问证据；可刷新重试，再复述结论。\n'
export const M18_REPRESENTATION = '# 表示规划\n1. 预测页：固定画布 → 演示页；框架 HTML 按 section 导入，稳定标题可用 Native 精修。\n2. 解释页：固定画布 → 演示页；按钮与揭示为局部互动，保留导入页内行为，不静态替换。\n按页机械导入后逐页观察；不重新手写整件 V9。\n'

function requireRead(result: Reply, label: string) {
  if (result?.kind !== 'read') throw new Error(`${label}: expected Gateway read receipt, got ${JSON.stringify(result)}`)
  return result.data
}
function requireApplied(result: Reply, label: string) {
  if (result?.kind !== 'document-operation' || result.result?.status !== 'applied')
    throw new Error(`${label}: expected canonical applied receipt, got ${JSON.stringify(result)}`)
}
function requireSaved(result: Reply, label: string) {
  if (requireRead(result, label)?.status !== 'saved') throw new Error(`${label}: file.save did not return saved`)
}
function imageIn(request: Request) {
  const image = request.messages?.flatMap(message => Array.isArray(message.content) ? message.content as any[] : [])
    .find(part => part?.type === 'image_url')?.image_url?.url
  if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')
    || !Buffer.from(image.slice('data:image/png;base64,'.length), 'base64').subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Actual view.observe PNG did not reach the local model')
}
function sse(model: string, delta: unknown, finish: string) {
  return `data: ${JSON.stringify({ id: `m18-${model}`, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
}
function sendTool(response: ServerResponse, request: Request, step: Step, callId: string) {
  const wire = modelToolWireName(step.name)
  if (!request.tools?.some(tool => tool.function?.name === wire)) throw new Error(`Real model request omitted ${step.name}`)
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  response.end(sse(request.model ?? M18_MODEL, { role: 'assistant', tool_calls: [{ index: 0, id: callId,
    type: 'function', function: { name: wire, arguments: JSON.stringify(step.input()) } }] }, 'tool_calls') + 'data: [DONE]\n\n')
}

/** Scripted model decisions, but every step runs through the real Electron Engine and Gateway. */
export async function startG20M18Model(mode: M18Mode) {
  const docs: Record<string, { target: string; range?: string }> = {}
  const state: { source?: string; course?: string; slideId?: string; initialLocation?: string;
    locations?: Array<{ target: string; label: string }>; owner?: string } = {}
  const steps: Step[] = []
  const add = (name: string, input: () => unknown, receipt?: Step['receipt']) => steps.push({ name, input, receipt })
  const skill = (name: string, path = 'SKILL.md', check?: (content: string) => void) => add('skills.read',
    () => ({ skill: name, path, offset: 0, limit: 8000 }), result => {
      const data = requireRead(result, `skills.read ${name}/${path}`)
      if (data.status !== 'read' || data.truncated) throw new Error(`Bundled Skill read incomplete: ${name}/${path}`)
      check?.(data.content)
    })
  const document = (key: string, name: string, kind: 'markdown' | 'html', content: string) => {
    add('file.create', () => ({ name, kind }), result => {
      const data = requireRead(result, `create ${name}`)
      if (data.operation?.status !== 'success' || typeof data.target !== 'string') throw new Error(`FileService did not create ${name}`)
      docs[key] = { target: data.target }
    })
    add('listChildren', () => ({ target: docs[key]!.target }), result => {
      const children = requireRead(result, `children ${name}`)
      const range = children?.find((child: any) => child.kind === 'markdown-range')?.target
      if (!range) throw new Error(`No writable source range for ${name}`)
      docs[key]!.range = range
    })
    add('text.replace', () => ({ target: docs[key]!.range, content }), result => requireApplied(result, `write ${name}`))
    add('read', () => ({ target: docs[key]!.target, limit: 100 }), result => {
      const data = requireRead(result, `read ${name}`)
      if (data.text !== content || data.truncated || !data.target) throw new Error(`Current ${name} differs from saved draft`)
      docs[key]!.target = data.target
    })
    add('file.save', () => ({ target: docs[key]!.target }), result => requireSaved(result, name))
  }

  skill('orchestrate-courseware', 'SKILL.md', content => {
    if (!content.includes('02-course-frame.html') || !content.includes('自动创作')) throw new Error('Bundled orchestrator is stale')
  })
  add('file.open', () => ({ path: 'material.md' }), result => {
    const data = requireRead(result, 'material open')
    if (!data.target) throw new Error('Material did not open through FileService')
    state.source = data.target
  })
  add('read', () => ({ target: state.source, limit: 100 }), result => {
    if (requireRead(result, 'material read').text !== M18_MATERIAL) throw new Error('Model did not receive actual material')
  })
  document('plan', '01-teaching-plan.md', 'markdown', M18_PLAN)
  if (mode === 'default') add('ask_user', () => ({ question: '请审阅当前 01-teaching-plan.md：预测、观察、证据解释这条教学主线可以继续吗？',
    options: [{ label: '确认当前教学策划' }, { label: '需要修改' }] }), result => {
    const data = requireRead(result, 'teaching-plan confirmation')
    if (data.status !== 'answered' || data.selected?.[0]?.label !== '确认当前教学策划') throw new Error('Teacher did not confirm plan')
  })
  document('html', '02-course-frame.html', 'html', M18_HTML)
  document('script', '02-presentation-script.md', 'markdown', M18_SCRIPT)
  if (mode === 'default') add('ask_user', () => ({ question: '请审阅工作台预览的当前 02-course-frame.html 与 02-presentation-script.md：两页体验可以继续吗？',
    options: [{ label: '确认当前框架 HTML' }, { label: '需要修改' }] }), result => {
    const data = requireRead(result, 'HTML confirmation')
    if (data.status !== 'answered' || data.selected?.[0]?.label !== '确认当前框架 HTML') throw new Error('Teacher did not confirm HTML')
  })
  skill('build-courseware-project', 'SKILL.md', content => {
    if (!content.includes('representation-capabilities.md') || !content.includes('html.import')) throw new Error('Bundled Builder is stale')
  })
  skill('build-courseware-project', 'references/representation-capabilities.md', content => {
    if (content.length > 1500 || !content.includes('Slide')) throw new Error('Representation profile is absent or too long')
  })
  document('representation', '03-representation-plan.md', 'markdown', M18_REPRESENTATION)
  add('file.create', () => ({ name: 'assembled.h5lesson', kind: 'course-v9' }), result => {
    const data = requireRead(result, 'create Course V9')
    if (data.operation?.status !== 'success' || !data.target) throw new Error('No formal Course V9 created')
    state.course = data.target
  })
  add('tools.load', () => ({ families: ['build', 'content'] }), result => {
    const data = requireRead(result, 'load build and content tools')
    if (!data.loaded?.includes('build') || !data.loaded?.includes('content')) throw new Error('Required ToolCatalog families unavailable')
  })
  add('listChildren', () => ({ target: state.course }), result => {
    const children = requireRead(result, 'course children')
    state.slideId = children?.find((child: any) => child.kind === 'course-surface')?.target
    state.initialLocation = children?.find((child: any) => child.kind === 'course-location')?.target
    if (!state.slideId || !state.initialLocation) throw new Error('Created course lacks a Slide surface and location')
  })
  add('read', () => ({ target: state.slideId, limit: 100 }), result => {
    const data = requireRead(result, 'slide surface')
    const parsed = JSON.parse(data.text)
    if (parsed.surface?.type !== 'slide' || !parsed.surface.id) throw new Error('Cannot map HTML section to Slide')
    state.slideId = parsed.surface.id
  })
  add('read', () => ({ target: state.initialLocation, limit: 100 }), result => {
    const data = requireRead(result, 'first location')
    const parsed = JSON.parse(data.text)
    if (parsed.kind !== 'slide-scene' || !parsed.sceneId) throw new Error('First HTML section cannot map to existing Slide')
    state.initialLocation = parsed.sceneId
  })
  add('html.import', () => ({ source: docs.html!.target, target: state.course, mode: 'sections',
    destinations: [{ kind: 'slide-existing', location: state.initialLocation }, { kind: 'slide-new', surface: state.slideId }] }),
    result => requireApplied(result, 'section import'))
  add('file.open', () => ({ path: 'assembled.h5lesson' }), result => {
    const data = requireRead(result, 'reopen imported course in current run')
    if (!data.target || !data.writable) throw new Error('Imported course did not yield a fresh writable target')
    state.course = data.target
  })
  add('read', () => ({ target: state.course, limit: 100 }), result => {
    const data = requireRead(result, 'imported course')
    state.course = data.target
  })
  add('listChildren', () => ({ target: state.course }), result => {
    const children = requireRead(result, 'imported pages')
    state.locations = children.filter((child: any) => child.kind === 'course-location')
    if (state.locations?.length !== 2) throw new Error(`Expected two imported pages, got ${state.locations?.length}`)
  })
  for (let index = 0; index < 2; index++) {
    add('view.observe', () => ({ target: state.locations![index]!.target }), (result, request) => {
      const data = requireRead(result, `observe page ${index + 1}`)
      if (data.source !== 'isolated-published' || !data.identity?.locationId) throw new Error(`No real page ${index + 1} capture`)
      imageIn(request)
    })
    add('listChildren', () => ({ target: state.locations![index]!.target }), result => {
      const data = requireRead(result, `page ${index + 1} children`)
      state.owner = data.find((child: any) => child.kind === 'course-owner')?.target
      if (!state.owner) throw new Error(`No owner for page ${index + 1} polish`)
    })
    add('native.insert', () => ({ target: state.owner, template: { nativeType: 'text',
      text: index === 0 ? '视觉精修：先作预测' : '视觉精修：观察后解释', x: 80, y: 620, width: 800, height: 74,
      style: { fontSize: 26, color: '#17324d', backgroundColor: '#ffffff', backgroundOpacity: 1 } } }),
    result => requireApplied(result, `polish page ${index + 1}`))
    if (index === 0) add('listChildren', () => ({ target: state.course }), result => {
      const children = requireRead(result, 'fresh imported pages')
      state.locations = children.filter((child: any) => child.kind === 'course-location')
    })
  }
  add('read', () => ({ target: state.course, limit: 100 }), result => { state.course = requireRead(result, 'final course').target })
  add('file.save', () => ({ target: state.course }), result => requireSaved(result, 'assembled.h5lesson'))

  const calls: Array<{ name: string; id: string; result?: Reply }> = []
  let stepIndex = 0, previewReady = false, releasePreview!: () => void
  const previewGate = new Promise<void>(resolve => { releasePreview = resolve })
  let error: string | undefined
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: M18_MODEL }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected route ${request.method} ${request.url}`)
    let raw = ''; for await (const chunk of request) raw += chunk.toString()
    const payload = JSON.parse(raw) as Request
    const probe = await answerG20VisionCapabilityProbe(payload as any)
    if (probe !== null) { response.setHeader('Content-Type', 'text/event-stream'); response.end(sse(payload.model ?? M18_MODEL, { role: 'assistant', content: probe }, 'stop') + 'data: [DONE]\n\n'); return }
    if (payload.model !== M18_MODEL) throw new Error(`Unexpected model ${payload.model}`)
    const previous = calls.at(-1)
    if (previous && !previous.result) {
      const message = payload.messages?.find(message => message.role === 'tool' && message.tool_call_id === previous.id)
      if (typeof message?.content !== 'string') throw new Error(`Missing actual tool receipt for ${previous.name}`)
      previous.result = JSON.parse(message.content)
      steps[stepIndex - 1]!.receipt?.(previous.result!, payload)
    }
    if (mode === 'automatic' && previous?.name === 'file.save' && stepIndex === steps.findIndex(step =>
      step.name === 'skills.read' && (step.input() as { skill?: string }).skill === 'build-courseware-project')) {
      previewReady = true
      await previewGate
    }
    const step = steps[stepIndex]
    if (!step) {
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(sse(payload.model ?? M18_MODEL, { role: 'assistant', content: '已按材料完成并保存；假设为 40 分钟课堂。' }, 'stop') + 'data: [DONE]\n\n')
      return
    }
    const id = `m18-${mode}-${stepIndex}`
    sendTool(response, payload, step, id)
    calls.push({ name: step.name, id })
    stepIndex++
  })().catch(reason => {
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason)
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: error } }))
  }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, calls,
    get previewReady() { return previewReady }, get error() { return error }, releasePreview,
    async close() { releasePreview(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
