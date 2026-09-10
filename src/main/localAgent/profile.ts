import type { LocalAgentId } from '../../shared/localAgentContract'
import { generationAssetAliases, generationDestinationAliases, MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../shared/generationContract'
import path from 'node:path'
import { courseAgentSkills } from '../../shared/courseAgentSkills'
import { GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE } from '../../shared/generationResult'
import { generationCapabilityDirectory } from './capabilityWorkspace'

/** The CLI receives file identities, never an inline duplicate of attachment bytes. */
export function generationRequestForPrompt(request: GenerationRequest, candidateRoot?: string) {
  const { resourceFiles, ...projection } = request
  const fileAccess = candidateRoot ? generationFileAccess(candidateRoot) : undefined
  const context = projection.context
  const capabilities = context && typeof context === 'object' && !Array.isArray(context) ? context.capabilities : null
  const relative = (value: unknown) => typeof value === 'string' ? value.replace(/^capabilities\//, '') : value
  const rebased = capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
    ? { ...capabilities, discovery: relative(capabilities.discovery), query: relative(capabilities.query),
      deferred: Array.isArray(capabilities.deferred) ? capabilities.deferred.map(value => value && typeof value === 'object' && !Array.isArray(value) ? { ...value, path: relative(value.path) } : value) : capabilities.deferred,
      instruction: 'cards含当前模式完整Schema及引用，足够时直接生成；缺能力时用request.json的fileAccess.query按需查询。' } : null
  return { ...projection, ...(fileAccess ? { fileAccess } : {}), destinationAliases: generationDestinationAliases(request), assetAliases: generationAssetAliases(request), ...(rebased ? { context: { ...context as object, capabilities: rebased } } : {}), resourceIndex: (resourceFiles ?? []).map(file => ({
    path: `resources/${file.path}`, encoding: file.encoding, mediaType: file.mediaType, role: file.role,
    ...(fileAccess ? { localPath: path.join(fileAccess.resources, ...file.path.split('/')) } : {}),
  })) }
}

/** Exact native file locations in the existing staged request. These are read
 * references, not candidate ingestion permissions or a second resource store. */
function generationFileAccess(candidateRoot: string) {
  const root = path.resolve(candidateRoot), capabilities = generationCapabilityDirectory(root)
  return { root, capabilities, resources: path.join(root, 'resources'),
    discovery: path.join(capabilities, 'discovery.json'), query: path.join(capabilities, 'query.mjs'),
    skills: Object.fromEntries(courseAgentSkills.map(skill => [skill.name, path.join(capabilities, 'skills', skill.name, 'SKILL.md')])),
  }
}

/** Only explicit image/video/media references in frozen page rows are hot.
 * Other valid assets remain discoverable in the staged full alias inventory. */
function initialReferencedAssetIds(context: Record<string, unknown>): Set<string> {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const ids = new Set<string>()
  const add = (value: unknown) => { if (typeof value === 'string') ids.add(value) }
  for (const page of Array.isArray(context.pages) ? context.pages : []) {
    const rows = record(page)
    for (const row of Array.isArray(rows.items) ? rows.items : []) {
      const item = record(record(row).item), content = record(item.content)
      if (item.kind === 'native' && (content.nativeType === 'image' || content.nativeType === 'video')) add(record(content.data).assetId)
    }
    for (const row of Array.isArray(rows.blocks) ? rows.blocks : []) {
      const block = record(record(row).block)
      if (block.type === 'media') add(block.assetId)
    }
  }
  return ids
}

/** Initial wire view only. The staged request retains the complete inventories. */
export function generationInitialRequestForPrompt(request: GenerationRequest) {
  const full = generationRequestForPrompt(request)
  const context = full.context && typeof full.context === 'object' && !Array.isArray(full.context)
    ? full.context as Record<string, unknown> : null
  // Sources remain attached to their items and all readable files stay indexed.
  // These inventories duplicate those paths/targets or are read on demand.
  const { assets: _assets, runtimeSources: _runtimeSources, ...initialContext } = context ?? {}
  const { files: _files, ...observationIdentity } = full.observation ?? {}
  const { destinations: _destinations, execution, assetAliases: fullAssetAliases, ...wire } = full
  const referencedAssetIds = initialReferencedAssetIds(initialContext)
  const assetAliases = Object.fromEntries(Object.entries(fullAssetAliases).filter(([, id]) => referencedAssetIds.has(id)))
  return { ...wire,
    ...(execution ? { deadlineAt: execution.deadlineAt } : {}),
    ...(context ? { context: initialContext } : {}),
    ...(full.observation ? { observation: observationIdentity } : {}),
    ...(Object.keys(assetAliases).length ? { assetAliases } : {}),
    resourceIndex: full.resourceIndex.map(({ encoding: _encoding, ...file }) => file),
    requestDetails: { path: 'request.json', fields: ['context.assets', 'assetAliases', 'context.runtimeSources', 'observation.files'] },
  }
}

/** Native process environment locates the current request without transcribing
 * paths or request IDs. The full staged request retains exact file references. */
export function generationProfileForPrompt(profile: ReturnType<typeof createGenerationProfile>) {
  const relative = (file: string) => path.relative(profile.workspace.root, file).split(path.sep).join('/')
  return { version: profile.version, adapter: profile.adapter, candidateVersion: profile.candidateVersion,
    resultChannel: profile.resultChannel,
    workspace: { rootEnvironment: 'COURSEWARE_CANDIDATE_ROOT', request: relative(profile.workspace.request) },
    skills: profile.skills.map(skill => skill.name),
  }
}

export type GenerationPromptPhase = 'initial' | 'host-feedback'

/** Resource bytes and full capability files stay on demand in both phases. */
export function buildGenerationPrompt(adapter: LocalAgentId, request: GenerationRequest, candidateRoot: string, phase: GenerationPromptPhase = 'initial'): string {
  const profile = createGenerationProfile(adapter, request, undefined, candidateRoot)
  const channel = profile.resultChannel
  const terminal = (kind: 'answer' | 'edit') => `${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, kind })}${GENERATION_RESULT_CLOSE}`
  const output = channel === 'session-staging-file'
    ? `用原生脚本读取环境变量COURSEWARE_CANDIDATE_ROOT下request.json，requestId取文件值，写同根candidate.json；勿手抄路径/UUID/base64，勿用不展开环境变量的文件补丁工具交付候选。聊天勿复述候选JSON。写完最终回复附${terminal('edit')}；只答复/明确受阻/宿主已完成核对附${terminal('answer')}。`
    : channel === 'app-server-json-schema'
      ? profile.resultContract.mode === 'candidate'
        ? 'final_answer遵循outputSchema，直接返回候选；step.input为JSON字符串。'
        : 'final_answer遵循outputSchema：答复kind=reply/reply=文本/candidate=null；修改kind=edit/reply=null/candidate=候选。step.input为JSON字符串。'
      : `候选只在最终正文用 ${GENERATION_OPEN}JSON${GENERATION_CLOSE} 交付，写 candidate.json 不算交付。没有新候选（含宿主提交后的完成确认）直接自然语言回复。`
  return [
    '课件助手使用原生工具/Skills；观察含未保存内容、范围、版本；进展用自然语言。',
    phase === 'host-feedback'
      ? '这是同一任务的宿主反馈与目标核对阶段，不是重新执行原请求。以正式回执和当前观察核对原目标；已完成则直接答复，只有尚未完成的具体差距才提交下一阶段候选。“再放大一点”等相对修改不得因收到新观察再次累计执行。'
      : request.intent === 'plan'
      ? '本轮只读计划：基于当前范围给出可执行方案，不改课件；仅缺少决定核心目标的信息时提问。'
      : request.intent === 'discuss' ? '本轮只读讨论，禁止修改候选。'
      : request.intent === 'edit' || profile.resultContract.mode === 'candidate' ? '本轮要求修改，须交付候选；缺能力卡先查完整发现入口，无法完成须明确说明未完成。' : '本轮允许讨论或编辑指定范围，按实际结果选择回复或候选。',
    '工程只经候选事务修改，禁写Store/History或覆盖工程；正式回执前不算应用。缺必要信息用原生提问等待。',
    '保留原生cwd/权限。本轮根由进程环境COURSEWARE_CANDIDATE_ROOT提供，Node用process.env.COURSEWARE_CANDIDATE_ROOT。初始cards足够时直接生成，不重复发现；参数编辑无需源码。缺能力/源码/图像时读该根request.json：fileAccess.query/skills与resourceIndex.localPath为绝对路径；query用node执行。候选requestId从该文件读取。',
    output,
    ...(!request.intent || request.intent === 'edit' ? [
    '候选version=2：requestId/summary/afterCommit/steps；宿主给candidateId/carrier。step:id/tool/destination/input，非native须lowerCarrierReason；destination填destinationAliases的别名键（如"d1"），不要填其完整target对象。遵守Schema/$refs，禁整工程/通用JSON patch。',
    'afterCommit={version:1,action:"finish"}：修改完成且宿主校验足够即结束；尚需操作/互动验证才用{version:1,action:"observe",reason:"未完成事项"}。勿为总结/重读回执续轮；失败返回诊断。',
    '已有资产{"$asset":"a1"}见assetAliases/request.json；前序用{"$result":{"stepId":"s1","kind":"asset-id","index":0}}。kind还可package-id/item-id/location-id，禁猜ID。',
    ...(request.destinations.some(destination => destination.kind === 'create') ? [
      '前序对象destination={kind:"created-item",stepId:"s1",index:0}；新页用 {kind:"created-scope",stepId:"s1",parent:{kind:"owner"},insertion:{kind:"append"}}，Flow正文parent={kind:"flow-body",parentBlockId:null}。替换先创建再selection.replace；动态先读runtime-api2/3或component-api4。',
    ] : []),
    '动态smoke不算语义通过，动画看连续帧。Slide标题“居中”需textStyle.align=center且frame在页面水平中心；仅框内对齐时不移frame。',
    ] : ['本轮只读，按当前事实答复，不生成候选。']),
    JSON.stringify({ profile: generationProfileForPrompt(profile) }),
    JSON.stringify(generationInitialRequestForPrompt(request)),
  ].join('\n')
}

export function createGenerationProfile(adapter: LocalAgentId, request: GenerationRequest,
  resultChannel = adapter === 'codex' ? 'app-server-json-schema' : 'session-staging-file',
  candidateRoot?: string) {
  if (!['structured-stdout', 'session-staging-file', 'app-server-json-schema'].includes(resultChannel)) throw new Error('当前 CLI profile 未开放此候选结果通道')
  if (resultChannel === 'session-staging-file' && adapter === 'codex') throw new Error('当前 CLI 不支持会话暂存候选通道')
  if (resultChannel === 'app-server-json-schema' && adapter !== 'codex') throw new Error('当前 CLI 不支持 app-server 结构化候选通道')
  const names = request.purpose === 'whole-course' ? ['course-build', 'visual-craft', 'interaction-craft']
    : ['course-design', 'pro-editing', 'qa-repair', 'style-remix', 'visual-craft', 'interaction-craft']
  const root = candidateRoot ? path.resolve(candidateRoot) : `candidates/${request.requestId}`
  const fileAccess = generationFileAccess(root), capabilities = fileAccess.capabilities
  return { version: 1, adapter, candidateVersion: 2, resultChannel,
    resultContract: {
      mode: request.expectedResult === 'candidate' ? 'candidate' : 'reply-or-edit',
      candidateInputEncoding: resultChannel === 'app-server-json-schema' ? 'json-string' : 'json-value',
    },
    contextBudgetBytes: MAX_GENERATION_PROMPT_BYTES, skillRoots: [path.join(capabilities, 'skills')],
    workspace: { root, capabilities, request: path.join(root, 'request.json'), discovery: fileAccess.discovery,
      query: fileAccess.query, resources: fileAccess.resources },
    capability: { immutableSnapshot: true, nativeAgentLoop: true, liveProjectTools: false,
      candidateFileIngestion: resultChannel === 'session-staging-file' },
    taskInstruction: '先使用本轮最小快照与完整能力卡，足够时直接生成。技能按任务选择读取；教学策划用 course-design，明确修改用 pro-editing，整课只消费已确认 Markdown。缺少能力、技能方法或源码时读取 request.json 的 fileAccess 与 resourceIndex.localPath，直接使用绝对路径；参数修改无需先读组件源码。原生文件、终端、网络及子任务能力仍由 CLI 提供，课件修改经宿主候选事务提交。',
    skills: courseAgentSkills.filter(skill => names.includes(skill.name)).map(skill => ({ name: skill.name,
      summary: skill.body.split('。')[0], path: fileAccess.skills[skill.name]! })),
  }
}
