import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { _electron as electron, chromium, type ElectronApplication, type Page } from 'playwright'
import { prepareElectronLaunchEnvironment } from '../electronLaunchEnvironment'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { BundledSkillService, type BundledSkillBundle } from '../../src/main/workbench/skills/BundledSkillService'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { HtmlImportToolService } from '../../src/main/workbench/htmlImport/HtmlImportToolService'
import { HtmlImportOperationStore } from '../../src/main/workbench/htmlImport/HtmlImportOperationStore'
import { HtmlImportNetworkGrants } from '../../src/main/workbench/htmlImport/htmlImportNetworkGrants'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { resolveSaveDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { componentPackagesFromArchive, componentPackagesToArchiveFiles } from '../../src/renderer/components/componentPackageStore'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { HtmlImportService } from '../../src/main/workbench/htmlImport/HtmlImportService'
import { createCompositionFragmentPackage, exportCompositionFragmentPackage } from '../../src/renderer/components/compositionFragments/compositionFragmentPackage'
import { importComponentPackage } from '../../src/core/drivers/codecs/importComponentPackage'
import { planComponentPackageInsertion } from '../../src/renderer/components/insertComponentPackages'
import { openSlideAuthoringSession } from '../../src/renderer/course/slideAuthoringBackend'
import { applyHistoryResourceChanges } from '../../src/renderer/store/courseResourceState'
import sharp from 'sharp'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { CreatedCourseFromHtml } from '../../src/main/workbench/htmlImport/CreateCourseFromHtml'

const repoRoot = process.cwd()
const directory = path.resolve(process.argv[2] ?? 'output/unified-content-architecture/f07/circuits-flash')
const mode = process.argv[3] ?? 'prepare'
const newFolderName = process.argv[4] ?? 'new'
const route = { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-flash', billing: 'unknown' }
const viewport = { width: 1280, height: 720 }
const parameters = { temperature: 0.7, thinking: { type: 'disabled' } }
const userPrompt = `为初中物理教师创作一页中文互动演示课件，主题“串联与并联：电流、电压怎样分配？”。目标画面为1280×720，正常字号，无需滚动即可看清核心内容。设计清晰的标题、学习问题和两个并排比较区域，有真实SVG电路图及数据图，整体有优秀教学作品的视觉层次与美感。
材料固定：理想电源6V，两个定值电阻R₁=10Ω、R₂=20Ω。串联电流均为0.20A，总电流0.20A，分压为2V和4V；并联两支路电压均为6V，电流分别0.60A、0.30A，总电流0.90A。对照必须使用同一电源和两个电阻。
教学顺序：先让学生预测电流、电压如何分配，再点击“观察实验”揭示真实数值及图中变化，然后用观察解释“串联电流相等、电压相加；并联电压相等、电流相加”。预测控件可以真实选择，教师可直接揭示，不设置答对才可继续的门槛。必须有“重置”且可重复操作。允许切换串联/并联，并可把电源从6V调到9V，显示相应正确的电流、电压变化及单位；重置恢复初始状态。核心电路和必要解释直接呈现，不能用素材占位、隐藏答案代替教学主体。
仅使用本地HTML、CSS、SVG和JavaScript，无远程字体、脚本或图像；不调用图片生成。创作并交付这一页作品，保留完整可独立运行的HTML源文；当前环境有工程交付能力时，同时保存为可编辑课件。布局、样式和互动由你自由创作，不使用成品模板。`
const selection: ModelSelection = { model: route.model, parameters, connection: {
  id: 'f07-teamorouter-runtime', revision: 1, provider: route.provider, protocol: 'openai-chat', baseURL: route.baseURL,
  accountId: 'owner-authorized-test', auth: { kind: 'api-key', credentialRef: 'TEAMOROUTER_API_KEY-runtime-only' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' },
} }
const writeJson = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
}
const exists = (file: string) => fs.access(file).then(() => true, () => false)

function extractHtml(raw: string) {
  const blocks = [...raw.matchAll(/```(?:html)?\s*([\s\S]*?)\s*```/gi)]
  if (!blocks.length) return { html: raw, mechanicalPackaging: 'none' }
  if (blocks.length !== 1 || !/<html[\s>][\s\S]*<\/html\s*>/i.test(blocks[0]![1]!))
    throw new Error('bare-html-block-needs-specific-diagnosis')
  return { html: blocks[0]![1]!, mechanicalPackaging: 'extracted only one complete HTML code block; original completion retained' }
}

async function prepare() {
  await fs.mkdir(directory, { recursive: true })
  const bundle = JSON.parse(await fs.readFile(path.join(repoRoot, 'src/shared/generated/bundledSkills.json'), 'utf8')) as BundledSkillBundle
  const skills = new BundledSkillService(bundle)
  await fs.writeFile(path.join(directory, 'user-prompt.txt'), userPrompt)
  await writeJson(path.join(directory, 'conditions.json'), { route, viewport, parameters,
    same: ['user prompt', 'circuit material', 'target specification', 'requested model', 'temperature', 'thinking mode'],
    differences: { bare: 'one real provider content-only request without skills, tools or template',
      new: 'production ExecutionEngine, bundled Skill tools, AgentFileService, canonical course.createFromHtml and real Electron admission' },
    budget: 'runner supplies no output cap, duration cap or request/tool count caps; production/provider settings apply. Completed historical bare request used an explicit 8192 cap and was not truncated; the first new attempt was truncated by that removed test cap. Content generation and tool/summary overhead reported separately; cost and historical request parameters are not asserted identical',
    skillCatalog: await skills.catalog(), quality: 'relative to bare HTML; shared model errors do not fail the software refactor; one task is not universal proof',
    accountPlan: 'unknown', actualCharge: 'unknown', humanContentInterventions: 0 })
  console.log(`F07 prepared: ${directory}; no model requests`)
}

function credential() {
  const value = process.env.TEAMOROUTER_API_KEY
  if (!value) throw new Error('TEAMOROUTER_API_KEY-missing')
  return value
}

async function catalog() {
  const file = path.join(directory, 'catalog.json')
  if (await exists(file)) return
  try {
    const response = await fetch(`${route.baseURL}/models`, { headers: { Authorization: `Bearer ${credential()}` }, redirect: 'error' })
    if (!response.ok) { await writeJson(file, { checkedAt: new Date().toISOString(), route, diagnostic: `catalog-http-${response.status}`, blocking: false }); return }
    const data = await response.json() as { data?: { id: string; owned_by?: string }[] }
    await writeJson(file, { checkedAt: new Date().toISOString(), route, models: data.data?.map(value => ({ id: value.id, owned_by: value.owned_by ?? null })),
      selectedAliasPresent: data.data?.some(value => value.id === route.model) ?? false, blocking: false,
      mapping: 'catalog is diagnostic; actual response models recorded for each generation request' })
  } catch (error) {
    await writeJson(file, { checkedAt: new Date().toISOString(), route, diagnostic: error instanceof Error ? error.name : 'catalog-read-failed', blocking: false })
  }
}

function recordingProvider(folder: string): ModelProvider {
  const actual = new OpenAIChatProvider({ credentialResolver: async () => credential() })
  let count = 0
  return { retrySafety: actual.retrySafety, async *stream(request, options) {
    const at = ++count, started = performance.now(), events: ModelEvent[] = []
    await writeJson(path.join(folder, `request-${at}.json`), request)
    console.log(`${path.basename(folder)}: real model request ${at} on ${route.model}`)
    try {
      for await (const event of actual.stream(request, options)) { events.push(event); yield event }
    } finally {
      const completed = events.find(event => event.type === 'response.completed')
      await writeJson(path.join(folder, `response-${at}.json`), { elapsedMs: performance.now() - started,
        actualModel: completed?.type === 'response.completed' ? completed.actualModel ?? null : null,
        usage: completed?.type === 'response.completed' ? completed.usage ?? null : null,
        completion: completed ?? null, failures: events.filter(event => event.type === 'response.failed'),
        ...(completed ? {} : { incompleteResponseEvents: events }) })
    }
  } }
}

async function bare() {
  const folder = path.join(directory, 'bare')
  if (await exists(path.join(folder, 'completion.txt'))) {
    const extracted = extractHtml(await fs.readFile(path.join(folder, 'completion.txt'), 'utf8'))
    await fs.writeFile(path.join(folder, 'first-draft.html'), extracted.html)
    const record = JSON.parse(await fs.readFile(path.join(folder, 'generation.json'), 'utf8'))
    await writeJson(path.join(folder, 'generation.json'), { ...record, mechanicalPackaging: extracted.mechanicalPackaging })
    console.log('bare: existing original retained; mechanical HTML extraction only; no new request'); return
  }
  await fs.mkdir(folder, { recursive: true })
  await catalog()
  const provider = recordingProvider(folder), started = performance.now()
  const request: ModelRequest = { requestId: randomUUID(), selection, tools: [], messages: [
    { role: 'system', content: '专注于创作内容、视觉和互动。这一环境仅提供内容创作，请直接输出完整可独立运行的HTML文档，不加Markdown围栏或说明；没有工程交付工具。' },
    { role: 'user', content: userPrompt },
  ] }
  let result: Extract<ModelEvent, { type: 'response.completed' }> | undefined
  for await (const event of provider.stream(request)) {
    if (event.type === 'response.failed') throw new Error(`bare-${event.failure.code}`)
    if (event.type === 'response.completed') result = event
  }
  const raw = typeof result?.assistant.content === 'string' ? result.assistant.content : ''
  await fs.writeFile(path.join(folder, 'completion.txt'), raw)
  const extracted = extractHtml(raw)
  await fs.writeFile(path.join(folder, 'first-draft.html'), extracted.html)
  await writeJson(path.join(folder, 'generation.json'), { route, elapsedMs: performance.now() - started,
    actualModel: result?.actualModel ?? null, finishReason: result?.finishReason ?? null, usage: result?.usage ?? null,
    requests: 1, contentGenerationRequests: 1, toolOverheadRequests: 0, humanContentInterventions: 0,
    mechanicalPackaging: extracted.mechanicalPackaging })
}

async function electronAdmission(folder: string): Promise<{ app: ElectronApplication; port: BuildAdmissionPort }> {
  const environment: Record<string, string> = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  environment.VITE_DEV_SERVER_URL = ''
  environment.COURSEWARE_E2E_BACKGROUND = '1'
  delete environment.TEAMOROUTER_API_KEY
  delete environment.DEEPSEEK_API_KEY
  prepareElectronLaunchEnvironment(environment)
  const app = await electron.launch({ cwd: repoRoot, args: ['.', `--user-data-dir=${path.join(folder, 'admission-profile')}`], env: environment })
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof (window as any).desktopAPI?.dynamicAdmission === 'function')
  let count = 0
  const port: BuildAdmissionPort = { async run(payload, signal) {
    const id = randomUUID(), at = ++count
    const cancel = () => { void page.evaluate(value => (window as any).desktopAPI.dynamicAdmission({ operation: 'cancel', id: value }), id).catch(() => undefined) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      const serialized = { ...payload, assetFiles: Object.fromEntries(Object.entries(payload.assetFiles)
        .map(([key, value]) => [key, typeof value === 'string' ? value : Array.from(value)])) }
      const result = await page.evaluate(async input => {
        const content = { ...input.payload, assetFiles: Object.fromEntries(Object.entries(input.payload.assetFiles)
          .map(([key, value]) => [key, typeof value === 'string' ? value : new Uint8Array(value)])) }
        return (window as any).desktopAPI.dynamicAdmission({ operation: 'run', id: input.id, payload: content })
      }, { id, payload: serialized })
      await writeJson(path.join(folder, `admission-${at}.json`), { pipeline: 'real Electron preload -> operateDynamicAdmission -> isolated product admission renderer', result })
      signal.throwIfAborted()
      return result
    } finally { signal.removeEventListener('abort', cancel) }
  } }
  return { app, port }
}

async function closeElectron(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function newPath() {
  const folder = path.join(directory, newFolderName)
  if (await exists(path.join(folder, 'run.json'))) { console.log('new: existing original run retained; inspect evidence before considering any retry'); return }
  await fs.mkdir(folder, { recursive: true })
  const workspaceRoot = path.join(folder, 'workspace')
  await fs.mkdir(workspaceRoot, { recursive: true })
  await catalog()
  const { app, port } = await electronAdmission(folder)
  try {
    const startedAt = new Date().toISOString(), started = performance.now()
    const host = new DocumentHostService(path.join(folder, 'journal'))
    const files = new AgentFileService(host)
    const builds = new ControlledBuildService({ directory: path.join(folder, 'builds'), admission: port })
    const grants = new HtmlImportNetworkGrants()
    const htmlImports = new HtmlImportToolService({ documents: { read: host.internalAPI.read, get: id => host.registry.get(id) },
      gateway: host.tools, cancelJob: async (runId, jobId) => { await builds.execute(runId, { type: 'cancel', jobId }) },
      networkGrants: grants, operationStore: new HtmlImportOperationStore(path.join(folder, 'imports')) })
    const access = { workspaceRoot, permission: 'workspace' as const }
    const deliveries = new DocumentDeliveryService({ documents: { read: host.internalAPI.read,
      saveWithFact: (...args) => host.saveWithFact(...args), lookupSave: (...args) => host.lookupSave(...args),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
      operations: new DocumentDeliveryOperationStore(path.join(folder, 'deliveries')),
      authorize: async ({ documentId }) => {
        const snapshot = await host.internalAPI.read(documentId)
        if (snapshot.binding.kind !== 'file' || !snapshot.binding.path.startsWith(workspaceRoot + path.sep)) throw new Error('save-outside-frozen-workspace')
      },
      resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, () => access),
      resolveExportDestination: async () => null, build: { build: async () => { throw new Error('not-a-model-export-task') } }, writer: workbenchExportWriter })
    const bundle = JSON.parse(await fs.readFile(path.join(repoRoot, 'src/shared/generated/bundledSkills.json'), 'utf8')) as BundledSkillBundle
    const skills = new BundledSkillService(bundle)
    host.tools.configureHostServices({ skills, htmlImports, deliveries, builds: Object.assign(builds, {
      policy: (runId: string, documentId: string) => grants.policy(runId, documentId, () => host.registry.get(documentId).read()),
    }) })
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider: recordingProvider(folder), files,
      runs: new ExecutionRunStore(path.join(folder, 'runs')), events: new ExecutionEventStore({ directory: path.join(folder, 'events') }) })
    const run = await engine.start({ conversationId: 'f07-circuits', taskId: randomUUID(), instruction: userPrompt,
      documents: [], workspaceRoot, permission: 'workspace', selection })
    const final = await engine.wait(run.runId)
    await writeJson(path.join(folder, 'run.json'), final)
    const generated = final.tools.filter(tool => tool.origin !== 'host' && tool.call.name === 'file.write'
      && typeof (tool.call.input as any)?.content === 'string')
    const firstVersions = new Set<string>()
    for (const tool of generated) {
      const input = tool.call.input as { path: string; content: string }
      const relative = path.relative(workspaceRoot, path.resolve(workspaceRoot, input.path))
      if (firstVersions.has(relative) || relative.startsWith('..') || path.isAbsolute(relative)) continue
      firstVersions.add(relative)
      const destination = path.join(folder, 'first-generation', relative)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, input.content)
    }
    const receipt = final.tools.find(tool => tool.call.name === 'course.createFromHtml' && tool.result?.kind === 'read'
      && (tool.result.data as Partial<CreatedCourseFromHtml>)?.saved)
    const delivered = receipt?.result?.kind === 'read' ? receipt.result.data as CreatedCourseFromHtml : null
    await writeJson(path.join(folder, 'generation.json'), { route, startedAt, elapsedMs: performance.now() - started,
      status: final.status, requests: final.requests, skillReads: final.tools.filter(tool => tool.call.name === 'skills.read').map(tool => ({ input: tool.call.input, result: tool.result })),
      contentGenerationRequestIds: [...new Set(generated.map(tool => tool.requestId))],
      toolOrSummaryRequestIds: final.requests.filter(request => !generated.some(tool => tool.requestId === request.requestId)).map(request => request.requestId),
      modelSourceRevisions: final.tools.filter(tool => ['file.patch', 'text.replace'].includes(tool.call.name)).length,
      humanContentInterventions: 0, savedCourseReceipt: delivered,
      pipeline: 'actual ExecutionEngine -> real provider -> model-selected bundled skills.read -> file.write -> course.createFromHtml -> real Electron admission -> canonical save' })
    if (!delivered) throw new Error(`new-path-not-delivered-${final.status}`)
    const sourceRelative = path.relative(workspaceRoot, delivered.sourcePath)
    await fs.copyFile(path.join(folder, 'first-generation', sourceRelative), path.join(folder, 'first-draft.html'))
    const reopened = await new DocumentHostService(path.join(folder, 'reopened-journal')).open(delivered.path)
    if (reopened.model.kind !== 'course-v9') throw new Error('saved-course-reopen-wrong-kind')
    const model = reopened.model
    const playerBundle = await fs.readFile(path.join(repoRoot, 'dist-player/player.iife.js'), 'utf8')
    const html = buildPublishedCourseStandaloneHtml({ project: model.project, assetFiles: model.resources.assets,
      components: componentPackagesFromArchive(model.project, model.resources.components) }, { playerBundle, lang: 'zh-CN' })
    await fs.writeFile(path.join(folder, 'first-draft-player.html'), html)
    await writeJson(path.join(folder, 'delivery.json'), { delivered, reopened: { kind: reopened.model.kind, dirty: reopened.dirty,
      pages: model.project.locations.length, projectTitle: model.project.title }, publisher: 'real standalone Published Course V2',
      sourceRelative, humanContentInterventions: 0 })
    console.log(`new: ${final.status}, ${final.requests.length} real requests, saved and reopened`)
  } finally { await closeElectron(app) }
}

async function observeFile(page: Page, file: string, folder: string, prefix: string) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(pathToFileURL(file).href)
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(folder, `${prefix}-initial.png`) })
  const frames = []
  for (const frame of page.frames()) {
    try { frames.push(await frame.evaluate(() => ({ url: location.href, text: document.body?.innerText,
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, svgCount: document.querySelectorAll('svg').length,
      controls: [...document.querySelectorAll('button,select,input')].map(node => ({ tag: node.tagName,
        id: node.id, text: node.textContent, value: (node as HTMLInputElement).value })) }))) } catch { /* detached non-content frame */ }
  }
  await writeJson(path.join(folder, `${prefix}-observation.json`), { file, errors, frames,
    proof: 'actual initial presentation only; specific interaction observations recorded separately after inspecting real first drafts' })
}

async function observe() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const name of ['bare', 'new']) {
      const folder = path.join(directory, name === 'new' ? newFolderName : name), page = await browser.newPage({ viewport })
      const source = name === 'bare' ? path.join(folder, 'first-draft.html') :
        path.join(folder, 'first-generation', (JSON.parse(await fs.readFile(path.join(folder, 'delivery.json'), 'utf8')) as { sourceRelative: string }).sourceRelative)
      await observeFile(page, source, folder, 'raw')
      await page.close()
      if (name === 'new') {
        const player = await browser.newPage({ viewport })
        await observeFile(player, path.join(folder, 'first-draft-player.html'), folder, 'player')
        await player.close()
      }
    }
  } finally { await browser.close() }
}

async function fragment() {
  await fs.mkdir(directory, { recursive: true })
  const sourceRoot = path.join(directory, 'source'), childRoot = path.join(sourceRoot, 'interaction')
  await fs.mkdir(childRoot, { recursive: true })
  const sourcePath = path.join(sourceRoot, 'lesson.html')
  const child = '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><img src="diagram.png" alt="示意图"><button id="counter">次数：0</button><script src="experiment.js"></script></body></html>'
  const chart = '<guoling-chart style="display:block;width:100%;height:180px"><script type="application/json">{"chartType":"bar","title":"观察记录","categories":["甲","乙"],"series":[{"name":"次数","values":[3,5]}]}</script></guoling-chart>'
  const shell = '<!doctype html><html><head><style>html,body{margin:0}main{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:20px}iframe{width:100%;height:160px;border:0}.note{font:24px Arial}</style></head><body><main><section><p class="note">先预测，再观察。</p>' + chart + '</section><iframe id="experiment" title="独立实验" src="interaction/experiment.html"></iframe></main></body></html>'
  await Promise.all([fs.writeFile(sourcePath, shell), fs.writeFile(path.join(childRoot, 'experiment.html'), child),
    fs.writeFile(path.join(childRoot, 'theme.css'), 'body{margin:0;background:#dcfce7}button{font:24px Arial;color:#14532d}img{width:20px;height:20px}'),
    fs.writeFile(path.join(childRoot, 'experiment.js'), 'window.loadRuns=(window.loadRuns||0)+1;let n=0;document.getElementById("counter").addEventListener("click",()=>document.getElementById("counter").textContent="次数："+ ++n);')])
  await sharp({ create: { width: 2, height: 3, channels: 4, background: '#16a34a' } }).png().toFile(path.join(childRoot, 'diagram.png'))
  const { app, port } = await electronAdmission(directory)
  try {
    let committed: unknown = { status: 'reused-existing-source-admission', evidence: 'admission-1.json; source.h5lesson' }
    if (!await exists(path.join(directory, 'source.h5lesson'))) {
      const host = new DocumentHostService(path.join(directory, 'source-journal'))
      const project = createBlankCourseProject({ title: 'F03 普通独立互动页面', canvas: { width: 800, height: 480 }, includeDefaultController: false, controls: 'none' })
      const created = await host.internalAPI.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, 'source.h5lesson')
      const builds = new ControlledBuildService({ directory: path.join(directory, 'builds'), admission: port })
      host.tools.configureHostServices({ builds })
      const runId = randomUUID()
      await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: created.documentId, writable: [{ kind: 'document' }] }] })
      const target = await host.tools.issueTarget(runId, created.documentId, { kind: 'document' })
      const importer = new HtmlImportService({ session: host.registry.get(created.documentId), gateway: host.tools })
      const ticket = await importer.prepare({ operationId: 'f07-mixed-original-import', runId, targetHandle: target, sourcePath, locationId: project.startLocationId })
      await importer.admit(ticket)
      const result = await importer.commit(ticket)
      committed = result
      if (result.status !== 'applied') throw new Error('fragment-source-import-not-applied')
      await host.saveToPath(created.documentId, path.join(directory, 'source.h5lesson'))
      await host.tools.stop(runId)
    }
    const reopened = await new DocumentHostService(path.join(directory, 'source-reopened')).open(path.join(directory, 'source.h5lesson'))
    if (reopened.model.kind !== 'course-v9') throw new Error('fragment-source-reopen-wrong-kind')
    const source = reopened.model, slide = source.project.surfaces.find(surface => surface.type === 'slide')!
    const item = slide.scenes[0]!.layerItems[0]!
    if (item.kind !== 'composition') throw new Error('fragment-source-not-composition')
    const data = createCompositionFragmentPackage({ project: source.project, assetFiles: source.resources.assets,
      componentPackages: componentPackagesFromArchive(source.project, source.resources.components), layerItemId: item.layerItemId, name: 'F03 两栏独立互动' })
    const fragmentPath = path.join(directory, 'mixed.h5component')
    await fs.writeFile(fragmentPath, exportCompositionFragmentPackage(data))
    const parsed = importComponentPackage(new Uint8Array(await fs.readFile(fragmentPath)))
    const targetHost = new DocumentHostService(path.join(directory, 'target-journal'))
    const targetProject = createBlankCourseProject({ title: 'F07 跨工程复用', canvas: { width: 800, height: 480 }, includeDefaultController: false, controls: 'none' })
    const targetSnapshot = await targetHost.internalAPI.create({ kind: 'course-v9', project: targetProject, resources: { assets: {}, components: {} } }, 'second.h5lesson')
    const planned = planComponentPackageInsertion({ document: targetProject, assetFiles: {}, componentPackages: {},
      slide: openSlideAuthoringSession(targetProject, { locationId: targetProject.startLocationId }), spatial: null, flow: null,
      target: { projectId: targetProject.id, revision: targetProject.revision, generation: 1, locationId: targetProject.startLocationId, stateId: null, scope: 'scene' }, packages: [parsed] })
    const resources = applyHistoryResourceChanges({ assetFiles: {}, componentPackages: {} }, planned.step.resourceChanges, 'forward')
    const inserted = await targetHost.registry.get(targetSnapshot.documentId).execute({ documentId: targetSnapshot.documentId,
      epoch: targetSnapshot.epoch, baseRevision: targetSnapshot.revision, operationId: 'f07-fragment-insertion', actor: 'human',
      mutation: { type: 'command', command: { type: 'course.replace', project: { ...planned.step.nextDocument, revision: targetProject.revision },
        resources: { assets: resources.assetFiles, components: componentPackagesToArchiveFiles(resources.componentPackages) } } } })
    await writeJson(path.join(directory, 'insertion-receipt.json'), inserted)
    if (inserted.status !== 'applied') throw new Error('fragment-target-insertion-not-applied')
    const targetPath = path.join(directory, 'second.h5lesson')
    await targetHost.saveToPath(targetSnapshot.documentId, targetPath)
    const final = await new DocumentHostService(path.join(directory, 'target-reopened')).open(targetPath)
    if (final.model.kind !== 'course-v9') throw new Error('fragment-target-reopen-wrong-kind')
    const model = final.model
    const html = buildPublishedCourseStandaloneHtml({ project: model.project, assetFiles: model.resources.assets,
      components: componentPackagesFromArchive(model.project, model.resources.components) },
    { playerBundle: await fs.readFile(path.join(repoRoot, 'dist-player/player.iife.js'), 'utf8'), lang: 'zh-CN' })
    const playerPath = path.join(directory, 'second-player.html')
    await fs.writeFile(playerPath, html)
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 480 } }), errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(pathToFileURL(playerPath).href)
      const composition = page.frameLocator('iframe[data-web-composition]')
      const interaction = composition.frameLocator('#experiment').frameLocator('iframe[data-html-document-runtime]')
      await interaction.locator('#counter').waitFor({ state: 'visible' })
      const before = await interaction.locator('#counter').textContent()
      await interaction.locator('#counter').click()
      const after = await interaction.locator('#counter').textContent()
      const dependency = await interaction.locator('body').evaluate(() => ({ imageWidth: document.querySelector('img')!.naturalWidth,
        background: getComputedStyle(document.body).backgroundColor, loads: (window as any).loadRuns }))
      const professional = await composition.locator('guoling-chart').evaluate(element => element.querySelectorAll('svg,canvas,[data-native-type]').length)
      await page.screenshot({ path: path.join(directory, 'reuse-player.png') })
      await writeJson(path.join(directory, 'evidence.json'), { pipeline: 'F03 ordinary local iframe + professional chart -> real Electron admission -> canonical import/save/reopen -> existing h5component extraction/import/insertion -> canonical second-course save/reopen -> standalone Player',
        modelCalls: 0, committed, inserted, sourceKind: item.kind, fragmentManifest: parsed.manifest,
        resources: Object.keys(model.resources.assets), before, after, dependency, professional, errors,
        status: before === '次数：0' && after === '次数：1' && dependency.imageWidth === 2 && dependency.loads === 1
          && dependency.background === 'rgb(220, 252, 231)' && professional > 0 && errors.length === 0 ? 'passed' : 'failed' })
      if (before !== '次数：0' || after !== '次数：1' || dependency.imageWidth !== 2 || professional < 1 || errors.length)
        throw new Error('fragment-player-observation-failed')
      console.log('fragment: existing asset extraction/insertion preserves newly imported nested HTML program, CSS, image and chart')
    } finally { await browser.close() }
  } finally { await closeElectron(app) }
}

async function main() {
  if (mode === 'prepare') await prepare()
  else if (mode === 'new') await newPath()
  else if (mode === 'bare') await bare()
  else if (mode === 'observe') await observe()
  else if (mode === 'fragment') await fragment()
  else throw new Error('mode-must-be-prepare-new-bare-observe-or-fragment')
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'F07-run-failed'); process.exitCode = 1 })
