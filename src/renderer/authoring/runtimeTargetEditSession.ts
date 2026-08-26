import type {
  RuntimeAuthoringTarget,
  RuntimeScope,
} from '../../shared/runtimeTypes'

/**
 * Live editor context used to validate a Runtime text/asset edit session.
 * `stateId` is deliberately informational: RuntimeDocument content/assets are
 * shared by every presentation state in their scene (or by the whole course
 * for a global Runtime), so changing state must not invalidate the session.
 */
export interface RuntimeTargetEditContext {
  readonly projectId: string
  readonly scope: RuntimeScope
  /** The active editor scene, including while editing the global layer. */
  readonly sceneId: string
  readonly stateId?: string | null
  readonly targets: ReadonlyArray<Readonly<RuntimeAuthoringTarget>>
}

/** Immutable Runtime target identity captured when an edit starts. */
export interface RuntimeTargetEditSession {
  readonly projectId: string
  readonly scope: RuntimeScope
  /** The active editor scene, including for a globally scoped Runtime. */
  readonly sceneId: string
  readonly targetId: string
  /** Published Runtime layer item; absent only for a standalone RuntimeHost. */
  readonly nodeId?: string
  readonly kind: RuntimeAuthoringTarget['kind']
  readonly key: string
}

export type RuntimeTargetEditFailureReason =
  | 'context-changed'
  | 'target-invalid'

export type BeginRuntimeTargetEditResult = {
  readonly ok: true
  readonly session: Readonly<RuntimeTargetEditSession>
} | {
  readonly ok: false
  readonly reason: RuntimeTargetEditFailureReason
}

export type ValidateRuntimeTargetEditResult = {
  readonly ok: true
  readonly target: Readonly<RuntimeAuthoringTarget>
} | {
  readonly ok: false
  readonly reason: RuntimeTargetEditFailureReason
}

function targetMatchesContext(
  target: Pick<RuntimeAuthoringTarget, 'scope' | 'sceneId'>,
  context: Pick<RuntimeTargetEditContext, 'scope' | 'sceneId'>,
): boolean {
  return target.scope === context.scope && (
    target.scope === 'global' || target.sceneId === context.sceneId
  )
}

export function runtimeTargetEditSessionMatchesContext(
  session: Readonly<RuntimeTargetEditSession>,
  context: Pick<RuntimeTargetEditContext, 'projectId' | 'scope' | 'sceneId'>,
): boolean {
  return session.projectId === context.projectId &&
    session.scope === context.scope &&
    session.sceneId === context.sceneId
}

export function runtimeTargetMatchesEditSession(
  target: Readonly<RuntimeAuthoringTarget>,
  session: Readonly<RuntimeTargetEditSession>,
): boolean {
  return target.targetId === session.targetId &&
    target.nodeId === session.nodeId &&
    target.scope === session.scope &&
    (target.scope === 'global' || target.sceneId === session.sceneId) &&
    target.kind === session.kind &&
    target.key === session.key
}

export function beginRuntimeTargetEditSession(
  target: Readonly<RuntimeAuthoringTarget>,
  context: RuntimeTargetEditContext,
): BeginRuntimeTargetEditResult {
  if (!targetMatchesContext(target, context)) {
    return { ok: false, reason: 'context-changed' }
  }
  if (!context.targets.some((candidate) => (
    runtimeTargetMatchesEditSession(candidate, {
      projectId: context.projectId,
      scope: context.scope,
      sceneId: context.sceneId,
      targetId: target.targetId,
      ...(target.nodeId === undefined ? {} : { nodeId: target.nodeId }),
      kind: target.kind,
      key: target.key,
    })
  ))) {
    return { ok: false, reason: 'target-invalid' }
  }

  return {
    ok: true,
    session: Object.freeze({
      projectId: context.projectId,
      scope: context.scope,
      sceneId: context.sceneId,
      targetId: target.targetId,
      ...(target.nodeId === undefined ? {} : { nodeId: target.nodeId }),
      kind: target.kind,
      key: target.key,
    }),
  }
}

export function validateRuntimeTargetEditSession(
  session: Readonly<RuntimeTargetEditSession>,
  context: RuntimeTargetEditContext,
): ValidateRuntimeTargetEditResult {
  if (!runtimeTargetEditSessionMatchesContext(session, context)) {
    return { ok: false, reason: 'context-changed' }
  }
  const target = context.targets.find((candidate) => (
    runtimeTargetMatchesEditSession(candidate, session)
  ))
  return target
    ? { ok: true, target }
    : { ok: false, reason: 'target-invalid' }
}
