import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTACHMENT_FAILURE_REASONS } from './workbench/attachments/attachmentFailureReasons'

const errorCodes = new Set(['EPERM', 'EACCES', 'ENOENT', 'ENOSPC', 'EIO', 'EBUSY', 'EEXIST', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ERR_NETWORK', 'ERR_ABORTED', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED', 'ERR_REQUIRE_ESM'])
const categories = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError', 'ImageDecoderUnavailableError', 'AttachmentError', 'DesktopOperationError', 'UserFacingError', 'ZodError'])
const processReasons = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction'])
const chatToolTypes = new Set(['missing', 'null', 'function', 'custom', 'function_call', 'other-string', 'number', 'other'])
const chatToolCodes = new Set(['invalid-tool-index', 'unsupported-tool-type', 'tool-id-changed', 'invalid-tool-function',
  'tool-name-changed', 'invalid-text-delta', 'unsupported-native-delta'])
const chatTransportPhases = new Set(['fetch-before-headers', 'body-read'])
const chatTransportClasses = new Set(['TypeError', 'Error', 'AbortError', 'AggregateError', 'SocketError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError', 'other'])
const fixedMessages = new Set(['图片结果状态未能更新', '图片结果服务未能启动', '保存状态记录未能更新', '保存状态订阅未能启动', '文件变更订阅未能启动'])
// Application lifecycle reasons are software constants, not arbitrary Error/Provider/Component prose.
for (const reason of ['保全输入时文档已关闭', '引用文档已关闭或重开，输入与附件已保留，请重新确认引用后发送。',
  '发送准备期间文档已关闭或重开，输入与附件已保留，请重新确认引用后发送。', '输入所属文档已关闭或重开，原稿保留在本机',
  '附件提取工作窗口已关闭', '附件提取进程已退出', '附件提取窗口载入失败', '附件提取未完成', '附件提取已取消',
  'IPC 操作失败', '界面操作未完成', '应用已启动', '调用的对象不是函数', '代码引用了未定义的变量']) fixedMessages.add(reason)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type DiagnosticInput = { source?: unknown; message?: unknown; stack?: unknown; details?: unknown; timestamp?: unknown }
const closedDocumentMessage = /^文档未打开：([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i

/** Keep mechanical causes without copying values that can be user content. */
function mechanicalReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (fixedMessages.has(value)) return value
  if (closedDocumentMessage.test(value)) return '引用文档已关闭或重开，输入与附件已保留，请重新确认引用后发送。'
  if (/^Cannot read (?:properties|property) of (undefined|null)\b/.test(value))
    return value.match(/^Cannot read (?:properties|property) of (undefined|null)/)![0]
  if (/^[A-Za-z_$][\w.$]* is not a function$/.test(value)) return '调用的对象不是函数'
  if (/^[A-Za-z_$][\w.$]* is not defined$/.test(value)) return '代码引用了未定义的变量'
  return undefined
}

/** The caller supplies fixed operation context; Error subclasses are not a trust marker for prose. */
export function diagnosticFailureDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorClass: 'UnknownError' }
  const details: Record<string, unknown> = { errorClass: error.name, errorMessage: mechanicalReason(error.message) }
  const closedDocument = closedDocumentMessage.exec(error.message)
  if (closedDocument) { details.code = 'DOCUMENT_NOT_OPEN'; details.documentId = closedDocument[1] }
  const code = (error as NodeJS.ErrnoException).code
  if (typeof code === 'string') details.code = code
  if (error.cause instanceof Error) {
    details.causeClass = error.cause.name
    details.causeCode = (error.cause as NodeJS.ErrnoException).code
    details.causeMessage = mechanicalReason(error.cause.message)
    details.causeStack = error.cause.stack
  }
  return details
}

function applicationFrames(stack: string) {
  return stack.split('\n').slice(1, 41).flatMap(line => {
    const match = /^\s+at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/.exec(line)
    if (!match) return []
    let source = match[2]!.replace(/\\/g, '/')
    if (source.startsWith('file:')) { try { source = fileURLToPath(source).replace(/\\/g, '/') } catch { source = '' } }
    const root = path.resolve(__dirname, '../..').replace(/\\/g, '/') + '/'
    const relative = source.toLowerCase().startsWith(root.toLowerCase()) ? source.slice(root.length)
      : /^http:\/\/(?:localhost|127\.0\.0\.1):5173\//.test(source) ? source.replace(/^http:\/\/[^/]+\//, '') : ''
    const internal = /^(?:dist(?:-renderer)?\/)?((?:src|dist-electron|assets)\/[A-Za-z0-9_./-]+)(?:[?#].*)?$/.exec(relative)?.[1]
    const functionName = internal && match[1] && /^[\w.$<> \[\]-]{1,100}$/.test(match[1]) ? match[1] : undefined
    return [{ file: internal ?? '[external]', ...(functionName ? { function: functionName } : {}), line: Number(match[3]), column: Number(match[4]) }]
  })
}

function savedFrames(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 40).flatMap(frame => {
    if (!frame || typeof frame !== 'object' || !Number.isSafeInteger(frame.line) || !Number.isSafeInteger(frame.column)) return []
    const file = typeof frame.file === 'string' && /^(?:src|dist-electron|assets)\/[A-Za-z0-9_./-]+$/.test(frame.file) ? frame.file : '[external]'
    return [{ file, ...(file !== '[external]' && typeof frame.function === 'string' && /^[\w.$<> \[\]-]{1,100}$/.test(frame.function) ? { function: frame.function } : {}), line: frame.line, column: frame.column }]
  })
}

/** No arbitrary text or object field is copied into a default report, including old logs. */
export function privateDiagnostic(entry: DiagnosticInput) {
  const message = typeof entry.message === 'string' ? entry.message : ''
  const stack = typeof entry.stack === 'string' ? entry.stack : ''
  const details = entry.details && typeof entry.details === 'object' ? entry.details as Record<string, unknown> : {}
  const category = /^([A-Za-z]*Error)\b/.exec(stack || message)?.[1]
  const code = [details.code, ...message.split(/[\s:;,]+/)].find(value => typeof value === 'string' && errorCodes.has(value))
  const safeDetails: Record<string, unknown> = {}
  if (details.nativeModule === 'sharp') safeDetails.nativeModule = 'sharp'
  for (const key of ['exitCode', 'httpStatus', 'statusCode', 'revision', 'generation', 'durationMs', 'attempt'] as const) {
    if (typeof details[key] === 'number' && Number.isFinite(details[key])) safeDetails[key] = details[key]
  }
  if (typeof details.reason === 'string' && processReasons.has(details.reason)) safeDetails.reason = details.reason
  for (const key of ['documentId', 'epoch', 'sessionId'] as const) {
    const value = details[key]
    if (typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) safeDetails[key] = value
  }
  const operation = details.operation
  if (typeof operation === 'string' && (/^[A-Z][A-Z0-9_]{1,80}_FAILED$/.test(operation)
    || ['attachment-extraction', 'editor-feedback', 'application-start', 'document-input', 'send-prepare'].includes(operation))) safeDetails.operation = operation
  for (const key of ['phase', 'documentKind', 'type'] as const) {
    if (typeof details[key] === 'string' && ['load', 'extract', 'read', 'drain', 'prepare', 'send', 'startup', 'renderer', 'utility', 'GPU', 'course-v10', 'markdown', 'text', 'html', 'office'].includes(details[key])) safeDetails[key] = details[key]
  }
  if (typeof details.buildRevision === 'string' && /^(?:[a-f0-9]{7,40}|unbuilt|unversioned)$/.test(details.buildRevision)) safeDetails.buildRevision = details.buildRevision
  if (typeof details.buildId === 'string' && /^(?:source-unbuilt|\d{4}-\d{2}-\d{2}T[0-9TZ-]+-(?:[a-f0-9]{7,40}|unversioned))$/.test(details.buildId)) safeDetails.buildId = details.buildId
  if (typeof details.packaged === 'boolean') safeDetails.packaged = details.packaged
  for (const key of ['errorClass', 'causeClass'] as const) if (typeof details[key] === 'string' && categories.has(details[key])) safeDetails[key] = details[key]
  for (const key of ['errorMessage', 'causeMessage'] as const) {
    const reason = mechanicalReason(details[key]); if (reason) safeDetails[key] = reason
  }
  if (typeof details.causeCode === 'string' && errorCodes.has(details.causeCode)) safeDetails.causeCode = details.causeCode
  if (typeof details.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(details.code)) safeDetails.code = details.code
  const causeFrames = typeof details.causeStack === 'string' ? applicationFrames(details.causeStack) : savedFrames(details.causeFrames)
  if (causeFrames.length) safeDetails.causeFrames = causeFrames
  const attachmentCode = typeof details.code === 'string' ? details.code.replace(/^attachment-/, '') : ''
  if (ATTACHMENT_FAILURE_REASONS[attachmentCode]) {
    safeDetails.code = details.code
    safeDetails.errorMessage = ATTACHMENT_FAILURE_REASONS[attachmentCode]![0]
  }
  const causeCode = typeof details.causeCode === 'string' ? details.causeCode.replace(/^attachment-/, '') : ''
  if (ATTACHMENT_FAILURE_REASONS[causeCode]) {
    safeDetails.causeCode = details.causeCode
    safeDetails.causeMessage = ATTACHMENT_FAILURE_REASONS[causeCode]![0]
  }
  if (typeof details.chatToolCode === 'string' && chatToolCodes.has(details.chatToolCode)
    && typeof details.chatToolType === 'string' && chatToolTypes.has(details.chatToolType)) {
    safeDetails.chatToolCode = details.chatToolCode
    safeDetails.chatToolType = details.chatToolType
    if (Number.isSafeInteger(details.chatToolIndex) && Number(details.chatToolIndex) >= 0 && Number(details.chatToolIndex) <= 1024) safeDetails.chatToolIndex = details.chatToolIndex
    if (typeof details.chatToolHasFunction === 'boolean') safeDetails.chatToolHasFunction = details.chatToolHasFunction
  }
  if (typeof details.chatTransportPhase === 'string' && chatTransportPhases.has(details.chatTransportPhase)
    && typeof details.chatTransportClass === 'string' && chatTransportClasses.has(details.chatTransportClass)
    && typeof details.chatHttpResponseReceived === 'boolean') {
    safeDetails.chatTransportPhase = details.chatTransportPhase
    safeDetails.chatTransportClass = details.chatTransportClass
    safeDetails.chatHttpResponseReceived = details.chatHttpResponseReceived
  }
  if (code) safeDetails.code = code
  // Source locations are application-relative; user files remain [external].
  const positions = stack.split('\n').slice(1, 41).flatMap(line => {
    const match = /^\s+at .+:(\d+):(\d+)\)?\s*$/.exec(line)
    return match ? [{ line: Number(match[1]), column: Number(match[2]) }] : []
  })
  return {
    timestamp: typeof entry.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.timestamp) ? entry.timestamp : new Date().toISOString(),
    source: ['main', 'renderer', 'preview', 'component'].includes(String(entry.source)) ? entry.source : 'unknown',
    message: mechanicalReason(message) ?? (/^渲染进程退出：(?:crashed|oom|killed|clean-exit|abnormal-exit|launch-failed|integrity-failure|memory-eviction)$/.test(message) ? message : '错误正文已省略'),
    category: category && categories.has(category) ? category : 'unclassified',
    fingerprint: hash(`${message}\n${stack}`),
    ...(positions.length ? { positions } : {}),
    ...(applicationFrames(stack).length ? { frames: applicationFrames(stack) } : {}),
    ...(Object.keys(safeDetails).length ? { details: safeDetails } : {}),
  }
}

/** Stored records are already sanitized; reconstruct only our strict public fields. */
export function privateDiagnosticLog(text: string): string {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    try {
      const input = JSON.parse(line) as DiagnosticInput & { fingerprint?: unknown; category?: unknown; positions?: unknown; frames?: unknown }
      if (!input || typeof input !== 'object') throw new Error('invalid record')
      const result = privateDiagnostic(input)
      if (input.message === '错误正文已省略' || mechanicalReason(input.message) || /^渲染进程退出：/.test(String(input.message))) {
        if (typeof input.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.fingerprint)) result.fingerprint = input.fingerprint
        if (typeof input.category === 'string' && categories.has(input.category)) result.category = input.category
        if (Array.isArray(input.positions)) result.positions = input.positions.slice(0, 40).flatMap(value =>
          value && typeof value === 'object' && Number.isSafeInteger(value.line) && Number.isSafeInteger(value.column) ? [{ line: value.line, column: value.column }] : [])
        if (Array.isArray(input.frames)) result.frames = input.frames.slice(0, 40).flatMap(value => {
          if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.line) || !Number.isSafeInteger(value.column)) return []
          const file = typeof value.file === 'string' && /^(?:src|dist-electron|assets)\/[A-Za-z0-9_./-]+$/.test(value.file) ? value.file : '[external]'
          return [{ file, ...(file !== '[external]' && typeof value.function === 'string' && /^[\w.$<> \[\]-]{1,100}$/.test(value.function) ? { function: value.function } : {}), line: value.line, column: value.column }]
        })
      }
      return JSON.stringify(result)
    } catch { return JSON.stringify({ source: 'unknown', category: 'invalid-record', message: '无法解析的旧记录已省略', fingerprint: hash(line) }) }
  }).join('\n')
}
