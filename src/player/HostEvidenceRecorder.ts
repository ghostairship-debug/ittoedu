import type {
  AssessmentEvaluationRequest,
  AssessmentEvaluationResult,
} from '../shared/assessmentEvaluators'
import type {
  RuntimeEvidenceActionKind,
  RuntimeScope,
} from '../shared/runtimeTypes'
import { createBrowserUuid } from '../shared/browser/createBrowserUuid'

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
    this.#sessionId = options.sessionId ?? createBrowserUuid()
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
