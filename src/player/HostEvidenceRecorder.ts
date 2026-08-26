import type {
  AssessmentEvaluationRequest,
  AssessmentEvaluationResult,
} from '../shared/assessmentEvaluators'
import type {
  RuntimeEvidenceActionKind,
  RuntimeScope,
} from '../shared/runtimeTypes'

export const HOST_EVIDENCE_SCHEMA_VERSION = 1 as const
export const HOST_EVIDENCE_CONSOLE_PREFIX =
  '[courseware-host-evidence-v1] ' as const

export interface RuntimeAssessmentEvaluationEvidence {
  scope: RuntimeScope
  sceneId?: string
  request: Readonly<AssessmentEvaluationRequest>
  result: Readonly<AssessmentEvaluationResult>
}

export type RuntimeAssessmentEvaluatedHandler = (
  evidence: RuntimeAssessmentEvaluationEvidence,
) => void

export interface RuntimeActionRecordedEvidence {
  scope: RuntimeScope
  sceneId?: string
  actId: string
  responseId?: string
  actionKind: RuntimeEvidenceActionKind
  eventType: string
}

export type RuntimeActionRecordedHandler = (
  evidence: Readonly<RuntimeActionRecordedEvidence>,
) => void

export interface HostEvidenceSessionStartRecord {
  schemaVersion: typeof HOST_EVIDENCE_SCHEMA_VERSION
  kind: 'session-start'
  sessionId: string
  sequence: 0
}

export interface HostAssessmentEvaluatedRecord {
  schemaVersion: typeof HOST_EVIDENCE_SCHEMA_VERSION
  kind: 'assessment-evaluated'
  sessionId: string
  sequence: number
  scope: RuntimeScope
  sceneId: string | null
  responseId: string | null
  evaluatorId: AssessmentEvaluationResult['evaluatorId']
  input: string
  acceptedValues: string[]
  normalizedInput: string
  status: AssessmentEvaluationResult['status']
}

export interface HostActionRecordedRecord {
  schemaVersion: typeof HOST_EVIDENCE_SCHEMA_VERSION
  kind: 'action-recorded'
  sessionId: string
  sequence: number
  scope: RuntimeScope
  sceneId: string | null
  actId: string
  responseId: string | null
  actionKind: RuntimeEvidenceActionKind
  eventType: string
}

export type HostEvidenceRecord =
  | HostEvidenceSessionStartRecord
  | HostAssessmentEvaluatedRecord
  | HostActionRecordedRecord

export type HostEvidenceSink = (serializedRecord: string) => void

// Capture the native writer while the trusted Player bundle is evaluated,
// before any course-owned Runtime source can execute or replace console.info.
const capturedConsoleInfo = console.info.bind(console)
const capturedJsonStringify = JSON.stringify.bind(JSON)
const defaultSink: HostEvidenceSink = capturedConsoleInfo

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('宿主证据会话需要安全随机数源')
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  // RFC 4122 version 4 / variant 1 layout for environments without randomUUID.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-')
}

/**
 * Write-only host evidence channel. PlayerApp keeps the recorder in a native
 * private field; Runtime code receives only the normal assessment API.
 */
export class HostEvidenceRecorder {
  readonly #sessionId: string
  readonly #sink: HostEvidenceSink
  #sequence = 0

  constructor(options: {
    sink?: HostEvidenceSink
    /** Deterministic tests only. PlayerApp always uses a random session id. */
    sessionId?: string
  } = {}) {
    this.#sessionId = options.sessionId ?? createSessionId()
    this.#sink = options.sink ?? defaultSink
    this.#write({
      schemaVersion: HOST_EVIDENCE_SCHEMA_VERSION,
      kind: 'session-start',
      sessionId: this.#sessionId,
      sequence: 0,
    })
  }

  recordAssessment(evidence: RuntimeAssessmentEvaluationEvidence): void {
    this.#sequence += 1
    this.#write({
      schemaVersion: HOST_EVIDENCE_SCHEMA_VERSION,
      kind: 'assessment-evaluated',
      sessionId: this.#sessionId,
      sequence: this.#sequence,
      scope: evidence.scope,
      sceneId: evidence.sceneId ?? null,
      responseId: evidence.request.responseId ?? null,
      evaluatorId: evidence.result.evaluatorId,
      input: evidence.request.input,
      acceptedValues: [...evidence.request.acceptedValues],
      normalizedInput: evidence.result.normalizedInput,
      status: evidence.result.status,
    })
  }

  recordAction(evidence: RuntimeActionRecordedEvidence): void {
    this.#sequence += 1
    this.#write({
      schemaVersion: HOST_EVIDENCE_SCHEMA_VERSION,
      kind: 'action-recorded',
      sessionId: this.#sessionId,
      sequence: this.#sequence,
      scope: evidence.scope,
      sceneId: evidence.sceneId ?? null,
      actId: evidence.actId,
      responseId: evidence.responseId ?? null,
      actionKind: evidence.actionKind,
      eventType: evidence.eventType,
    })
  }

  #write(record: HostEvidenceRecord): void {
    this.#sink(`${HOST_EVIDENCE_CONSOLE_PREFIX}${capturedJsonStringify(record)}`)
  }
}
