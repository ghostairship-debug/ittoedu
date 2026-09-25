import { AuthoringToolFailure } from '../../../core/tools/AuthoringToolFailure'
export { AuthoringToolFailure } from '../../../core/tools/AuthoringToolFailure'
import { checkAuthoringOperationConditions, type AuthoringOperationCondition } from '../../../shared/authoringOperationConditions'
import type { z } from 'zod'
import {
  authoringToolRequestV1Schema,
  authoringToolReceiptV1Schema,
  readAuthoringToolSelection,
  type AuthoringToolDestinationV1,
  type AuthoringToolReceiptV1,
} from '../../../shared/authoringToolContract'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { createEditorTransactionStep, type EditorTransactionPlan, type EditorTransactionStep } from '../editorTransaction'
import type { HistoryResourceState } from '../../store/courseResourceState'

type Diagnostic = AuthoringToolReceiptV1['diagnostics'][number]

/** Union child paths are relative to their parent issue in Zod 4. Keep each
 * alternative explicit: a union does not require every branch to match. */
function schemaDiagnostics(issues: readonly z.ZodIssue[], code: string, prefix: string[] = [], alternatives: number[] = []): Diagnostic[] {
  return issues.flatMap((issue): Diagnostic[] => {
    const path = [...prefix, ...issue.path.map(String)]
    if (issue.code === 'invalid_union' && issue.errors.length > 0) {
      return issue.errors.flatMap((branch, index) => schemaDiagnostics(branch, code, path, [...alternatives, index + 1]))
    }
    return [{ code, path, message: alternatives.length ? `Union alternative ${alternatives.join('.')}: ${issue.message}` : issue.message }]
  })
}

/** The existing Surface transaction adapter owns commit and its single history. */
export interface AuthoringToolCommitPort {
  readonly signal?: AbortSignal
  readDocument(): CourseProjectDocument
  readResources?(): HistoryResourceState
  validateDestination(destination: AuthoringToolDestinationV1): Diagnostic | null
  beforeExecute?(): Promise<void>
  commit(step: EditorTransactionStep): boolean | Promise<boolean>
}

export interface AuthoringToolDefinition<T> {
  name: string
  description?: string
  referenceSchemas?: Readonly<Record<string, z.ZodType>>
  usesResources?: boolean
  inputSchema: z.ZodType<T>
  conditions?: readonly AuthoringOperationCondition[]
  plan(input: {
    document: CourseProjectDocument
    destination: AuthoringToolDestinationV1
    value: T
    resources?: HistoryResourceState
    signal?: AbortSignal
  }): Promise<AuthoringToolPlan> | AuthoringToolPlan
}

export interface AuthoringToolPlan {
  transaction: EditorTransactionPlan
  affected: AuthoringToolReceiptV1['affected']
  diagnostics?: Diagnostic[]
  behaviorEvidence?: AuthoringToolReceiptV1['behaviorEvidence']
}

/** Prepare with product commands; recheck after async work; commit exactly once. */
export async function executeAuthoringTool<T>(
  raw: unknown,
  definition: AuthoringToolDefinition<T>,
  port: AuthoringToolCommitPort,
): Promise<AuthoringToolReceiptV1> {
  await port.beforeExecute?.()
  const initial = port.readDocument()
  const parsed = authoringToolRequestV1Schema.safeParse(raw)
  const receipt: AuthoringToolReceiptV1 = {
    version: 1,
    requestId: parsed.success ? parsed.data.requestId : 'invalid-request',
    tool: definition.name,
    destination: parsed.success ? parsed.data.destination : null,
    status: 'rejected',
    beforeRevision: initial.revision,
    afterRevision: initial.revision,
    affected: [],
    resources: { assetIds: [], packageIds: [] },
    diagnostics: [],
  }
  const reject = (status: AuthoringToolReceiptV1['status'], diagnostics: Diagnostic[]) =>
    authoringToolReceiptV1Schema.parse({ ...receipt, status, diagnostics })
  if (!parsed.success) return reject('rejected', schemaDiagnostics(parsed.error.issues, 'invalid-request'))
  const request = parsed.data
  if (request.tool !== definition.name) return reject('rejected', [{ code: 'wrong-tool', message: 'Tool identity does not match', path: ['tool'] }])
  const value = definition.inputSchema.safeParse(request.input)
  if (!value.success) return reject('rejected', schemaDiagnostics(value.error.issues, 'invalid-input', ['input']))
  const target = request.destination.kind === 'update' ? request.destination.target : request.destination.scope
  const stale = () => {
    const current = port.readDocument()
    return current.id !== target.projectId || current.revision !== target.documentRevision
  }
  const staleDiagnostic = { code: 'revision-conflict', message: 'Project or revision has changed', path: ['destination'] }
  if (stale()) return reject('stale', [staleDiagnostic])
  const invalid = port.validateDestination(request.destination)
  if (invalid) return reject('rejected', [invalid])
  const conditionErrors = checkAuthoringOperationConditions(definition.conditions ?? [], request.destination, value.data)
  if (conditionErrors.length) return reject('rejected', conditionErrors)
  try {
    // A planner can only mutate its private input, never the authoritative document.
    if (port.signal?.aborted) return reject('stale', [staleDiagnostic])
    const plan = await definition.plan({ document: structuredClone(initial), destination: request.destination, value: value.data, signal: port.signal,
      ...(definition.usesResources && port.readResources ? { resources: structuredClone(port.readResources()) } : {}) })
    if (stale() || port.signal?.aborted) return reject('stale', [staleDiagnostic])
    const invalidAfterPlan = port.validateDestination(request.destination)
    if (invalidAfterPlan) return reject('stale', [invalidAfterPlan])
    courseProjectDocumentSchema.parse(plan.transaction.nextDocument)
    const step = createEditorTransactionStep(initial, plan.transaction)
    if (!step) return reject('unchanged', plan.diagnostics ?? [])
    // Validate all receipt metadata before the only write; malformed effects cannot
    // leave a successful mutation followed by a failed receipt serialization.
    const success = authoringToolReceiptV1Schema.parse({
      ...receipt,
      status: 'committed',
      afterRevision: step.nextDocument.revision,
      selection: readAuthoringToolSelection(step.selectionHint) ?? undefined,
      affected: plan.affected,
      resources: {
        assetIds: step.resourceChanges.assetFileChanges?.map((change) => change.assetId) ?? [],
        packageIds: step.resourceChanges.componentPackageChanges?.map((change) => change.packageId) ?? [],
      },
      diagnostics: plan.diagnostics ?? [],
      ...(plan.behaviorEvidence ? { behaviorEvidence: plan.behaviorEvidence } : {}),
    })
    if (!(await port.commit(step))) return reject('stale', [staleDiagnostic])
    return success
  } catch (error) {
    if (error instanceof AuthoringToolFailure) return authoringToolReceiptV1Schema.parse({ ...reject('failed', error.diagnostics), ...(error.behaviorEvidence ? { behaviorEvidence: error.behaviorEvidence } : {}) })
    // Keep a concrete producer code when the cause carries one (a `code` field,
    // one level of `cause`, or a `code: detail` message prefix), so recovery can
    // distinguish parameter/target errors from unsupported capabilities. Only
    // opaque failures keep the generic tool-failed code.
    const message = error instanceof Error ? error.message : String(error)
    const codeField = (value: unknown): string | undefined => {
      if (!value || typeof value !== 'object') return undefined
      const code = Reflect.get(value, 'code')
      return typeof code === 'string' && code.trim() ? code : undefined
    }
    const prefixCode = /^([a-z][a-z0-9-]{1,60})[:：]\s/.exec(message)?.[1]
    const code = (codeField(error) ?? codeField(error && typeof error === 'object' ? Reflect.get(error, 'cause') : undefined) ?? prefixCode ?? 'tool-failed').slice(0, 100)
    return reject('failed', [{ code, message, path: [] }])
  }
}
