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
export class AuthoringToolFailure extends Error {
  constructor(readonly diagnostics: Diagnostic[]) { super(diagnostics.map(item => item.message).join('\n')) }
}

/** The existing Surface transaction adapter owns commit and its single history. */
export interface AuthoringToolCommitPort {
  readDocument(): CourseProjectDocument
  readResources?(): HistoryResourceState
  validateDestination(destination: AuthoringToolDestinationV1): Diagnostic | null
  commit(step: EditorTransactionStep): boolean
}

export interface AuthoringToolDefinition<T> {
  name: string
  usesResources?: boolean
  inputSchema: z.ZodType<T>
  plan(input: {
    document: CourseProjectDocument
    destination: AuthoringToolDestinationV1
    value: T
    resources?: HistoryResourceState
  }): Promise<AuthoringToolPlan> | AuthoringToolPlan
}

export interface AuthoringToolPlan {
  transaction: EditorTransactionPlan
  affected: AuthoringToolReceiptV1['affected']
  diagnostics?: Diagnostic[]
}

/** Prepare with product commands; recheck after async work; commit exactly once. */
export async function executeAuthoringTool<T>(
  raw: unknown,
  definition: AuthoringToolDefinition<T>,
  port: AuthoringToolCommitPort,
): Promise<AuthoringToolReceiptV1> {
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
  if (!parsed.success) return reject('rejected', parsed.error.issues.map((issue) => ({
    code: 'invalid-request', message: issue.message, path: issue.path.map(String),
  })))
  const request = parsed.data
  if (request.tool !== definition.name) return reject('rejected', [{ code: 'wrong-tool', message: 'Tool identity does not match', path: ['tool'] }])
  const value = definition.inputSchema.safeParse(request.input)
  if (!value.success) return reject('rejected', value.error.issues.map((issue) => ({
    code: 'invalid-input', message: issue.message, path: ['input', ...issue.path.map(String)],
  })))
  const target = request.destination.kind === 'update' ? request.destination.target : request.destination.scope
  const stale = () => {
    const current = port.readDocument()
    return current.id !== target.projectId || current.revision !== target.documentRevision
  }
  const staleDiagnostic = { code: 'revision-conflict', message: 'Project or revision has changed', path: ['destination'] }
  if (stale()) return reject('stale', [staleDiagnostic])
  const invalid = port.validateDestination(request.destination)
  if (invalid) return reject('rejected', [invalid])
  try {
    // A planner can only mutate its private input, never the authoritative document.
    const plan = await definition.plan({ document: structuredClone(initial), destination: request.destination, value: value.data,
      ...(definition.usesResources && port.readResources ? { resources: structuredClone(port.readResources()) } : {}) })
    if (stale()) return reject('stale', [staleDiagnostic])
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
    })
    if (!port.commit(step)) return reject('stale', [staleDiagnostic])
    return success
  } catch (error) {
    if (error instanceof AuthoringToolFailure) return reject('failed', error.diagnostics)
    return reject('failed', [{ code: 'tool-failed', message: error instanceof Error ? error.message : String(error), path: [] }])
  }
}
