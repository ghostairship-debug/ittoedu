import { createHash } from 'node:crypto'

const errorCodes = new Set(['EPERM', 'EACCES', 'ENOENT', 'ENOSPC', 'EIO', 'EBUSY', 'EEXIST', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ERR_NETWORK', 'ERR_ABORTED'])
const categories = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError'])
const processReasons = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction'])
const chatToolTypes = new Set(['missing', 'null', 'function', 'custom', 'function_call', 'other-string', 'number', 'other'])
const chatToolCodes = new Set(['invalid-tool-index', 'unsupported-tool-type', 'tool-id-changed', 'invalid-tool-function',
  'tool-name-changed', 'invalid-text-delta', 'unsupported-native-delta'])
const chatTransportPhases = new Set(['fetch-before-headers', 'body-read'])
const chatTransportClasses = new Set(['TypeError', 'Error', 'AbortError', 'AggregateError', 'SocketError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError', 'other'])
const fixedMessages = new Set(['图片结果状态未能更新', '图片结果服务未能启动', '保存状态记录未能更新', '保存状态订阅未能启动', '文件变更订阅未能启动'])
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type DiagnosticInput = { source?: unknown; message?: unknown; stack?: unknown; details?: unknown; timestamp?: unknown }

/** No arbitrary text or object field is copied into a default report, including old logs. */
export function privateDiagnostic(entry: DiagnosticInput) {
  const message = typeof entry.message === 'string' ? entry.message : ''
  const stack = typeof entry.stack === 'string' ? entry.stack : ''
  const details = entry.details && typeof entry.details === 'object' ? entry.details as Record<string, unknown> : {}
  const category = /^([A-Za-z]+Error)\b/.exec(stack || message)?.[1]
  const code = [details.code, ...message.split(/[\s:;,]+/)].find(value => typeof value === 'string' && errorCodes.has(value))
  const safeDetails: Record<string, unknown> = {}
  for (const key of ['exitCode', 'httpStatus', 'statusCode', 'revision', 'generation', 'durationMs', 'attempt'] as const) {
    if (typeof details[key] === 'number' && Number.isFinite(details[key])) safeDetails[key] = details[key]
  }
  if (typeof details.reason === 'string' && processReasons.has(details.reason)) safeDetails.reason = details.reason
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
  // Preserve machine stack positions, never source text, file names, paths, URLs or argument values.
  const positions = stack.split('\n').slice(1, 41).flatMap(line => {
    const match = /^\s+at .+:(\d+):(\d+)\)?\s*$/.exec(line)
    return match ? [{ line: Number(match[1]), column: Number(match[2]) }] : []
  })
  return {
    timestamp: typeof entry.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.timestamp) ? entry.timestamp : new Date().toISOString(),
    source: ['main', 'renderer', 'preview', 'component'].includes(String(entry.source)) ? entry.source : 'unknown',
    message: fixedMessages.has(message) ? message : '错误正文已省略',
    category: category && categories.has(category) ? category : 'unclassified',
    fingerprint: hash(`${message}\n${stack}`),
    ...(positions.length ? { positions } : {}),
    ...(Object.keys(safeDetails).length ? { details: safeDetails } : {}),
  }
}

/** Stored records are already sanitized; reconstruct only our strict public fields. */
export function privateDiagnosticLog(text: string): string {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    try {
      const input = JSON.parse(line) as DiagnosticInput & { fingerprint?: unknown; category?: unknown; positions?: unknown }
      if (!input || typeof input !== 'object') throw new Error('invalid record')
      const result = privateDiagnostic(input)
      if (input.message === '错误正文已省略' || fixedMessages.has(String(input.message))) {
        if (typeof input.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.fingerprint)) result.fingerprint = input.fingerprint
        if (typeof input.category === 'string' && categories.has(input.category)) result.category = input.category
        if (Array.isArray(input.positions)) result.positions = input.positions.slice(0, 40).flatMap(value =>
          value && typeof value === 'object' && Number.isSafeInteger(value.line) && Number.isSafeInteger(value.column) ? [{ line: value.line, column: value.column }] : [])
      }
      return JSON.stringify(result)
    } catch { return JSON.stringify({ source: 'unknown', category: 'invalid-record', message: '无法解析的旧记录已省略', fingerprint: hash(line) }) }
  }).join('\n')
}
