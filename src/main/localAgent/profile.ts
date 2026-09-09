import type { LocalAgentId } from '../../shared/localAgentContract'
import { MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../shared/generationContract'
import path from 'node:path'
import { courseAgentSkills } from '../../shared/courseAgentSkills'
import { GENERATION_OPEN, GENERATION_CLOSE } from '../../shared/generationResult'
import { generationCapabilityDirectory } from './capabilityWorkspace'

/** The CLI receives file identities, never an inline duplicate of attachment bytes. */
export function generationRequestForPrompt(request: GenerationRequest) {
  const { resourceFiles, ...projection } = request
  const context = projection.context
  const capabilities = context && typeof context === 'object' && !Array.isArray(context) ? context.capabilities : null
  const relative = (value: unknown) => typeof value === 'string' ? value.replace(/^capabilities\//, '') : value
  const rebased = capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
    ? { ...capabilities, discovery: relative(capabilities.discovery), query: relative(capabilities.query),
      deferred: Array.isArray(capabilities.deferred) ? capabilities.deferred.map(value => value && typeof value === 'object' && !Array.isArray(value) ? { ...value, path: relative(value.path) } : value) : capabilities.deferred,
      instruction: 'cards为预展开子集；完整toolIds可按需查询。能力路径相对workspace.capabilities；以当前语义版本及适用scope为准。' } : null
  return { ...projection, ...(rebased ? { context: { ...context as object, capabilities: rebased } } : {}), resourceIndex: (resourceFiles ?? []).map(file => ({
    path: `resources/${file.path}`, encoding: file.encoding, mediaType: file.mediaType, role: file.role,
  })) }
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
  return { ...full,
    ...(context ? { context: initialContext } : {}),
    ...(full.observation ? { observation: observationIdentity } : {}),
    resourceIndex: full.resourceIndex.map(({ encoding: _encoding, ...file }) => file),
    requestDetails: { path: 'request.json', fields: ['context.assets', 'context.runtimeSources', 'observation.files'] },
  }
}

/** Separate immutable capability and per-request project anchors. */
export function generationProfileForPrompt(profile: ReturnType<typeof createGenerationProfile>) {
  const relative = (file: string) => path.relative(profile.workspace.root, file).split(path.sep).join('/')
  const capabilityRelative = (file: string) => path.relative(profile.workspace.capabilities, file).split(path.sep).join('/')
  return { version: profile.version, adapter: profile.adapter, candidateVersion: profile.candidateVersion,
    resultChannel: profile.resultChannel, resultContract: profile.resultContract,
    workspace: { root: profile.workspace.root, capabilities: profile.workspace.capabilities, request: relative(profile.workspace.request),
      discovery: capabilityRelative(profile.workspace.discovery), query: capabilityRelative(profile.workspace.query), resources: relative(profile.workspace.resources) },
    skills: profile.skills.map(skill => ({ name: skill.name, path: capabilityRelative(skill.path) })),
  }
}

export type GenerationPromptPhase = 'initial' | 'host-feedback'

/** Resource bytes and full capability files stay on demand in both phases. */
export function buildGenerationPrompt(adapter: LocalAgentId, request: GenerationRequest, candidateRoot: string, phase: GenerationPromptPhase = 'initial'): string {
  const profile = createGenerationProfile(adapter, request, undefined, candidateRoot)
  const channel = profile.resultChannel
  const output = channel === 'session-staging-file'
    ? '有新候选时写 workspace.root 下的 candidate.json；完成确认直接回复，勿重复生成候选。聊天勿复述JSON。媒体/长源码用脚本读文件并JSON序列化，勿手工转抄base64；destination读取本轮request.json。'
    : channel === 'app-server-json-schema'
      ? profile.resultContract.mode === 'candidate'
        ? 'final_answer 严格遵循 outputSchema，直接返回候选；step.input 为完整 JSON 字符串。'
        : 'final_answer 严格遵循 outputSchema：讨论用 kind=reply、reply=答复、candidate=null；修改用 kind=edit、reply=null、candidate=候选。step.input 为完整 JSON 字符串。'
      : `候选只在最终正文用 ${GENERATION_OPEN}JSON${GENERATION_CLOSE} 交付，写 candidate.json 不算交付。没有新候选（含宿主提交后的完成确认）直接自然语言回复。`
  return [
    '你是课件创作助手。本轮观察代表当前未保存内容/范围/版本；使用CLI原生工具与Skills。公开进展用自然语言，不输出私有思维。',
    phase === 'host-feedback'
      ? '这是同一任务的宿主反馈与目标核对阶段，不是重新执行原请求。以正式回执和当前观察核对原目标；已完成则直接答复，只有尚未完成的具体差距才提交下一阶段候选。“再放大一点”等相对修改不得因收到新观察再次累计执行。'
      : request.intent === 'plan'
      ? '本轮只读计划：基于当前范围给出可执行方案，不改课件；仅缺少决定核心目标的信息时提问。'
      : request.intent === 'discuss' ? '本轮只读讨论，禁止修改候选。'
      : request.intent === 'edit' || profile.resultContract.mode === 'candidate' ? '本轮要求修改，须交付候选；缺能力卡先查完整发现入口，无法完成须明确说明未完成。' : '本轮允许讨论或编辑指定范围，按实际结果选择回复或候选。',
    '课件只经候选事务修改，禁写Store/History或覆盖工程；工具成功不代表修改，须等宿主回执。',
    '需要用户补充时调用原生提问工具并等待回答；问句不是修改完成。',
    '工程资料相对workspace.root，能力/Skills相对workspace.capabilities，按需读取。当前观察优先；参数修改无需源码。准备文件限本次root；原生cwd/权限独立。',
    '保持原生cwd，用node执行workspace.capabilities/query的引号绝对路径；Read长行截断时用query。',
    output,
    '候选version=1、requestId=本轮ID、candidateId=新UUID、summary、steps。step同级id/tool/carrier/destination/input；非native须非空lowerCarrierReason。遵守卡片Schema及局部$defs/$ref，禁止整工程输出或通用JSON patch。',
    'destination 完整复制 request.destinations，保留 stateId:null 等字段。update 修改、create 插入。前序对象用 {kind:"created-item",stepId:"s1",index:0}；前序新页用 {kind:"created-scope",stepId:"s1",parent:{kind:"owner"},insertion:{kind:"append"}}，Flow正文 parent={kind:"flow-body",parentBlockId:null}。',
    'input 内前序新ID用 {"$result":{"stepId":"s1","kind":"asset-id 或 package-id 或 item-id 或 location-id","index":0}} 对象，禁止猜ID。源码须完整且正确 JSON 转义。载体顺序 Native → Recipe → Existing Component → Generated Component → Runtime；高阶载体说明低阶不足。',
    '替换载体先在 create scope 创建，再用 selection.replace 引用新 item-id。动态源码先读对应 runtime-api2/3 或 component-api4 协议；后备引用真实 asset-id。',
    '完成前看当前画面核对目标，勿凭名称或旧结论；动态结构核对源码，动画核对连续帧。textStyle.align仅框内对齐；页面居中须改frame。',
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
  const capabilities = generationCapabilityDirectory(root)
  return { version: 1, adapter, candidateVersion: 1, resultChannel,
    resultContract: {
      mode: request.expectedResult === 'candidate' ? 'candidate' : 'reply-or-edit',
      candidateInputEncoding: resultChannel === 'app-server-json-schema' ? 'json-string' : 'json-value',
    },
    contextBudgetBytes: MAX_GENERATION_PROMPT_BYTES, skillRoots: [path.join(capabilities, 'skills')],
    workspace: { root, capabilities, request: path.join(root, 'request.json'), discovery: path.join(capabilities, 'discovery.json'),
      query: path.join(capabilities, 'query.mjs'), resources: path.join(root, 'resources') },
    capability: { immutableSnapshot: true, nativeAgentLoop: true, liveProjectTools: false,
      candidateFileIngestion: resultChannel === 'session-staging-file' },
    taskInstruction: '先使用本轮最小快照与相关能力卡。技能按任务选择读取；教学策划用 course-design，明确修改用 pro-editing，整课只消费已确认 Markdown。完整能力、技能方法与源码均在本轮 workspace 的文件中，路径不依赖 CLI 工作目录；按需读取，参数修改无需先读组件源码。原生文件、终端、网络及子任务能力仍由 CLI 提供，课件修改经宿主候选事务提交。',
    skills: courseAgentSkills.filter(skill => names.includes(skill.name)).map(skill => ({ name: skill.name,
      summary: skill.body.split('。')[0], path: path.join(capabilities, 'skills', skill.name, 'SKILL.md') })),
  }
}
