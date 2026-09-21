/**
 * 发布物 AI 记录 / 凭据边界扫描（r20-022、r20-060 共用）。
 *
 * 022 与 060 依赖同一件事：AI 的消息、trace、凭据不得进入 `.h5lesson`、
 * Published payload 与导出 HTML。2026-09-21 的评审记录
 * （`docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md:85`）
 * 明确写着该边界此前没有任何自动化检查，仓库里只有一次人工扫描结论。
 * 本模块把那次人工扫描变成可重复执行的规则集。
 *
 * ## 扫描目标为什么选在这里（读源码确认，不是推测）
 *
 * 应用记录与凭据只存在于 `app.getPath('userData')` 之下，没有任何一处写进工程：
 *
 * - `src/main/localAgent/repository.ts:68-70` — 记录根
 *   `userData/local-agent/v3/<sha256(workspaceIdentityKey)>`；`:213` 记录文件
 *   `<recordId>.json`，`:197/202` `<recordId>.display.json`，
 *   `:41/53-57` 非秘密 CLI 偏好 `local-agent/preferences/v1/<adapter>.json`（`mode: 0o600`）。
 * - `src/main/localAgent/lessonConversationRepository.ts:23-25` — 会话元数据
 *   `lesson-conversations/v1/<lessonId>`、`workspace-conversations|project-conversations/v1/<hash>`；
 *   `:28` 归属索引 `conversation-index-v1.json`；`:60/212` 遍历这三个叶子目录。
 * - `src/main/lessonDocumentDesktopService.ts:13` — 恢复稿 `lesson-document-recovery/v1`；
 *   `src/main/flowDocumentRecovery.ts:62` — `flow-document-recovery/v1`；
 *   `src/main/projectPersistence.ts:47` — `project-data/`（含 `recovery.h5lesson`）。
 * - `src/main/diagnosticLog.ts:45,49` — 诊断日志 `diagnostics/editor-diagnostics.jsonl`
 *   与 `editor-diagnostics.previous.jsonl`。
 * - 长期 Provider Secret 由 CLI 自己保管：本次实测
 *   `rg 'safeStorage|apiKey|providerSecret|api_key' src/main/localAgent` **零命中**，
 *   `docs/development-plan/ARCHITECTURE_CONTRACT.md:66` 要求「长期 Provider Secret
 *   不得持久化或写入 Published/导出物」。
 *
 * 因此只要工程 / Published / 导出 HTML / 组件包中出现上述任一存储形态、
 * 任一事件信封字段或任一凭据形态，就说明边界被穿透。
 *
 * ## 本检查能证明与不能证明什么
 *
 * 能证明：产物字节里不出现 AI 记录信封（`conversationId`/`sessionIds`/
 * `workingDirectoryId`/`externalSessionId`/`adapter`/`kind:"user-message"` 等）、
 * 诊断日志形态、已知凭据形态、本机个人路径。
 *
 * 不能证明：任意自然语言消息正文不出现在产物里 —— 一段普通中文散文没有任何
 * 可判别的形态，模式匹配做不到。这里检测的是「消息被以应用记录的形式带出」，
 * 不是「这段文字恰好也出现在聊天里」。该限制在测试与交付说明中如实标注。
 *
 * ## 打包产物（app.asar / win-unpacked）为什么必须单独扫
 *
 * 源码树里的 6 个产物不等于发布物：真正发给用户的是 `release/` 下的
 * `win-unpacked/resources/app.asar` 与 portable 单文件。asar 不是压缩格式
 * （JSON 头 + 顺序拼接的条目体），明文在原始字节里确实可见，所以「按原始字节
 * 当纯文本扫」看起来够用，但它会丢掉两样东西：条目归属（出问题的是哪一条文件）
 * 与 `unpacked` 条目（内容根本不在 asar 里，而在 `<asar>.unpacked/` 下）。
 * 因此 asar 走 `getRawHeader` 枚举条目后逐条扫描，而不是整包文本扫描。
 *
 * 覆盖范围刻意限定在 `win-unpacked/resources/**`（应用自身负载）。Electron /
 * Chromium 运行时文件不扫：2026-09-22 实测，用本文件这套规则扫
 * `node_modules/electron/dist` 的 75 个文件（347.3 MB）会在 `electron.exe`
 * 上命中 5 处 `credential.aws-access-key-id` —— 那是 Chromium 自带的 AWS
 * 文档示例串，整树无例外扫描会把发布验证误判成失败，而放宽该规则会削弱规则。
 *
 * portable 单文件不在覆盖范围内：electron-builder 的 portable 目标用 NSIS +
 * `SetCompressor zlib` 打包（`app-builder-lib/out/targets/nsis/NsisTarget.js:267`），
 * 应用负载在 exe 里是压缩态，对它的原始字节做文本扫描只能看到自解压外壳。
 * 本仓库没有 `release/`，这条只能证明到 engineering candidate。
 *
 * 自动化最多证明 engineering candidate，不构成 accepted。
 */
import { getRawHeader } from '@electron/asar'
import { promises as fs, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'

export type ReleaseArtifactBoundaryCategory =
  | 'conversation-record'
  | 'trace'
  | 'credential'
  | 'personal-path'

export interface ReleaseArtifactBoundaryRule {
  readonly id: string
  readonly category: ReleaseArtifactBoundaryCategory
  readonly description: string
  /** 必须带 `g` 标志；`scanReleaseArtifactText` 用 `matchAll` 统计全部命中。 */
  readonly pattern: RegExp
}

/** 归档内条目名的扫描位置标记。 */
export type ReleaseArtifactBoundaryLocation =
  | 'entry-name'
  | 'entry-content'
  | 'entry-link'
  | 'payload'

export interface ReleaseArtifactBoundaryFinding {
  /** 人类可读的产物标签，通常是绝对路径或内存生成物的名字。 */
  readonly artifact: string
  /** 归档内条目名；非归档产物为 `<payload>`。 */
  readonly entry: string
  readonly location: ReleaseArtifactBoundaryLocation
  readonly ruleId: string
  readonly category: ReleaseArtifactBoundaryCategory
  /** 该规则在这段文本里的命中总数。 */
  readonly occurrences: number
  /** 首个命中的字符偏移。 */
  readonly offset: number
  /** 已脱敏的命中片段，可以安全地打进日志与错误消息。 */
  readonly excerpt: string
}

export const RELEASE_ARTIFACT_PAYLOAD_ENTRY = '<payload>'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

/** 仓库根目录，由本文件位置推导，不写死盘符。 */
export const releaseArtifactRepositoryRoot = path.resolve(scriptDirectory, '..')

const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
/**
 * 单个文件/归档的读取上限。超过就抛错拒绝放行，绝不跳过 —— 跳过等于把没看过的
 * 内容判成干净。512 MiB 是实测值之上的余量：Electron 43.1.1 的 `electron.exe`
 * 是 215.0 MB，发布树里最大的文件就是它，而它不在扫描范围内（见文件头说明）。
 */
const MAX_ARTIFACT_FILE_BYTES = 512 * 1024 * 1024
/** 每条规则在每个文本里最多保留多少个命中摘要；计数仍然是全部命中。 */
const MAX_RETAINED_MATCHES_PER_RULE = 20

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * 把一条本机绝对路径编译成同时匹配 `\` 与 `/`、并容忍 JSON 里双反斜杠的
 * 正则源：`C:\Users\x` 在 JSON 字符串里是 `C:\\Users\\x`，两种都必须命中。
 */
export function absolutePathPatternSource(value: string): string {
  return value
    .split(/[\\/]/u)
    .map((segment) => escapeRegExp(segment))
    .join('[\\\\/]{1,2}')
}

function machinePathRules(): ReleaseArtifactBoundaryRule[] {
  const home = os.homedir()
  const sources: { id: string; description: string; source: string }[] = [
    {
      id: 'personal-path.repository-root',
      description: `本机仓库绝对路径（${releaseArtifactRepositoryRoot}）`,
      source: absolutePathPatternSource(releaseArtifactRepositoryRoot),
    },
  ]
  if (home) {
    sources.push({
      id: 'personal-path.home-directory',
      description: `本机用户主目录（${home}）`,
      source: absolutePathPatternSource(home),
    })
  }
  return sources.map(({ id, description, source }) => ({
    id,
    category: 'personal-path' as const,
    description,
    pattern: new RegExp(source, 'gu'),
  }))
}

/**
 * 规则集。凭据与个人路径部分按「宁可漏报形态、不可误报代码」取舍：
 * 未加引号的 `key=value` 要求 12 字符以上的凭据字符集，因为压缩后的
 * 前端代码里 `token:Symbol(...)`、`secret:e.target.value` 这类表达式
 * 会命中宽松写法（在冻结的 3.8MB 基准 HTML 上实测过，见
 * `tests/unit/releaseArtifactBoundary.test.ts` 的精确性用例）。
 */
export const RELEASE_ARTIFACT_BOUNDARY_RULES: readonly ReleaseArtifactBoundaryRule[] = [
  // ---- 应用对话记录 -------------------------------------------------------
  {
    id: 'conversation.record-field',
    category: 'conversation-record',
    description: '应用会话记录字段 conversationId',
    pattern: /"conversationId"\s*:/gu,
  },
  {
    id: 'conversation.session-ids-field',
    category: 'conversation-record',
    description: '应用会话记录字段 sessionIds',
    pattern: /"sessionIds"\s*:\s*\[/gu,
  },
  {
    id: 'conversation.agent-record-field',
    category: 'conversation-record',
    description: '本地 AI 记录字段 workingDirectoryId / externalSessionId',
    pattern: /"(?:workingDirectoryId|externalSessionId)"\s*:/gu,
  },
  {
    id: 'conversation.agent-record-adapter',
    category: 'conversation-record',
    description: '本地 AI 记录字段 adapter 取值为 CLI 标识',
    pattern: /"adapter"\s*:\s*"(?:codex|claude|opencode)"/gu,
  },
  {
    id: 'conversation.user-message-event',
    category: 'conversation-record',
    description: '本地 AI 事件 kind:"user-message"（消息正文信封）',
    pattern: /"kind"\s*:\s*"user-message"/gu,
  },
  {
    id: 'conversation.input-delivery-event',
    category: 'conversation-record',
    description: '本地 AI 事件 kind:"input-delivery"',
    pattern: /"kind"\s*:\s*"input-delivery"/gu,
  },
  {
    id: 'conversation.question-event',
    category: 'conversation-record',
    description: '本地 AI 事件 kind:"question"',
    pattern: /"kind"\s*:\s*"question"/gu,
  },

  // ---- trace / 诊断日志 ---------------------------------------------------
  {
    id: 'trace.turn-ended-event',
    category: 'trace',
    description: '本地 AI 事件 kind:"turn-ended"（回合 trace）',
    pattern: /"kind"\s*:\s*"turn-ended"/gu,
  },
  {
    id: 'trace.observation-field',
    category: 'trace',
    description: '本地 AI 观察标识 observationId',
    pattern: /"observationId"\s*:\s*"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"/gu,
  },
  {
    id: 'trace.host-results-field',
    category: 'trace',
    description: '本地 AI 宿主回执字段 hostResults',
    pattern: /"hostResults"\s*:\s*\[/gu,
  },
  {
    id: 'trace.agent-record-store',
    category: 'trace',
    description: '应用记录目录 local-agent/v3',
    pattern: /local-agent[\\/]{1,2}v3/gu,
  },
  {
    id: 'trace.conversation-store',
    category: 'trace',
    description: '应用会话目录 lesson|workspace|project-conversations/v1',
    pattern: /(?:lesson|workspace|project)-conversations[\\/]{1,2}v1/gu,
  },
  {
    id: 'trace.conversation-index',
    category: 'trace',
    description: '应用会话归属索引 conversation-index-v1.json',
    pattern: /conversation-index-v1\.json/gu,
  },
  {
    id: 'trace.document-recovery-store',
    category: 'trace',
    description: '恢复稿目录 lesson|flow-document-recovery/v1',
    pattern: /(?:lesson|flow)-document-recovery[\\/]{1,2}v1/gu,
  },
  {
    id: 'trace.project-data-store',
    category: 'trace',
    description: '工程恢复目录 project-data/',
    pattern: /(?:^|[^A-Za-z0-9_])project-data[\\/]/gmu,
  },
  {
    id: 'trace.diagnostic-log-file',
    category: 'trace',
    description: '诊断日志文件名 editor-diagnostics*.jsonl',
    pattern: /editor-diagnostics(?:\.previous)?\.jsonl/gu,
  },
  {
    id: 'trace.diagnostic-entry',
    category: 'trace',
    description: '诊断日志 JSONL 条目形态（timestamp + source）',
    pattern: /\{"timestamp":"[^"]{1,40}","source":"(?:main|renderer|preview|component)"/gu,
  },
  {
    id: 'trace.diagnostic-report',
    category: 'trace',
    description: '诊断报告标题与生成时间头',
    pattern: /诊断报告\r?\n生成时间：/gu,
  },

  // ---- 凭据形态 -----------------------------------------------------------
  {
    id: 'credential.openai-api-key',
    category: 'credential',
    description: 'OpenAI 形态密钥（sk- 前缀）',
    // 前导边界不能省：没有它，`r17-040-risk-preview-single-repair` 这类标识符里的
    // `sk-preview-single-repair` 会被当成密钥。真实密钥是独立 token，前面只会是
    // 串首、空白、引号或 `=:` 之类分隔符，不会是字母数字。
    pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/gu,
  },
  {
    id: 'credential.aws-access-key-id',
    category: 'credential',
    description: 'AWS Access Key ID（AKIA 前缀）',
    pattern: /AKIA[0-9A-Z]{16}/gu,
  },
  {
    id: 'credential.github-token',
    category: 'credential',
    description: 'GitHub token（ghp_/gho_/ghu_/ghs_/ghr_ 前缀）',
    pattern: /gh[pousr]_[A-Za-z0-9]{20,}/gu,
  },
  {
    id: 'credential.slack-token',
    category: 'credential',
    description: 'Slack token（xox[baprs]- 前缀）',
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/gu,
  },
  {
    id: 'credential.private-key-block',
    category: 'credential',
    description: 'PEM 私钥块（BEGIN ... PRIVATE KEY）',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  },
  {
    id: 'credential.quoted-assignment',
    category: 'credential',
    description: '带引号的密钥赋值（api_key/password/secret 等）',
    pattern: /["']?(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|secret)["']?\s*[:=]\s*(?:"[^"\n]{6,}"|'[^'\n]{6,}')/giu,
  },
  {
    id: 'credential.unquoted-assignment',
    category: 'credential',
    description: '不带引号的密钥赋值（api_key=/password=/secret= 等，值至少 12 字符）',
    pattern: /["']?(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|secret)["']?=[A-Za-z0-9_\-+/=]{12,}/giu,
  },
  {
    id: 'credential.bearer-header',
    category: 'credential',
    description: 'Bearer 授权头',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/giu,
  },

  // ---- 本机个人路径 -------------------------------------------------------
  {
    id: 'personal-path.windows-user-profile',
    category: 'personal-path',
    description: 'Windows 用户目录 C:\\Users\\<name>',
    pattern: /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[^\\/"'\s<>|]{1,64}/gu,
  },
  {
    id: 'personal-path.macos-user-profile',
    category: 'personal-path',
    description: 'macOS 用户目录 /Users/<name>',
    pattern: /\/Users\/[^\/"'\\\s<>|]{1,64}/gu,
  },
  {
    id: 'personal-path.documents-directory',
    category: 'personal-path',
    description: '个人文档目录 Documents\\',
    // 必须带路径上下文（盘符或前导分隔符）：裸 `Documents/` 会命中正常说明文字
    // （例如「用户 Documents/Desktop 的直接子项目」），把发布边界变成误报源，
    // 进而诱使后来者放宽规则。这里的两种形态覆盖 Windows 与类 Unix 写法。
    pattern: /(?:[A-Za-z]:[\\/]{1,2}|\/|\\{1,2})Documents[\\/]{1,2}[^\\/"'\s<>|]{1,64}/gu,
  },
  ...machinePathRules(),
]

/**
 * 命中片段脱敏：只保留前 3 个字符与总长度，错误消息与日志可以安全打印。
 */
export function maskReleaseArtifactBoundaryExcerpt(value: string): string {
  const flattened = value.replace(/\s+/gu, ' ')
  if (flattened.length <= 3) return `${'*'.repeat(flattened.length)}（${flattened.length} 字符）`
  return `${flattened.slice(0, 3)}…（${flattened.length} 字符）`
}

export interface ReleaseArtifactBoundaryTarget {
  readonly artifact: string
  readonly entry?: string
  readonly location?: ReleaseArtifactBoundaryLocation
}

export function scanReleaseArtifactText(
  text: string,
  target: ReleaseArtifactBoundaryTarget,
  rules: readonly ReleaseArtifactBoundaryRule[] = RELEASE_ARTIFACT_BOUNDARY_RULES,
): ReleaseArtifactBoundaryFinding[] {
  const findings: ReleaseArtifactBoundaryFinding[] = []
  for (const rule of rules) {
    if (!rule.pattern.global) {
      throw new Error(`发布物边界规则 ${rule.id} 缺少 g 标志，无法统计全部命中`)
    }
    let occurrences = 0
    let firstOffset = 0
    let firstExcerpt = ''
    for (const match of text.matchAll(rule.pattern)) {
      occurrences += 1
      if (occurrences > MAX_RETAINED_MATCHES_PER_RULE) continue
      if (occurrences === 1) {
        firstOffset = match.index ?? 0
        firstExcerpt = maskReleaseArtifactBoundaryExcerpt(match[0])
      }
    }
    if (occurrences === 0) continue
    findings.push({
      artifact: target.artifact,
      entry: target.entry ?? RELEASE_ARTIFACT_PAYLOAD_ENTRY,
      location: target.location ?? 'payload',
      ruleId: rule.id,
      category: rule.category,
      occurrences,
      offset: firstOffset,
      excerpt: firstExcerpt,
    })
  }
  return findings
}

function decodeArtifactText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/**
 * 除 UTF-8 外再按 UTF-16LE 解一遍。
 *
 * 只解 UTF-8 会漏掉 UTF-16 编码的产物：此时 ASCII 明文是「字符 + 0x00」交错的
 * 字节，UTF-8 解码得到的是夹杂 NUL 的字符串，凭据规则一律不匹配。按原始字节直接
 * 扫描也无效（同样有交错的 NUL）。两个方向都扫，同一规则取命中数较多的一侧。
 */
function decodeArtifactTexts(bytes: Uint8Array): string[] {
  const utf8 = decodeArtifactText(bytes)
  const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(bytes)
  return utf16 === utf8 ? [utf8] : [utf8, utf16]
}

/**
 * 合并同一目标下多次解码的命中：按规则取 occurrences 较大的一次，
 * 避免同一处内容因两种解码都命中而被计两次。
 */
function mergeReleaseArtifactBoundaryFindings(
  groups: readonly ReleaseArtifactBoundaryFinding[][],
): ReleaseArtifactBoundaryFinding[] {
  const merged = new Map<string, ReleaseArtifactBoundaryFinding>()
  for (const group of groups) {
    for (const finding of group) {
      const key = `${finding.entry}\u0000${finding.location}\u0000${finding.ruleId}`
      const existing = merged.get(key)
      if (!existing || finding.occurrences > existing.occurrences) merged.set(key, finding)
    }
  }
  return [...merged.values()]
}

/**
 * 与 `src/main/projectPersistence.ts:71 hasZipSignature` 同形：
 * `.h5lesson` / `.h5component` 是 ZIP，压缩条目里的凭据必须解压后才能命中。
 */
export function hasReleaseArtifactZipSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
}

export function scanReleaseArtifactBytes(
  bytes: Uint8Array,
  target: ReleaseArtifactBoundaryTarget,
  rules: readonly ReleaseArtifactBoundaryRule[] = RELEASE_ARTIFACT_BOUNDARY_RULES,
): ReleaseArtifactBoundaryFinding[] {
  const entry = target.entry ?? RELEASE_ARTIFACT_PAYLOAD_ENTRY
  if (!hasReleaseArtifactZipSignature(bytes)) {
    return mergeReleaseArtifactBoundaryFindings(decodeArtifactTexts(bytes).map(text => scanReleaseArtifactText(
      text,
      { ...target, entry, location: target.location ?? 'payload' },
      rules,
    )))
  }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (cause) {
    // 带 ZIP 签名却解不开：压缩流里的内容无法用文本扫描替代——deflate 之后明文
    // 在原始字节里不可见（见 releaseArtifactBoundary.test.ts 的截断样本）。退回整包
    // 文本扫描会把这个产物判成干净，也就是静默放行，所以这里必须失败关闭。
    throw new Error(
      `${target.artifact} 带 ZIP 签名但无法解压` +
        `（${cause instanceof Error ? cause.message : String(cause)}）：` +
        '拒绝退回文本扫描放行，压缩条目内容无法在不加压的情况下检查',
    )
  }
  const findings: ReleaseArtifactBoundaryFinding[] = []
  let uncompressedBytes = 0
  for (const [name, data] of Object.entries(entries)) {
    uncompressedBytes += data.byteLength
    if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error(
        `${target.artifact} 解压后超过 ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} 字节安全上限，` +
          '拒绝跳过剩余条目（跳过等于放行）',
      )
    }
    findings.push(...scanReleaseArtifactText(
      name,
      { artifact: target.artifact, entry: name, location: 'entry-name' },
      rules,
    ))
    findings.push(...mergeReleaseArtifactBoundaryFindings(decodeArtifactTexts(data).map(text => scanReleaseArtifactText(
      text,
      { artifact: target.artifact, entry: name, location: 'entry-content' },
      rules,
    ))))
  }
  return findings
}

export function formatReleaseArtifactBoundaryFindings(
  findings: readonly ReleaseArtifactBoundaryFinding[],
  label: string,
): string {
  const lines = findings.map((finding) =>
    `  - [${finding.category}/${finding.ruleId}] ${finding.entry}（${finding.location}）` +
    `@${finding.offset} ×${finding.occurrences}：${finding.excerpt}`,
  )
  return `${label} 发现 ${findings.length} 处应用记录/凭据边界违规：\n${lines.join('\n')}`
}

export function assertReleaseArtifactBoundaryClean(
  findings: readonly ReleaseArtifactBoundaryFinding[],
  label: string,
): void {
  if (findings.length === 0) return
  throw new Error(formatReleaseArtifactBoundaryFindings(findings, label))
}

export async function scanReleaseArtifactFile(
  filePath: string,
  label: string = filePath,
  rules: readonly ReleaseArtifactBoundaryRule[] = RELEASE_ARTIFACT_BOUNDARY_RULES,
): Promise<ReleaseArtifactBoundaryFinding[]> {
  const bytes = new Uint8Array(await fs.readFile(filePath))
  return scanReleaseArtifactBytes(bytes, { artifact: label }, rules)
}

export async function assertReleaseArtifactFileClean(
  filePath: string,
  label: string = filePath,
): Promise<void> {
  assertReleaseArtifactBoundaryClean(
    await scanReleaseArtifactFile(filePath, label),
    label,
  )
}

/** 一次扫描覆盖了多少内容；用来证明扫描非空转，而不是只报「0 命中」。 */
export interface ReleaseArtifactScanCoverage {
  /** 逐字节扫描的普通文件数（含按 ZIP 签名解压的归档本身）。 */
  readonly files: number
  /** 逐条目扫描的 asar 归档数。 */
  readonly archives: number
  /** asar 条目总数。 */
  readonly entries: number
  /** 实际检查过的内容字节数（普通文件字节 + asar 条目字节）。 */
  readonly bytes: number
}

export interface ReleaseArtifactScanResult {
  readonly findings: readonly ReleaseArtifactBoundaryFinding[]
  readonly coverage: ReleaseArtifactScanCoverage
}

/**
 * asar 归档的固定前缀：8 字节 pickle 长度字段（4 字节声明 + 4 字节 headerSize），
 * 之后 headerSize 字节的头部 pickle，条目体从 `8 + headerSize` 起顺序拼接。
 * 与 `@electron/asar/lib/disk.js:184` 的 `8 + headerSize + offset` 同一算式。
 */
const ASAR_HEADER_PREFIX_BYTES = 8

export interface ReleaseArtifactAsarEntry {
  /** 归档内相对路径，`/` 分隔。 */
  readonly name: string
  /** `unpacked` 条目的内容不在 asar 里，而在 `<asar>.unpacked/` 下。 */
  readonly kind: 'file' | 'unpacked' | 'link'
  /** `link` 条目为空。 */
  readonly bytes: Uint8Array
  /** 仅 `link` 条目：符号链接目标。 */
  readonly link?: string
}

type RawAsarEntry =
  | { readonly kind: 'file'; readonly name: string; readonly size: number; readonly offset: number }
  | { readonly kind: 'unpacked'; readonly name: string; readonly size: number }
  | { readonly kind: 'link'; readonly name: string; readonly link: string }

/**
 * 解析失败一律抛错（失败关闭）。asar 的头部是产物自带的数据，可能被截断、
 * 被改坏或根本不是 asar；这些情况下「读不出条目」与「条目干净」是两件事，
 * 静默返回空结果就是把没检查过的产物判成干净。
 */
function asarFailure(label: string, detail: string): Error {
  return new Error(
    `${label} 无法按 asar 归档逐条目扫描（${detail}）：拒绝跳过条目检查放行`,
  )
}

function collectRawAsarEntries(
  node: unknown,
  prefix: string,
  inheritedUnpacked: boolean,
  out: RawAsarEntry[],
  label: string,
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw asarFailure(label, `头部节点不是对象：${prefix || '<root>'}`)
  }
  const record = node as Record<string, unknown>
  const files = record.files
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw asarFailure(label, `头部节点缺少 files 目录表：${prefix || '<root>'}`)
  }
  // `@electron/asar/lib/filesystem.js:102-104,144-145` 会把目录的 unpacked
  // 状态继承给子节点，这里必须同样继承，否则子条目会去归档体里取一段不存在
  // 的字节，或者直接取到错的字节。
  const directoryUnpacked = inheritedUnpacked || record.unpacked === true
  for (const [name, child] of Object.entries(files as Record<string, unknown>)) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      throw asarFailure(label, `条目记录不是对象：${name}`)
    }
    if (name.length === 0 || name === '.' || name === '..' || /[\\/]/u.test(name)) {
      throw asarFailure(label, `条目名不是单个路径段：${JSON.stringify(name)}`)
    }
    const full = prefix ? `${prefix}/${name}` : name
    const entry = child as Record<string, unknown>
    if (entry.files !== undefined) {
      collectRawAsarEntries(entry, full, directoryUnpacked, out, label)
      continue
    }
    if (typeof entry.link === 'string') {
      out.push({ kind: 'link', name: full, link: entry.link })
      continue
    }
    const size = entry.size
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw asarFailure(label, `条目 ${full} 的 size 不是非负安全整数`)
    }
    if (directoryUnpacked || entry.unpacked === true) {
      out.push({ kind: 'unpacked', name: full, size })
      continue
    }
    const offset = entry.offset
    if (typeof offset !== 'string' || !/^\d+$/u.test(offset)) {
      throw asarFailure(label, `条目 ${full} 的 offset 不是十进制数字串`)
    }
    out.push({ kind: 'file', name: full, size, offset: Number(offset) })
  }
}

/**
 * 读出 asar 的全部条目内容。条目体按头部声明的 offset/size 从归档里切出来，
 * `unpacked` 条目从 `<asar>.unpacked/` 读；任何一步失败都抛错。
 */
export function readReleaseArtifactAsarEntries(
  asarPath: string,
  label: string = asarPath,
): ReleaseArtifactAsarEntry[] {
  let stats: { size: number }
  try {
    stats = statSync(asarPath)
  } catch (cause) {
    throw asarFailure(
      label,
      `无法读取归档：${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (stats.size > MAX_ARTIFACT_FILE_BYTES) {
    throw asarFailure(
      label,
      `归档 ${stats.size} 字节超过 ${MAX_ARTIFACT_FILE_BYTES} 字节读取上限`,
    )
  }
  let header: { header: unknown; headerSize: number }
  try {
    header = getRawHeader(asarPath)
  } catch (cause) {
    throw asarFailure(
      label,
      `头部解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!Number.isSafeInteger(header.headerSize) || header.headerSize < 0) {
    throw asarFailure(label, `头部长度非法：${String(header.headerSize)}`)
  }
  const raw: RawAsarEntry[] = []
  collectRawAsarEntries(header.header, '', false, raw, label)

  const archive = new Uint8Array(readFileSync(asarPath))
  const contentBase = ASAR_HEADER_PREFIX_BYTES + header.headerSize
  const unpackedRoot = `${asarPath}.unpacked`
  const entries: ReleaseArtifactAsarEntry[] = []
  for (const entry of raw) {
    if (entry.kind === 'link') {
      entries.push({ name: entry.name, kind: 'link', bytes: new Uint8Array(0), link: entry.link })
      continue
    }
    if (entry.kind === 'unpacked') {
      const unpackedPath = path.join(unpackedRoot, ...entry.name.split('/'))
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(readFileSync(unpackedPath))
      } catch (cause) {
        throw asarFailure(
          label,
          `条目 ${entry.name} 标记为 unpacked，但 ${unpackedPath} 读不出来` +
            `（${cause instanceof Error ? cause.message : String(cause)}）`,
        )
      }
      if (bytes.byteLength !== entry.size) {
        throw asarFailure(
          label,
          `unpacked 条目 ${entry.name} 实际 ${bytes.byteLength} 字节，头部声明 ${entry.size} 字节`,
        )
      }
      entries.push({ name: entry.name, kind: 'unpacked', bytes })
      continue
    }
    const start = contentBase + entry.offset
    const end = start + entry.size
    if (end > archive.byteLength) {
      throw asarFailure(
        label,
        `条目 ${entry.name} 声明的 [${start}, ${end}) 超出归档 ${archive.byteLength} 字节`,
      )
    }
    entries.push({ name: entry.name, kind: 'file', bytes: archive.subarray(start, end) })
  }
  return entries
}

/** 逐条目扫描 asar：条目名、条目内容与符号链接目标都过同一套规则。 */
export function scanReleaseArtifactAsar(
  asarPath: string,
  target: ReleaseArtifactBoundaryTarget,
  rules: readonly ReleaseArtifactBoundaryRule[] = RELEASE_ARTIFACT_BOUNDARY_RULES,
): ReleaseArtifactScanResult {
  const entries = readReleaseArtifactAsarEntries(asarPath, target.artifact)
  const findings: ReleaseArtifactBoundaryFinding[] = []
  let bytes = 0
  for (const entry of entries) {
    bytes += entry.bytes.byteLength
    findings.push(...scanReleaseArtifactText(
      entry.name,
      { artifact: target.artifact, entry: entry.name, location: 'entry-name' },
      rules,
    ))
    if (entry.kind === 'link') {
      findings.push(...scanReleaseArtifactText(
        entry.link ?? '',
        { artifact: target.artifact, entry: entry.name, location: 'entry-link' },
        rules,
      ))
      continue
    }
    findings.push(...mergeReleaseArtifactBoundaryFindings(decodeArtifactTexts(entry.bytes).map(text => scanReleaseArtifactText(
      text,
      { artifact: target.artifact, entry: entry.name, location: 'entry-content' },
      rules,
    ))))
  }
  return {
    findings,
    coverage: { files: 0, archives: 1, entries: entries.length, bytes },
  }
}

function emptyCoverage(): {
  files: number
  archives: number
  entries: number
  bytes: number
} {
  return { files: 0, archives: 0, entries: 0, bytes: 0 }
}

async function scanOneReleaseArtifactFile(
  filePath: string,
  rules: readonly ReleaseArtifactBoundaryRule[],
  coverage: { files: number; archives: number; entries: number; bytes: number },
): Promise<ReleaseArtifactBoundaryFinding[]> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) {
    throw new Error(`${filePath} 不是普通文件：拒绝跳过放行`)
  }
  if (stats.size > MAX_ARTIFACT_FILE_BYTES) {
    throw new Error(
      `${filePath} ${stats.size} 字节超过 ${MAX_ARTIFACT_FILE_BYTES} 字节读取上限：` +
        '拒绝跳过未检查的文件放行',
    )
  }
  if (path.extname(filePath).toLowerCase() === '.asar') {
    const result = scanReleaseArtifactAsar(filePath, { artifact: filePath }, rules)
    coverage.archives += result.coverage.archives
    coverage.entries += result.coverage.entries
    coverage.bytes += result.coverage.bytes
    return [...result.findings]
  }
  const bytes = new Uint8Array(await fs.readFile(filePath))
  coverage.files += 1
  coverage.bytes += bytes.byteLength
  return scanReleaseArtifactBytes(bytes, { artifact: filePath }, rules)
}

/**
 * 递归扫描一个目录下的每一个文件。`*.asar` 走条目扫描，其余走字节扫描
 * （带 ZIP 签名的会自行解压）。不设任何跳过规则：目录读不动、遇到非普通
 * 文件、文件超过读取上限，一律抛错而不是放过。
 */
export async function scanReleaseArtifactTree(
  directoryPath: string,
  label: string = directoryPath,
  rules: readonly ReleaseArtifactBoundaryRule[] = RELEASE_ARTIFACT_BOUNDARY_RULES,
): Promise<ReleaseArtifactScanResult> {
  const coverage = emptyCoverage()
  const findings: ReleaseArtifactBoundaryFinding[] = []
  const visited = new Set<string>()
  const walk = async (directory: string): Promise<void> => {
    let realDirectory: string
    try {
      realDirectory = await fs.realpath(directory)
    } catch (cause) {
      throw new Error(
        `${label} 内的目录 ${directory} 无法解析：` +
          `${cause instanceof Error ? cause.message : String(cause)}（拒绝跳过放行）`,
      )
    }
    if (visited.has(realDirectory)) return
    visited.add(realDirectory)
    const dirents = await fs.readdir(directory, { withFileTypes: true })
    dirents.sort((left, right) => left.name.localeCompare(right.name))
    for (const dirent of dirents) {
      const full = path.join(directory, dirent.name)
      const stats = await fs.stat(full)
      if (stats.isDirectory()) {
        await walk(full)
        continue
      }
      if (!stats.isFile()) {
        throw new Error(`${label} 内的 ${full} 既不是普通文件也不是目录：拒绝跳过放行`)
      }
      findings.push(...await scanOneReleaseArtifactFile(full, rules, coverage))
    }
  }
  await walk(directoryPath)
  return { findings, coverage }
}

/**
 * 按路径形态分派：目录走树扫描，`*.asar` 走条目扫描，普通文件走字节扫描。
 * 这是发布脚本的入口；`scanReleaseArtifactBytes` 只处理「已经是字节」的情况，
 * 对 asar 用它会丢掉条目归属与 unpacked 条目。
 */
export async function scanReleaseArtifactPath(
  artifactPath: string,
  label: string = artifactPath,
  rules: readonly ReleaseArtifactBoundaryRule[] = RELEASE_ARTIFACT_BOUNDARY_RULES,
): Promise<ReleaseArtifactScanResult> {
  const stats = await fs.stat(artifactPath)
  if (stats.isDirectory()) return scanReleaseArtifactTree(artifactPath, label, rules)
  if (!stats.isFile()) {
    throw new Error(`${artifactPath} 既不是普通文件也不是目录：拒绝跳过放行`)
  }
  const coverage = emptyCoverage()
  const findings = await scanOneReleaseArtifactFile(artifactPath, rules, coverage)
  return { findings, coverage }
}

export async function assertReleaseArtifactPathClean(
  artifactPath: string,
  label: string = artifactPath,
): Promise<ReleaseArtifactScanCoverage> {
  const result = await scanReleaseArtifactPath(artifactPath, label)
  assertReleaseArtifactBoundaryClean(result.findings, label)
  return result.coverage
}

/**
 * 060 需要扫的固定产物：工程、Published payload、导出 HTML、组件包。
 *
 * 这是这 6 个目标的**唯一权威定义**（键 → 仓库根相对路径）。
 * `RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS` 与
 * `releaseArtifactBoundaryTargetPath` / `releaseArtifactBoundaryTargetPaths`
 * 全部由它派生，所以「常量清单」与「发布脚本实际传的路径」不可能各写一份。
 *
 * 在此之前 `scripts/verify-release.ts:82-108` 另有一份平行的 `path.join` 清单，
 * 2026-09-22 实测两份清单解析到仓库根后同序同集合（见
 * `tests/unit/releaseArtifactBoundary.test.ts` 的漂移守卫），所以合并为单一来源
 * 不改变任何被扫描的文件。
 */
export const RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES = {
  sampleProject: path.join('examples', 'sample-project.h5lesson'),
  photosynthesisLesson: path.join(
    'examples',
    'photosynthesis-interactive-lesson.h5lesson',
  ),
  sampleComponent: path.join('examples', 'sample-counter.h5component'),
  renderHostBenchmarkProject: path.join(
    'examples',
    'render-host-benchmark',
    'render-host-benchmark-v9.h5lesson',
  ),
  renderHostBenchmarkPublished: path.join(
    'examples',
    'render-host-benchmark',
    'published-v2.json',
  ),
  renderHostBenchmarkHtml: path.join(
    'examples',
    'render-host-benchmark',
    'render-host-benchmark-v2.html',
  ),
} as const

export type ReleaseArtifactBoundaryTargetKey =
  keyof typeof RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES

/** 扫描顺序 = 上面的声明顺序。 */
export const RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS: readonly string[] =
  Object.values(RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES)

/** 按 key 取一个默认目标的绝对路径，供发布脚本具名引用。 */
export function releaseArtifactBoundaryTargetPath(
  key: ReleaseArtifactBoundaryTargetKey,
  root: string = releaseArtifactRepositoryRoot,
): string {
  return path.join(root, RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES[key])
}

/** 按仓库根（或给定根）解析全部默认目标，顺序与常量一致。 */
export function releaseArtifactBoundaryTargetPaths(
  root: string = releaseArtifactRepositoryRoot,
): string[] {
  return RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS.map((relative) =>
    path.isAbsolute(relative) ? relative : path.join(root, relative),
  )
}

export async function verifyReleaseArtifactBoundary(
  targets: readonly string[] = RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS,
): Promise<number> {
  let findings = 0
  for (const relative of targets) {
    const filePath = path.isAbsolute(relative)
      ? relative
      : path.join(releaseArtifactRepositoryRoot, relative)
    // 走 scanReleaseArtifactPath 而不是 scanReleaseArtifactFile：目标是目录或
    // `.asar` 时也要覆盖（asar 逐条目、目录逐文件），否则传进来会被当成一坨字节。
    const result = await scanReleaseArtifactPath(filePath, filePath)
    if (result.findings.length > 0) {
      findings += result.findings.length
      console.error(formatReleaseArtifactBoundaryFindings([...result.findings], filePath))
      continue
    }
    console.log(
      `OK\t${relative}\t应用记录/凭据 0 命中` +
        `（普通文件 ${result.coverage.files}，asar ${result.coverage.archives}` +
        `/条目 ${result.coverage.entries}）`,
    )
  }
  return findings
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((value) => !value.startsWith('-'))
  const findings = await verifyReleaseArtifactBoundary(
    requested.length > 0 ? requested : RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS,
  )
  if (findings > 0) {
    console.error(`发布物数据边界检查失败：共 ${findings} 处违规。`)
    process.exitCode = 1
    return
  }
  console.log('发布物数据边界检查通过：应用消息/trace/凭据/本机个人路径 0 命中。')
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false
if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error('发布物数据边界检查失败：', error)
    process.exitCode = 1
  })
}
