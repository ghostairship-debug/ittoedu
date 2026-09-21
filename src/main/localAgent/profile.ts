import type { LocalAgentId } from '../../shared/localAgentContract'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import { generationAssetAliases, generationDestinationAliases, generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../shared/generationContract'
import path from 'node:path'
import { courseAgentAvailableSkills, courseAgentSkillSummary, candidateMediaFileGuidance, publicCourseReplyGuidance } from '../../shared/courseAgentSkills'
import { courseAgentTaskGuidance, generationRepairFeedbackGuidance } from '../../shared/courseAgentTaskGuidance'
import { GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE } from '../../shared/generationResult'
import { generationTaskFactsPromptProjection } from '../../shared/generationTaskFactsProjection'
import { compactGenerationPage } from '../../shared/generationPageProjection'
import { generationCapabilityDirectory } from './capabilityWorkspace'
import { candidateMediaDeliveryAccess } from './candidateMediaDelivery'

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
  return { root, request: path.join(root, 'request.json'), capabilities, resources: path.join(root, 'resources'),
    candidateHelper: path.join(capabilities, 'candidate-helper.mjs'),
    mediaDelivery: candidateMediaDeliveryAccess(root),
    discovery: path.join(capabilities, 'discovery.json'), query: path.join(capabilities, 'query.mjs'),
    skills: Object.fromEntries(courseAgentAvailableSkills.map(skill => [skill.name, path.join(capabilities, 'skills', skill.name, 'SKILL.md')])),
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
    for (const background of Array.isArray(rows.backgrounds) ? rows.backgrounds : []) {
      add(record(record(background).fields).backgroundAssetId)
      add(record(record(background).effective).assetId)
    }
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

/** A bounded view of the same frozen inventory for explicit existing-image reuse.
 * Page references alone cannot identify an unused asset requested by the teacher. */
function initialReusableImageAssets(request: GenerationRequest, context: Record<string, unknown>, aliases: Record<string, string>) {
  const capabilities = context.capabilities as { toolIds?: unknown } | undefined
  const imageCapability = Array.isArray(capabilities?.toolIds)
    && capabilities.toolIds.some(id => ['media.apply', 'asset.media.import', 'owner.background'].includes(id))
  const reuse = /已有|现有|已导入|素材库|课件[里中]|工程[里中]|\b(existing|reuse|already imported|asset library)\b/i.test(request.instruction)
  if (!imageCapability || !reuse) return undefined
  // generationAssetAliases already validated these exact inventory entries.
  const inventory = context.assets as Record<string, AssetMeta>
  const candidates = Object.entries(aliases).filter(([, id]) => inventory[id]!.kind === 'image')
  const assets: Record<string, Pick<AssetMeta, 'filename' | 'kind' | 'mimeType' | 'width' | 'height'>> = {}
  const selectedAliases: Record<string, string> = {}
  for (const [alias, id] of candidates) {
    const { filename, kind, mimeType, width, height } = inventory[id]!
    const summary = { filename, kind, mimeType, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) }
    if (Buffer.byteLength(JSON.stringify({ assets: { ...assets, [id]: summary }, aliases: { ...selectedAliases, [alias]: id } })) > 1_536) continue
    assets[id] = summary
    selectedAliases[alias] = id
  }
  return { assets, aliases: selectedAliases, coverage: { kind: 'image', total: candidates.length,
    included: Object.keys(assets).length, partial: Object.keys(assets).length < candidates.length,
    instruction: '按真实文件名、类型和尺寸核对所需素材，再使用同源assetAliases；页内已引用图片不代表它就是所需素材。摘要不全或不能确认身份时，先读取request.json的context.assets和assetAliases，禁止猜选。' } }
}

/** Initial wire view only. The staged request retains the complete inventories. */
export function generationInitialRequestForPrompt(request: GenerationRequest) {
  const full = generationRequestForPrompt(request)
  const context = full.context && typeof full.context === 'object' && !Array.isArray(full.context)
    ? full.context as Record<string, unknown> : null
  // Sources remain attached to their items and all readable files stay indexed.
  // These inventories duplicate those paths/targets or are read on demand.
  const { assets: _assets, runtimeSources: _runtimeSources, ...initialContext } = context ?? {}
  if (initialContext.navigation && typeof initialContext.navigation === 'object' && !Array.isArray(initialContext.navigation)) {
    const navigation = initialContext.navigation as { current?: unknown; states?: unknown[]; rules?: unknown[] }
    // Keep the concrete step/scene distinction hot when it can affect this page.
    // Full per-state targets and unchanged rules remain in the staged request.
    initialContext.navigation = (navigation.states?.length ?? 0) > 1 || navigation.rules?.length
      ? { current: navigation.current, details: 'request.json context.navigation：当前导航事实优先于旧记忆；完整逐状态目标与未改规则，须核对用户要求。声明目标不等于实际点击证据。' }
      : undefined
  }
  if (Array.isArray(initialContext.pages) && initialContext.modificationScope === 'project' && initialContext.reference !== 'course') {
    initialContext.pages = initialContext.pages.filter((page: any) => page.location?.id === initialContext.focusLocationId)
      .map((page: any) => initialContext.reference === 'selection' ? { ...page, backgrounds: undefined,
        items: page.items?.filter((row: any) => row.selected), blocks: page.blocks?.filter((row: any) => row.selected) } : page)
  }
  // The prompt's native-path guidance already states this instruction verbatim
  // in meaning. Keep all actual capability cards, schemas and references intact.
  // The applicability projection stays in the staged request.json (same-source
  // first-route exclusions); the wire prompt cannot afford its repeated bytes.
  if (initialContext.capabilities && typeof initialContext.capabilities === 'object' && !Array.isArray(initialContext.capabilities)) {
    const { instruction: _capabilityInstruction, applicability: _applicability, ...capabilities } = initialContext.capabilities as Record<string, unknown>
    if (typeof capabilities.semanticVersion === 'string' && Array.isArray(capabilities.cards)) {
      capabilities.cards = capabilities.cards.map(card => {
        if (!card || typeof card !== 'object' || Array.isArray(card) || card.semanticVersion !== capabilities.semanticVersion) return card
        // The surrounding capability set carries this exact shared identity.
        const { semanticVersion: _duplicateVersion, ...contract } = card
        return contract
      })
    }
    if (Array.isArray(capabilities.createRecommendations)) {
      // Creation recommendations repeat full discovery entries for each
      // destination/carrier. Keep the discovered tool identities hot; exact
      // destination indexes, conditions and query entries remain in request.json.
      capabilities.createToolIds = [...new Set(capabilities.createRecommendations.flatMap(recommendation =>
        recommendation && typeof recommendation === 'object' && Array.isArray(recommendation.entries)
          ? recommendation.entries.map((entry: { id: string }) => entry.id) : []))]
      delete capabilities.createRecommendations
    }
    initialContext.capabilities = capabilities
  }
  const { files: _files, ...observationIdentity } = full.observation ?? {}
  const { destinations: _destinations, execution, assetAliases: fullAssetAliases, taskFacts, ...wire } = full
  const referencedAssetIds = initialReferencedAssetIds(initialContext)
  const reusable = initialReusableImageAssets(request, context ?? {}, fullAssetAliases)
  const assetAliases = { ...Object.fromEntries(Object.entries(fullAssetAliases).filter(([, id]) => referencedAssetIds.has(id))), ...reusable?.aliases }
  const focused = new Set((Array.isArray(initialContext.pages) ? initialContext.pages : []).flatMap((page: any) =>
    [...page.items ?? [], ...page.blocks ?? []].map((row: any) => row.target)))
  const focusedOwners = new Set(Object.values(full.destinationAliases).flatMap(d => d.kind === 'update' && focused.has(d.target.authoringAddress) ? [d.target.ownerKey] : []))
  const destinationAliases = initialContext.modificationScope === 'project' && initialContext.reference === 'selection'
    ? Object.fromEntries(Object.entries(full.destinationAliases).filter(([, d]) => d.kind === 'update' ? focused.has(d.target.authoringAddress)
      : d.scope.locationId === initialContext.focusLocationId && focusedOwners.has(d.scope.ownerKey) && d.scope.parent.kind === 'owner' && d.scope.insertion.kind === 'append'))
    : full.destinationAliases
  // The initial view names the existing aliases; the staged request remains the
  // only source of complete revision-bound destinations used by the helper.
  const targetAliases = new Map(Object.entries(destinationAliases).flatMap(([alias, destination]) =>
    destination.kind === 'update' ? [[JSON.stringify(destination.target), alias] as const] : []))
  if (Array.isArray(initialContext.pages)) {
    initialContext.pages = initialContext.pages.map((page: any) => ({ ...page,
      ...(Array.isArray(page.backgrounds) ? { backgrounds: page.backgrounds.map((background: any) => ({ ...background,
        target: targetAliases.get(JSON.stringify(background.target)) ?? background.target,
      })) } : {}),
    }))
  }
  const initialDestinations = Object.fromEntries(Object.entries(destinationAliases).map(([alias, destination]) => {
    if (destination.kind === 'update') return [alias, { kind: destination.kind,
      target: { owner: destination.target.owner, itemId: destination.target.itemId, authoringAddress: destination.target.authoringAddress } }]
    const { projectId: _projectId, documentRevision: _revision, revisionPolicy: _policy,
      sessionGeneration: _generation, ownerKey: _ownerKey, ...scope } = destination.scope
    return [alias, { kind: destination.kind, scope }]
  }))
  const compactFacts = generationTaskFactsPromptProjection(taskFacts,
    target => targetAliases.get(JSON.stringify(target)) ?? target)
  const initial = { ...wire,
    ...(compactFacts ? { taskFacts: compactFacts } : {}),
    destinationAliases: initialDestinations,
    ...(execution ? { deadlineAt: execution.deadlineAt } : {}),
    ...(context ? { context: { ...initialContext, ...(reusable ? { assets: reusable.assets } : {}) } } : {}),
    ...(full.observation ? { observation: observationIdentity } : {}),
    ...(Object.keys(assetAliases).length ? { assetAliases } : {}),
    resourceIndex: full.resourceIndex.filter(file => !['resources/project/document.json', 'resources/project/targets.json'].includes(file.path)).map(({ encoding: _encoding, ...file }) => file),
    requestDetails: { path: 'request.json', fields: ['destinationAliases', 'context.assets', 'assetAliases', 'context.runtimeSources', ...(taskFacts ? ['taskFacts'] : []), ...(initialContext.navigation ? ['context.navigation'] : []), 'observation.files', 'context.capabilities.applicability', 'context.capabilities.createRecommendations'],
      ...(reusable ? { assetInventory: reusable.coverage } : {}) },
  }
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
  const pageId = (page: unknown) => page && typeof page === 'object' && !Array.isArray(page)
    ? Reflect.get(page, 'location') && typeof Reflect.get(page, 'location') === 'object' ? Reflect.get(Reflect.get(page, 'location'), 'id') : undefined : undefined
  const withPageProjection = (pages: readonly unknown[], mode: 'non-current-summary' | 'all-summary') => {
    const context = initial.context && typeof initial.context === 'object' && !Array.isArray(initial.context) ? initial.context as Record<string, unknown> : undefined
    if (!context) return initial
    return { ...initial, context: { ...context, pages,
      pageProjection: { version: 1, mode, inlineLocationId: initialContext.focusLocationId, fullPages: 'resources/project/targets.json',
        omittedLocations: pages.filter(page => { const value = page && typeof page === 'object' && !Array.isArray(page) ? page as Record<string, unknown> : {}; return value.details }).map(page => pageId(page)),
        instruction: mode === 'non-current-summary'
          ? '这是同一 course scope 的紧凑观察。当前活动位置内联完整内容；其他位置为导航摘要。需要完整内容时按 locationId 读取 projectTargets，不把摘要当完整观察。'
          : '这是同一 course scope 的资源化观察。所有位置仅保留导航摘要；需要完整内容时按 locationId 读取 projectTargets，不把摘要当完整观察。' } } }
  }
  if (initialContext.reference === 'course' && initialContext.modificationScope === 'project' && bytes(initial) > MAX_GENERATION_PROMPT_BYTES) {
    const pages = Array.isArray(initialContext.pages) ? initialContext.pages : []
    const compact = withPageProjection(pages.map(page => pageId(page) === initialContext.focusLocationId ? page : compactGenerationPage(page)), 'non-current-summary')
    return bytes(compact) <= MAX_GENERATION_PROMPT_BYTES
      ? compact : withPageProjection(pages.map(compactGenerationPage), 'all-summary')
  }
  return initial
}

/** Native process environment locates the current request without transcribing
 * paths or request IDs. The full staged request retains exact file references. */
export function generationProfileForPrompt(profile: ReturnType<typeof createGenerationProfile>) {
  return { version: profile.version, adapter: profile.adapter, candidateVersion: profile.candidateVersion,
    resultChannel: profile.resultChannel,
    workspace: { rootEnvironment: 'COURSEWARE_CANDIDATE_ROOT', request: profile.workspace.request },
    skills: profile.skills.map(skill => skill.name),
  }
}

export type GenerationPromptPhase = 'initial' | 'host-feedback'

/** Resource bytes and full capability files stay on demand in both phases. */
function buildGenerationPromptUnchecked(adapter: LocalAgentId, request: GenerationRequest, candidateRoot: string, phase: GenerationPromptPhase): string {
  const profile = createGenerationProfile(adapter, request, undefined, candidateRoot)
  const capabilityContext = request.context && typeof request.context === 'object' && !Array.isArray(request.context)
    ? Reflect.get(request.context, 'capabilities') : undefined
  const relevantTools = capabilityContext && typeof capabilityContext === 'object' && !Array.isArray(capabilityContext)
    ? capabilityContext.toolIds : undefined
  const mayApplyImage = Array.isArray(relevantTools) && relevantTools.includes('media.apply')
  const channel = profile.resultChannel
  const terminal = (kind: 'answer' | 'edit') => `${GENERATION_RESULT_OPEN}${JSON.stringify({ version: 1, requestId: request.requestId, kind })}${GENERATION_RESULT_CLOSE}`
  const output = channel === 'session-staging-file'
    ? `draft.json={summary,steps,afterCommit}。交付只调用一次 node <fileAccess.candidateHelper> --request <request.json> --input <draft.json>；不加--check会预检并写candidate.json，返回status:ready-for-host/delivery:ready-for-host/candidateFile:candidate.json；仅检查才加--check，返回status:prechecked/delivery:not-delivered且不写文件；禁止同一草稿先check再生成。仅宿主committed/unchanged才算应用。勿手抄路径/UUID/base64。候选附${terminal('edit')}；无候选用answer。`
    : channel === 'app-server-json-schema'
      ? 'final_answer按outputSchema：编辑kind=edit/reply=null。多步写本轮candidate.json并检查：helper生成的完整version=1保持原样；手写version=2使用本轮destination别名字符串，不写carrier，step.input为对象。不得只改version混用两种步骤格式；预检拒绝后须修正再交付。candidate只交{version:1,requestId:本轮ID,candidateFile:"candidate.json"}。小候选直接交candidate，step.input用JSON字符串。答复kind=reply/reply=文本/candidate=null。'
      : `候选只在最终正文用 ${GENERATION_OPEN}JSON${GENERATION_CLOSE} 交付，写 candidate.json 不算交付。没有新候选（含宿主提交后的完成确认）直接自然语言回复。`
  return [
    publicCourseReplyGuidance,
    phase === 'host-feedback'
      ? `这是同一任务的宿主反馈与目标核对阶段，不是重新执行原请求。以正式回执和当前观察核对原目标；已完成则直接答复，只有尚未完成的具体差距才提交下一阶段候选。“再放大一点”等相对修改不得因收到新观察再次累计执行。request.json.reusableArtifacts 可复用上轮文件成果，须核对当前基线后修正。${generationRepairFeedbackGuidance}`
      : request.intent === 'plan'
      ? '本轮只读计划：基于当前范围给出可执行方案，不改课件；仅缺少决定核心目标的信息时提问。'
      : request.intent === 'discuss' ? '本轮只读讨论，禁止修改候选。'
      : request.intent === 'edit' || profile.resultContract.mode === 'candidate' ? '修改先用实际能力准备有效候选；禁空steps、虚构操作和诊断候选。' : '本轮可讨论或编辑指定范围，按实际结果回复或交候选。',
    '仅经候选事务修改，禁直写Store/History/工程。需提问时用原生工具等待。',
    'Keep cwd/permissions. request is absolute; query/helper=fileAccess.',
    'CLI工具保持开放。asset.image.transform只做卡中像素操作，禁semantic-redraw。',
    output,
    ...(profile.resultContract.mode === 'reply-or-edit' ? ['受阻或无法合法修正则答复未完成；禁诊断候选。'] : []),
    ...(!request.intent || request.intent === 'edit' ? [
    'v2: requestId/summary/afterCommit/steps; step=id/tool/destination/input. d1 etc: destinationAliases. Selection is focus, not permission; preserve other content.',
    ...((request.context as any)?.componentSources?.length ? ['组件源码：先读 context.componentSources。node <fileAccess.candidateHelper> --request <fileAccess.request> --component-target <实例别名> --work-dir <fileAccess.root>/component-work --init；编辑副本后去掉 --init，加 --summary <修改>，需验证加 --observe <检查事项>。helper 自动封装基线/补丁，不手抄 hash 或内联源码。能力/历史按需读取。'] : []),
    'Use supplied cards; host fills IDs/defaults. Query insert with --nativeType. Fallback: read document.json via resourceIndex.localPath; keep id/revision/editability; write {document:V9} to fileAccess.root/resources/result.json; project.document input={artifact:{$candidateFile:"resources/result.json"}}, any current alias.',
    'afterCommit={version:1,action:"finish"}结束；需验证用{version:1,action:"observe",reason:"具体检查"}。勿为总结续轮。',
    '已有资产{"$asset":"a1"}见assetAliases/request.json；前序用{"$result":{"stepId":"s1","kind":"asset-id","index":0}}。kind还可package-id/item-id/location-id，禁猜ID。',
    ...(request.destinations.some(destination => destination.kind === 'create') ? [
      'Created destination={kind:"created-item",stepId:"s1",index:0}; new page content={kind:"created-scope",stepId:"s1",parent:{kind:"owner"},insertion:{kind:"append"}}; new page background={kind:"created-background",stepId:"s1"}. Flow body parent={kind:"flow-body",parentBlockId:null}. Combine replacement+insertion freely. Images:media.apply; dynamic:read runtime-api2/3 or component-api4.',
    ] : []),
    '用户要求纹理、布局、动画或按钮行为时，查看相应实际图面/操作证据再宣布完成；仅有 smoke 不证明效果正确。观察后只修具体差距，不为总结续轮。',
    ...courseAgentTaskGuidance(request),
    ...(mayApplyImage ? [candidateMediaFileGuidance] : []),
    ] : ['本轮只读，按当前事实答复，不生成候选。']),
    JSON.stringify({ profile: generationProfileForPrompt(profile) }),
    JSON.stringify(generationInitialRequestForPrompt(request)),
  ].join('\n')
}

function pageProjectionRequest(request: GenerationRequest, mode: 'non-current-summary' | 'all-summary'): GenerationRequest | undefined {
  const context = request.context && typeof request.context === 'object' && !Array.isArray(request.context) ? request.context as Record<string, unknown> : undefined
  if (!context || context.reference !== 'course' || context.modificationScope !== 'project' || !Array.isArray(context.pages)) return undefined
  const pageId = (page: unknown) => page && typeof page === 'object' && !Array.isArray(page)
    ? Reflect.get(page, 'location') && typeof Reflect.get(page, 'location') === 'object' ? Reflect.get(Reflect.get(page, 'location'), 'id') : undefined : undefined
  // Optional summary labels are omitted on the JSON wire. Normalize that
  // projection before validating it as JSON context, rather than introducing
  // undefined properties into an otherwise valid frozen request.
  const pages = context.pages.map(page => mode === 'non-current-summary' && pageId(page) === context.focusLocationId
    ? page : JSON.parse(JSON.stringify(compactGenerationPage(page))))
  return generationRequestSchema.parse({ ...request, context: { ...context, pages,
    pageProjection: { version: 1, mode, inlineLocationId: context.focusLocationId, fullPages: 'resources/project/targets.json',
      omittedLocations: pages.filter(page => page && typeof page === 'object' && !Array.isArray(page) && Reflect.has(page, 'details')).map(page => pageId(page)),
      instruction: mode === 'non-current-summary'
        ? '这是同一 course scope 的紧凑观察。当前活动位置内联完整内容；其他位置为导航摘要。需要完整内容时按 locationId 读取 projectTargets，不把摘要当完整观察。'
        : '这是同一 course scope 的资源化观察。所有位置仅保留导航摘要；需要完整内容时按 locationId 读取 projectTargets，不把摘要当完整观察。' } } })
}

/** Measure the fully wrapped native prompt. If fixed guidance plus the final
 * request projection still exceeds the send budget, compact the course pages
 * again before returning; the harness remains the final rejection boundary. */
export function buildGenerationPrompt(adapter: LocalAgentId, request: GenerationRequest, candidateRoot: string, phase: GenerationPromptPhase = 'initial', maxBytes = MAX_GENERATION_PROMPT_BYTES): string {
  const prompt = buildGenerationPromptUnchecked(adapter, request, candidateRoot, phase)
  if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) return prompt
  const nonCurrent = pageProjectionRequest(request, 'non-current-summary')
  if (nonCurrent) {
    const projected = buildGenerationPromptUnchecked(adapter, nonCurrent, candidateRoot, phase)
    if (Buffer.byteLength(projected, 'utf8') <= maxBytes) return projected
    const allSummary = pageProjectionRequest(request, 'all-summary')
    if (allSummary) return buildGenerationPromptUnchecked(adapter, allSummary, candidateRoot, phase)
  }
  return prompt
}

export function createGenerationProfile(adapter: LocalAgentId, request: GenerationRequest,
  resultChannel = adapter === 'codex' ? 'app-server-json-schema' : 'session-staging-file',
  candidateRoot?: string) {
  if (!['structured-stdout', 'session-staging-file', 'app-server-json-schema'].includes(resultChannel)) throw new Error('当前 CLI profile 未开放此候选结果通道')
  if (resultChannel === 'session-staging-file' && adapter === 'codex') throw new Error('当前 CLI 不支持会话暂存候选通道')
  if (resultChannel === 'app-server-json-schema' && adapter !== 'codex') throw new Error('当前 CLI 不支持 app-server 结构化候选通道')
  // Complete methods are optional resources, not a prerequisite. The profile
  // still delivers every exact path so a native CLI can consult one only when
  // the supplied snapshot, target range, and capability contract need it.
  const names = request.purpose === 'whole-course'
    ? ['courseware-session', 'orchestrate-courseware', 'build-courseware-project', 'course-build', 'visual-craft', 'interaction-craft']
    : ['courseware-session', 'orchestrate-courseware', 'build-courseware-project', 'course-design', 'pro-editing', 'qa-repair', 'style-remix', 'visual-craft', 'interaction-craft']
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
    taskInstruction: '先使用本轮最小快照、目标范围与完整能力卡；三者足够时直接生成，不必读取 courseware-session 或其他课件方法。普通 Markdown 的局部改字、改写或选区修订不需要课件方法。只有当前任务确实需要材料理解、教学主线、呈现脚本、构建、课件修改、视觉互动检查或交付方法时，才按需读取 courseware-session、orchestrate-courseware、build-courseware-project 或精确能力卡及其必要引用。软件内自动任务不强制四阶段；用户明确要求先审当前真实制品时才停下。完整方法仅作质量参考，不执行其外部安装、resolve-editor-root 或独立 Builder 命令。缺少能力、技能方法或源码时读取 request.json 的 fileAccess 与 resourceIndex.localPath，直接使用绝对路径；参数修改无需先读组件源码。原生文件、终端、网络及子任务能力仍由 CLI 提供，课件修改经宿主候选事务提交。',
    skills: courseAgentAvailableSkills.filter(skill => names.includes(skill.name)).map(skill => ({ name: skill.name,
      summary: courseAgentSkillSummary(skill), path: fileAccess.skills[skill.name]! })),
  }
}
