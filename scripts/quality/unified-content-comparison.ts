import { promises as fs } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Frame, type Page } from 'playwright'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { DynamicAdmissionResult } from '../../src/shared/dynamicAdmissionContract'

const repoRoot = process.cwd()
const directory = path.resolve(process.argv[2] ?? 'output/unified-content-architecture/quality-comparison/2026-10-03-circuits-flash')
const mode = process.argv[3] ?? 'prepare'
const revision = mode === 'revise' || mode === 'render-revision'
const agentFinal = mode === 'apply-final' || mode === 'render-final'
const variants: ('bare' | 'new')[] = process.argv[4] === 'bare' ? ['bare'] : process.argv[4] === 'new' ? ['new'] : ['bare', 'new']
const route = { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-flash', billing: 'unknown' }
const viewport = { width: 1280, height: 720 }
const userPrompt = `为初中物理教师创作一页中文互动演示课件，主题“串联与并联：电流、电压怎样分配？”。目标画面为1280×720，正常字号，无需滚动即可看清核心内容。设计清晰的标题、学习问题和两个并排比较区域，有真实SVG电路图及数据图，整体有优秀教学作品的视觉层次与美感。
材料固定：理想电源6V，两个定值电阻R₁=10Ω、R₂=20Ω。串联电流均为0.20A，总电流0.20A，分压为2V和4V；并联两支路电压均为6V，电流分别0.60A、0.30A，总电流0.90A。对照必须使用同一电源和两个电阻。
教学顺序：先让学生预测电流、电压如何分配，再点击“观察实验”揭示真实数值及图中变化，然后用观察解释“串联电流相等、电压相加；并联电压相等、电流相加”。预测控件可以真实选择，教师可直接揭示，不设置答对才可继续的门槛。必须有“重置”且可重复操作。允许切换串联/并联，并可把电源从6V调到9V，显示相应正确的电流、电压变化及单位；重置恢复初始状态。核心电路和必要解释直接呈现，不能用素材占位、隐藏答案代替教学主体。
仅使用本地内联HTML、CSS、SVG和JavaScript，无远程字体、脚本或图像；不调用图片生成。输出完整可独立运行的HTML文档，只输出源码，不加Markdown围栏或说明。布局、样式和互动由你自由创作，不使用成品模板。`
const correctionPrompt = `请对你刚才的源码做一次限定内容修订，保留原有整体视觉风格和两个比较区域，只修正已经实际发现的缺陷。给出完整可独立运行的修订HTML，依然仅输出源码。
1. 按原要求先预测，默认只呈现电路、条件和学习问题，隐藏要预测的实测数值。正常点击“观察实验”后必须在页面内揭示实际数值与对应电路/数据图变化，并反馈当前真实选择，禁止用alert弹窗或只切换文字充当揭示。教师可直接揭示，不要求预测答对。重置恢复未揭示状态并支持重复预测实验。
2. SVG必须表达真实闭合电源电路。采用能辨认正负极的电源符号；串联中R₁、R₂位于同一电流回路；并联中R₁、R₂分属连接在电源两端相同两个节点之间的独立支路，导线不能直接短路电阻或電源，不能把两电阻串成一圈再标为并联。单位和数值必须严格来自原材料。
3. 电源6V/9V切换必须同步两列电路、数据和实际可见状态；恢复6V必须恢复两列全部数值，不能留下另一模式的9V状态。补上原要求的真实数据图（可内联SVG），电流/电压单位区分清楚，数据图随实际条件更新。
4. 目标仍为1280×720。修掉底部裁切、控件遮挡和透明层截获；无需滚动即可看清主要教学内容，正常鼠标点击所有预测/观察/切换/复位控件均命中。不要靠缩成很小字体、删掉必要教学内容或修改用户目标掩盖问题。`

function variantDirectory(name: string) { return path.join(directory, name, ...(agentFinal ? ['agent-final'] : revision ? ['revision-1'] : [])) }

async function writeJson(name: string, value: unknown) {
  await fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n')
}

async function prepare() {
  await fs.mkdir(directory, { recursive: true })
  const skill = await fs.readFile(path.join(repoRoot, '.agents/skills/orchestrate-courseware/SKILL.md'), 'utf8')
  // Only content/design knowledge; the delivery commands and software interface are not model input.
  const knowledge = skill.slice(skill.indexOf('# 创作教学作品'), skill.indexOf('在用户工作区形成可交付 HTML'))
  const common = '专注于创作内容、视觉和互动，按用户要求输出一个可直接运行的完整HTML文档。'
  await Promise.all([
    fs.writeFile(path.join(directory, 'user-prompt.txt'), userPrompt),
    fs.writeFile(path.join(directory, 'bare-system.txt'), common),
    fs.writeFile(path.join(directory, 'new-system.txt'), common + '\n\n' + knowledge),
  ])
  await writeJson('conditions.json', { route, viewport, temperature: 0.7, thinking: { type: 'disabled' },
    material: 'same inline circuit data; no external assets or template',
    skill: '.agents/skills/orchestrate-courseware/SKILL.md: content/design excerpt only',
    requests: 'independent one-shot calls, same user prompt; no harness-assigned output cap',
    providerParameterSource: 'https://api-docs.deepseek.com/guides/thinking_mode/',
    actualVersion: 'request deepseek-flash per the established V4.1 route; record the actual response model separately',
    qualityDecision: 'human review required; single task does not establish general superiority' })
}

function extractHtml(raw: string) {
  const fences = [...raw.matchAll(/```(?:html)?\s*([\s\S]*?)\s*```/gi)]
  if (fences.length > 1) throw new Error('multiple-model-code-blocks-require-diagnosis')
  if (fences.length === 1) {
    const html = fences[0]![1]!
    if (!/<html[\s>][\s\S]*<\/html\s*>/i.test(html)) throw new Error('model-html-block-is-incomplete')
    return { html, mechanicalPackaging: 'extract unique complete HTML code block; surrounding prose/fences removed; raw completion retained' }
  }
  if (raw.includes('```')) throw new Error('model-code-fence-is-incomplete')
  return { html: raw, mechanicalPackaging: 'none' }
}

async function normalizeRevisions() {
  for (const name of variants) {
    const folder = path.join(directory, name, 'revision-1'), raw = await fs.readFile(path.join(folder, 'completion.txt'), 'utf8')
    const extracted = extractHtml(raw), original = await fs.readFile(path.join(folder, 'first-draft.html'), 'utf8')
    if (original === extracted.html) continue
    const previous = path.join(folder, 'before-extraction')
    await fs.mkdir(previous, { recursive: true })
    for (const filename of await fs.readdir(folder)) {
      if (filename === 'first-draft.html' || filename.endsWith('.png') || filename.startsWith('raw-interaction')
        || filename.startsWith('player-interaction') || ['delivery.json', 'admission.json', 'first-draft.h5lesson', 'first-draft-player.html'].includes(filename))
        await fs.rename(path.join(folder, filename), path.join(previous, filename))
    }
    await fs.writeFile(path.join(folder, 'first-draft.html'), extracted.html)
    const metadata = JSON.parse(await fs.readFile(path.join(folder, 'generation.json'), 'utf8'))
    await fs.writeFile(path.join(folder, 'generation.json'), JSON.stringify({ ...metadata, mechanicalPackaging: extracted.mechanicalPackaging,
      blockContentModified: false, normalizedAfterGeneration: true }, null, 2))
    console.log(`${name}: mechanically extracted a unique complete HTML block; original completion retained`)
  }
}

function contentZones(source: string) {
  const styleOpen = /<style\b[^>]*>/i.exec(source), styleClose = source.indexOf('</style>', styleOpen?.index ?? 0)
  const bodyOpen = /<body\b[^>]*>/i.exec(source), scriptOpen = /<script\b[^>]*>/i.exec(source), scriptClose = source.lastIndexOf('</script>')
  if (!styleOpen || !bodyOpen || !scriptOpen || styleClose < 0 || scriptClose < 0) throw new Error('candidate-needs-existing-style-body-script-zones')
  return [
    { name: 'style', from: styleOpen.index + styleOpen[0].length, to: styleClose },
    { name: 'body-markup', from: bodyOpen.index + bodyOpen[0].length, to: scriptOpen.index },
    { name: 'script', from: scriptOpen.index + scriptOpen[0].length, to: scriptClose },
  ].map(zone => ({ ...zone, content: source.slice(zone.from, zone.to) }))
}

async function applyAgentFinal() {
  const { DocumentHostService } = await import('../../src/main/workbench/DocumentHostService')
  for (const name of variants) {
    const folder = path.join(directory, name, 'agent-final')
    const source = await fs.readFile(path.join(directory, name, 'revision-1/first-draft.html'), 'utf8')
    const desired = await fs.readFile(path.join(folder, 'desired.html'), 'utf8')
    const file = path.join(folder, 'first-draft.html')
    await fs.writeFile(file, source)
    const host = new DocumentHostService(path.join(folder, 'content-journal')), opened = await host.open(file)
    const runId = `q03-${name}-agent-content-${Date.now()}`
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }] })
    const desiredZones = contentZones(desired)
    const zones = contentZones(source).filter(zone => zone.content !== desiredZones.find(candidate => candidate.name === zone.name)!.content)
      .sort((left, right) => right.from - left.from)
    const operations = await Promise.all(zones.map(async zone => ({ name: 'text.replace' as const, input: {
      target: await host.tools.issueTarget(runId, opened.documentId, { kind: 'markdown-range', from: zone.from, to: zone.to }),
      content: desiredZones.find(candidate => candidate.name === zone.name)!.content,
    } })))
    const result = await host.tools.execute(runId, `q03-${name}-agent-content-batch`, { name: 'batch', input: { operations } })
    if (result.kind !== 'document-operation' || result.result.status !== 'applied') throw new Error(`${name}-actual-content-tool-not-applied`)
    const saved = await host.saveToPath(opened.documentId)
    const reopened = await new DocumentHostService(path.join(folder, 'content-reopened-journal')).open(file)
    if (reopened.model.kind !== 'text') throw new Error('agent-final-content-reopen-not-html-source')
    const actualZones = contentZones(reopened.model.source)
    if (actualZones.some(zone => zone.content !== desiredZones.find(candidate => candidate.name === zone.name)!.content))
      throw new Error('agent-final-content-application-was-not-the-authored-patch')
    await fs.writeFile(path.join(folder, 'content-application.json'), JSON.stringify({
      classification: 'one agent content intervention round after model first draft and one model revision failed; no paid regeneration',
      formalTool: 'DocumentToolGateway batch of text.replace over software-bound HTML source ranges',
      changedZones: zones.map(zone => zone.name), result, saved: { dirty: saved.dirty, undoDepth: saved.undoDepth, revision: saved.revision },
      modelGenerationCalls: 2, agentContentInterventionRounds: 1, humanContentIntervention: true,
      originalAndModelRevisionPreserved: true, reopened: true,
    }, null, 2))
    await host.tools.stop(runId)
    console.log(`${name}: actual content-tool batch applied, saved and reopened; one agent content intervention`)
  }
}

async function generate() {
  if (!revision) await prepare()
  else await fs.writeFile(path.join(directory, 'correction-prompt.txt'), correctionPrompt)
  const credential = process.env.TEAMOROUTER_API_KEY
  if (!credential) throw new Error('credential-missing')
  try {
    const catalogResponse = await fetch(`${route.baseURL}/models`, { headers: { Authorization: `Bearer ${credential}` }, redirect: 'error' })
    if (!catalogResponse.ok) throw new Error(`catalog-http-${catalogResponse.status}`)
    const catalog = await catalogResponse.json() as { data?: { id: string; owned_by?: string }[] }
    const models = (catalog.data ?? []).map(model => ({ id: model.id, owned_by: model.owned_by ?? null }))
    await writeJson(revision ? 'revision-catalog.json' : 'catalog.json', { provider: route.provider, baseURL: route.baseURL,
      checkedAt: new Date().toISOString(), billing: route.billing, models, selectedAliasListed: models.some(model => model.id === route.model) })
  } catch (error) {
    await writeJson(revision ? 'revision-catalog.json' : 'catalog.json', { provider: route.provider, baseURL: route.baseURL,
      checkedAt: new Date().toISOString(), diagnostic: error instanceof Error ? error.message : 'catalog-unavailable',
      decision: 'catalog is diagnostic; use the explicit Owner-authorized route and record the actual response model' })
  }
  await Promise.all(['bare', 'new'].map(async name => {
    const folder = variantDirectory(name)
    await fs.mkdir(folder, { recursive: true })
    try { await fs.access(path.join(folder, 'completion.txt')); console.log(`${name}: original first draft already exists; no generation`); return } catch { /* first call */ }
    const system = await fs.readFile(path.join(directory, `${name}-system.txt`), 'utf8')
    const request = { model: route.model, messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
      temperature: 0.7, thinking: { type: 'disabled' }, stream: false }
    if (revision) request.messages.push({ role: 'assistant', content: await fs.readFile(path.join(directory, name, 'completion.txt'), 'utf8') },
      { role: 'user', content: correctionPrompt })
    await fs.writeFile(path.join(folder, 'request.json'), JSON.stringify(request, null, 2))
    const startedAt = new Date().toISOString(), started = performance.now()
    console.log(`${name}: generation started on ${route.provider}/${route.model}`)
    try {
      const response = await fetch(`${route.baseURL}/chat/completions`, { method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        redirect: 'error' })
      if (!response.ok) throw new Error(`completion-http-${response.status}`)
      const result = await response.json() as { id?: string; model?: string; usage?: unknown; choices?: { finish_reason?: string; message?: { content?: string } }[] }
      const elapsedMs = performance.now() - started, raw = result.choices?.[0]?.message?.content ?? ''
      await fs.writeFile(path.join(folder, 'completion.txt'), raw)
      await fs.writeFile(path.join(folder, 'response.json'), JSON.stringify(result, null, 2))
      const extracted = extractHtml(raw)
      await fs.writeFile(path.join(folder, 'first-draft.html'), extracted.html)
      const metadata = { route, startedAt, elapsedMs, actualModel: result.model ?? null,
        finishReason: result.choices?.[0]?.finish_reason ?? null, usage: result.usage ?? null,
        bytes: Buffer.byteLength(raw), mechanicalPackaging: extracted.mechanicalPackaging,
        generationCalls: revision ? 0 : 1, repairCalls: revision ? 1 : 0, phase: revision ? 'one targeted revision' : 'original first draft',
        humanSourceEdits: 0, contentModified: revision, containsHtml: /<html|<!doctype/i.test(extracted.html) }
      await fs.writeFile(path.join(folder, 'generation.json'), JSON.stringify(metadata, null, 2))
      console.log(JSON.stringify({ name, elapsedMs, usage: result.usage, finishReason: metadata.finishReason, bytes: metadata.bytes }))
    } catch (error) {
      const message = error instanceof Error && /^completion-http-\d+$/.test(error.message) ? error.message : error instanceof Error ? error.name : 'generation-failed'
      await fs.writeFile(path.join(folder, 'generation-failure.json'), JSON.stringify({ route, startedAt, elapsedMs: performance.now() - started,
        error: message, generationCalls: revision ? 0 : 1, repairCalls: revision ? 1 : 0, retried: false }, null, 2))
      console.log(`${name}: first call failed (${message}); no retry`)
      throw new Error(`${name}-generation-failed`)
    }
  }))
}

async function main() {
  if (mode === 'prepare') await prepare()
  else if (mode === 'generate' || mode === 'revise') await generate()
  else if (mode === 'normalize-revision') await normalizeRevisions()
  else if (mode === 'apply-final') await applyAgentFinal()
  else if (mode === 'render' || mode === 'render-revision' || mode === 'render-final') await renderComparison()
  else throw new Error('mode must be prepare, generate, render, revise or render-revision')
}

async function serveRenderer() {
  const root = path.join(repoRoot, 'dist-renderer')
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
  const server = createServer((request, response) => {
    const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname))
    if (!filename.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
    void fs.readFile(filename).then(bytes => { response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream' }); response.end(bytes) },
      () => { response.writeHead(404); response.end() })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('static-renderer-server-failed')
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

function admissionPort(browser: Browser, processId: number, url: string, folder: string): BuildAdmissionPort {
  return { async run(payload, signal) {
    const page = await browser.newPage({ viewport })
    const onAbort = () => { void page.close() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await page.goto(`${url}/admission.html`)
      await page.waitForFunction(() => typeof (window as any).__COURSEWARE_ADMISSION_RUN__ === 'function')
      const encoded = { ...payload, assetFiles: Object.fromEntries(Object.entries(payload.assetFiles)
        .map(([id, value]) => [id, typeof value === 'string' ? value : Buffer.from(value).toString('base64')])) }
      let finished = false
      const running = page.evaluate(input => (window as any).__COURSEWARE_ADMISSION_RUN__(input), encoded)
        .catch(error => ({ ok: false, message: error instanceof Error ? error.message : 'admission-page-failed' }))
        .finally(() => { finished = true }) as Promise<DynamicAdmissionResult>
      let frames = 0
      while (!finished) {
        if (signal.aborted) throw new Error('admission-stopped')
        const pending = await page.evaluate(() => (window as any).__COURSEWARE_ADMISSION_PENDING_FRAME__()) as { id: number } | null
        if (pending) {
          const bytes = await page.screenshot()
          frames++
          await page.evaluate(({ id, ...frame }) => (window as any).__COURSEWARE_ADMISSION_ACCEPT_FRAME__(id, frame), {
            id: pending.id, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, capturedAt: Date.now(), ...viewport,
          })
        }
        await page.waitForTimeout(30)
      }
      const result = { ...await running, processId }
      await fs.writeFile(path.join(folder, 'admission.json'), JSON.stringify({ result, frames,
        actualBrowser: 'isolated Chromium process via Playwright; product admission.html; no synthetic captures',
        buttonCheck: 'not requested; interaction verified separately in the actual standalone Player' }, null, 2))
      return result
    } finally { signal.removeEventListener('abort', onAbort); await page.close() }
  } }
}

async function importNew(browser: Browser, processId: number, rendererUrl: string) {
  const folder = variantDirectory('new')
  try {
    await fs.access(path.join(folder, 'delivery.json'))
    await fs.access(path.join(folder, 'first-draft-player.html'))
    console.log('new: existing successful import/save/publish retained'); return
  } catch { /* no successful delivery */ }
  const [{ DocumentHostService }, { ControlledBuildService }, { HtmlImportService }, { createBlankCourseProject },
    { componentPackagesFromArchive }, { buildPublishedCourseStandaloneHtml }] = await Promise.all([
    import('../../src/main/workbench/DocumentHostService'), import('../../src/main/workbench/build/ControlledBuildService'),
    import('../../src/main/workbench/htmlImport/HtmlImportService'), import('../../src/core/course/createCourseProject'),
    import('../../src/renderer/components/componentPackageStore'), import('../../src/renderer/export/course/buildCoursePackages'),
  ])
  const started = performance.now()
  const host = new DocumentHostService(path.join(folder, 'journal'))
  const project = createBlankCourseProject({ title: agentFinal ? '串并联电流电压 · agent内容介入候选' : revision ? '串并联电流电压 · 新路径一次修订' : '串并联电流电压 · 新路径首稿', canvas: viewport, includeDefaultController: false, controls: 'none' })
  const snapshot = await host.internalAPI.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, 'first-draft.h5lesson')
  const session = host.registry.get(snapshot.documentId), runId = `q03-new-first-draft-${Date.now()}`
  const builds = new ControlledBuildService({ directory: path.join(folder, 'builds'), admission: admissionPort(browser, processId, rendererUrl, folder) })
  host.tools.configureHostServices({ builds })
  await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const targetHandle = await host.tools.issueTarget(runId, session.documentId, { kind: 'document' })
  const importer = new HtmlImportService({ session, gateway: host.tools })
  const ticket = await importer.prepare({ operationId: 'q03-original-model-html', runId, targetHandle,
    sourcePath: path.join(folder, 'first-draft.html'), locationId: project.locations[0]!.id })
  await importer.admit(ticket)
  const committed = await importer.commit(ticket)
  if (committed.status !== 'applied' && committed.status !== 'unchanged') throw new Error('q03-import-not-committed')
  const saved = await host.saveToPath(session.documentId, path.join(folder, 'first-draft.h5lesson'))
  const reopened = await new DocumentHostService(path.join(folder, 'reopened-journal')).open(path.join(folder, 'first-draft.h5lesson'))
  if (reopened.model.kind !== 'course-v9') throw new Error('q03-reopened-wrong-format')
  const model = reopened.model, playerBundle = await fs.readFile(path.join(repoRoot, 'dist-player/player.iife.js'), 'utf8')
  const html = buildPublishedCourseStandaloneHtml({ project: model.project, assetFiles: model.resources.assets,
    components: componentPackagesFromArchive(model.project, model.resources.components) }, { playerBundle, lang: 'zh-CN' })
  await fs.writeFile(path.join(folder, 'first-draft-player.html'), html)
  const items = model.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : [])
  await fs.writeFile(path.join(folder, 'delivery.json'), JSON.stringify({ pipeline: 'actual HtmlImportService -> ControlledBuild product Chromium admission -> DocumentSession commit -> DocumentHost save/reopen -> standalone Publisher',
    elapsedMs: performance.now() - started, committed, saved: { dirty: saved.dirty, undoDepth: saved.undoDepth, revision: saved.revision },
    reopened: { title: model.project.title, pages: model.project.locations.length, itemKinds: items.map(item => item.kind) },
    notices: importer.notices(ticket), contentModified: revision || agentFinal, humanSourceEdits: agentFinal ? 1 : 0,
    repairCalls: revision || agentFinal ? 1 : 0, agentContentInterventionRounds: agentFinal ? 1 : 0 }, null, 2))
  await host.tools.stop(runId)
}

async function observe(browser: Browser, variant: 'bare' | 'new', player = false) {
  const folder = variantDirectory(variant)
  const evidencePath = path.join(folder, `${player ? 'player' : 'raw'}-interaction.json`)
  try {
    const prior = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as { status?: string }
    if (prior.status === 'observed' || prior.status === 'observed-with-real-action-failures') {
      console.log(`${variant}/${player ? 'player' : 'raw'}: existing observation retained`); return
    }
    await fs.copyFile(evidencePath, path.join(folder, `${player ? 'player' : 'raw'}-interaction-prior.json`))
  } catch { /* no prior observation */ }
  const page = await browser.newPage({ viewport }), dialogs: string[] = [], errors: string[] = [], warnings: string[] = []
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept() })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') warnings.push(message.text()) })
  const evidence: Record<string, unknown> = { variant, actualPresentation: player ? 'full standalone Published Player from saved/reopened project'
    : agentFinal ? 'raw HTML after one agent content intervention through actual content tools'
    : revision ? 'raw HTML from one targeted model revision' : 'unmodified raw HTML first draft',
    contentModified: revision || agentFinal, humanSourceEdits: agentFinal ? 1 : 0, repairCalls: revision || agentFinal ? 1 : 0,
    agentContentInterventionRounds: agentFinal ? 1 : 0, dialogs, errors, warnings }
  try {
    await page.goto(pathToFileURL(path.join(folder, player ? 'first-draft-player.html' : 'first-draft.html')).href)
    let frame: Frame = page.mainFrame()
    if (player) {
      await page.waitForFunction(() => Boolean((window as any).__H5_LESSON_PLAYER__))
      const iframe = page.locator('iframe[data-html-document-runtime="true"],iframe[data-web-composition]').first()
      await iframe.waitFor({ state: 'visible', timeout: 30000 })
      frame = (await (await iframe.elementHandle())!.contentFrame())!
    }
    await frame.locator('#voltageSelect').waitFor({ state: 'visible', timeout: 30000 })
    await frame.evaluate(() => document.fonts.ready)
    const snapshot = () => frame.evaluate(() => ({ text: document.body.innerText,
      voltage: (document.querySelector('#voltageSelect') as HTMLSelectElement).value,
      predictions: [...document.querySelectorAll('select')].filter(node => node.id !== 'voltageSelect').map(node => ({ id: node.id, selected: node.value })),
      svgCount: document.querySelectorAll('svg').length,
      viewport: { width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight },
      readings: Object.fromEntries(['seriesDataGrid', 'parallelDataGrid', 'seriesI', 'seriesU1', 'seriesU2', 'seriesUtotal',
        'parallelI1', 'parallelI2', 'parallelItotal', 'parallelU'].map(id => [id, document.getElementById(id)?.textContent?.trim() ?? null])),
    }))
    const prefix = player ? 'player' : 'raw'
    const actions: { name: string; status: 'observed' | 'failed'; error?: string }[] = []
    evidence.actions = actions
    const attempt = async (name: string, action: () => Promise<unknown>) => {
      try { await action(); actions.push({ name, status: 'observed' }) }
      catch (error) { actions.push({ name, status: 'failed', error: error instanceof Error ? error.message : 'action-failed' }) }
    }
    evidence.initial = await snapshot()
    await page.screenshot({ path: path.join(folder, `${prefix}-initial.png`) })
    const prediction = variant === 'bare' ? '#seriesPredictI' : '#predictSeriesI'
    const options = await frame.locator(`${prediction} option`).evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value))
    const wrong = options.find(value => Number(value) !== 0.2)
    if (wrong) await frame.locator(prediction).selectOption(wrong)
    evidence.beforeObserve = await snapshot()
    await attempt('observe-series-real-click', () => frame.getByRole('button', { name: /观察实验/ }).first().click({ timeout: 5000 }))
    evidence.afterObserve = await snapshot()
    await page.screenshot({ path: path.join(folder, `${prefix}-observed.png`) })
    await attempt('voltage-9v', () => frame.locator('#voltageSelect').selectOption('9', { timeout: 5000 }))
    evidence.series9V = await snapshot()
    if (variant === 'new') await attempt('switch-to-parallel-real-click', () => frame.locator('#switchToParallelBtn').click({ timeout: 5000 }))
    else await attempt('observe-parallel-real-click', () => frame.getByRole('button', { name: /观察实验/ }).nth(1).click({ timeout: 5000 }))
    evidence.parallel9V = await snapshot()
    if ((revision || agentFinal) && variant === 'new') {
      await attempt('observe-parallel-9v-real-click', () => frame.getByRole('button', { name: /观察实验/ }).nth(1).click({ timeout: 5000 }))
      evidence.parallel9VRevealed = await snapshot()
    }
    await page.screenshot({ path: path.join(folder, `${prefix}-9v.png`) })
    await attempt('reset-real-click', () => frame.locator('#resetBtn').click({ timeout: 5000 }))
    evidence.reset = await snapshot()
    if (revision || agentFinal) {
      await page.screenshot({ path: path.join(folder, `${prefix}-reset.png`) })
      await attempt('repeat-observe-after-reset-real-click', () => frame.getByRole('button', { name: /观察实验/ }).first().click({ timeout: 5000 }))
      evidence.repeatObserved = await snapshot()
      await attempt('reset-before-direct-parallel', () => frame.locator('#resetBtn').click({ timeout: 5000 }))
      const beforeErrors = errors.length
      await attempt('direct-parallel-observe-from-initial-mode', () => frame.getByRole('button', { name: /观察实验/ }).nth(1).click({ timeout: 5000 }))
      evidence.directParallelObserved = await snapshot()
      evidence.directParallelNewErrors = errors.slice(beforeErrors)
    }
    evidence.status = actions.some(action => action.status === 'failed') ? 'observed-with-real-action-failures' : 'observed'
  } catch (error) {
    evidence.status = 'observation-failed'
    evidence.failure = error instanceof Error ? error.message : 'observation-failed'
    await page.screenshot({ path: path.join(folder, `${player ? 'player' : 'raw'}-failed.png`) }).catch(() => undefined)
  } finally {
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2))
    await page.close()
  }
  console.log(JSON.stringify({ variant, player, status: evidence.status, errors: errors.length, warnings: warnings.length, dialogs: dialogs.length }))
}

async function renderComparison(): Promise<void> {
  const failureFile = agentFinal ? 'agent-final-new-path-failure.json' : revision ? 'revision-new-path-failure.json' : 'new-path-failure.json'
  const server = await serveRenderer()
  const browserServer = await chromium.launchServer({ headless: true })
  const processId = browserServer.process()?.pid
  if (!processId) throw new Error('actual-chromium-process-id-unavailable')
  const browser = await chromium.connect(browserServer.wsEndpoint())
  try {
    await Promise.all(variants.map(variant => observe(browser, variant)))
    if (!variants.includes('new')) return
    try {
      await importNew(browser, processId, server.url)
      await observe(browser, 'new', true)
      try {
        const prior = JSON.parse(await fs.readFile(path.join(directory, failureFile), 'utf8'))
        await writeJson(failureFile, { ...prior, historicalHarnessFailure: true, superseded: true,
          currentDelivery: agentFinal ? 'new/agent-final/delivery.json' : revision ? 'new/revision-1/delivery.json' : 'new/delivery.json',
          reason: 'a restarted diagnostic reused a call identity with a newly created document; final run used a new software-assigned run identity' })
      } catch { /* no historical harness diagnostic */ }
    } catch (error) {
      await writeJson(failureFile, { status: 'failed', stage: 'actual-import-save-publish',
        error: error instanceof Error ? error.message : 'delivery-failed', repairCalls: revision ? 1 : 0, firstDraftPreserved: true })
      throw error
    }
  } finally { await browser.close(); await browserServer.close(); await server.close() }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : 'comparison-failed'); process.exitCode = 1 })
