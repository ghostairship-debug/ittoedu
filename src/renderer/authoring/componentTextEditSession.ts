import {
  getComponentPropValue,
  mergeComponentProps,
  resolveComponentEditorProperties,
  setComponentPropValue,
} from '../../shared/componentProps'
import type {
  ComponentAuthoringTextTarget,
  ComponentPackageData,
  ComponentScope,
} from '../../shared/componentTypes'
import type {
  ExternalComponentNode,
  SceneNode,
} from '../../shared/projectTypes'

export interface ComponentTextEditContext {
  readonly projectId: string
  readonly scope: ComponentScope
  readonly sceneId: string
  readonly stateId: string | null
  readonly nodes: ReadonlyArray<Readonly<SceneNode>>
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly targets: ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
}

/**
 * Immutable identity captured when a component text edit starts. Keeping the
 * presentation state here prevents a later blur/Enter event from writing into
 * whichever scene or state happens to be active at commit time.
 */
export interface ComponentTextEditSession {
  readonly kind: 'component-text'
  readonly targetId: string
  readonly projectId: string
  readonly scope: ComponentScope
  /** The active editor scene, including for a globally scoped component. */
  readonly sceneId: string
  readonly stateId: string | null
  readonly nodeId: string
  readonly componentId: string
  readonly componentVersion: string
  readonly key: string
  readonly initialValue: string
  readonly label: string
  readonly multiline: boolean
  readonly maxLength?: number
  readonly source: ComponentAuthoringTextTarget['source']
  readonly bounds: ComponentAuthoringTextTarget['bounds']
  readonly rotation: number
}

export type ComponentTextEditFailureReason =
  | 'context-changed'
  | 'target-invalid'

export type BeginComponentTextEditResult = {
  readonly ok: true
  readonly session: Readonly<ComponentTextEditSession>
  readonly value: string
} | {
  readonly ok: false
  readonly reason: ComponentTextEditFailureReason
}

export type ResolveComponentTextEditResult = {
  readonly ok: true
  readonly nodeId: string
  readonly props: Record<string, unknown>
} | {
  readonly ok: false
  readonly reason: ComponentTextEditFailureReason
}

function componentPackageForNode(
  node: Readonly<ExternalComponentNode>,
  componentPackages: Readonly<Record<string, ComponentPackageData>>,
): ComponentPackageData | undefined {
  const { packageId, version } = node.component
  const exactKey = componentPackages[`${packageId}@${version}`]
  const packageKey = componentPackages[packageId]
  return [exactKey, packageKey].find((candidate) => (
    candidate?.manifest.id === packageId &&
    candidate.manifest.version === version
  )) ?? Object.values(componentPackages).find((candidate) => (
    candidate.manifest.id === packageId &&
    candidate.manifest.version === version
  ))
}

function componentNodeForTarget(
  nodeId: string,
  componentId: string,
  componentVersion: string | undefined,
  context: ComponentTextEditContext,
): Readonly<ExternalComponentNode> | undefined {
  return context.nodes.find(
    (node): node is Readonly<ExternalComponentNode> => (
      node.id === nodeId &&
      node.type === 'external-component' &&
      node.visible &&
      !node.locked &&
      node.component.packageId === componentId &&
      (componentVersion === undefined ||
        node.component.version === componentVersion)
    ),
  )
}

function resolveCurrentStringValue(
  node: Readonly<ExternalComponentNode>,
  key: string,
  context: ComponentTextEditContext,
): string | undefined {
  const component = componentPackageForNode(node, context.componentPackages)
  if (!component) return undefined
  const field = resolveComponentEditorProperties(
    component.manifest,
    node.props,
  ).find((candidate) => (
    candidate.key === key &&
    (candidate.type === 'text' || candidate.type === 'textarea')
  ))
  if (!field) return undefined
  const value = getComponentPropValue(
    mergeComponentProps(component.manifest, node.props),
    key,
  )
  return typeof value === 'string' ? value : undefined
}

function targetMatchesContext(
  target: Pick<ComponentAuthoringTextTarget, 'scope' | 'sceneId'>,
  context: Pick<ComponentTextEditContext, 'scope' | 'sceneId'>,
): boolean {
  return target.scope === context.scope && (
    target.scope === 'global' || target.sceneId === context.sceneId
  )
}

function sameTargetIdentity(
  target: Readonly<ComponentAuthoringTextTarget>,
  expected: Pick<
    ComponentTextEditSession,
    'targetId' | 'scope' | 'sceneId' | 'nodeId' | 'componentId' | 'key' | 'source'
  >,
): boolean {
  return target.targetId === expected.targetId &&
    target.scope === expected.scope &&
    (target.scope === 'global' || target.sceneId === expected.sceneId) &&
    target.nodeId === expected.nodeId &&
    target.componentId === expected.componentId &&
    target.key === expected.key &&
    target.source === expected.source
}

export function componentTextEditSessionMatchesContext(
  session: Readonly<ComponentTextEditSession>,
  context: Pick<
    ComponentTextEditContext,
    'projectId' | 'scope' | 'sceneId' | 'stateId'
  >,
): boolean {
  return session.projectId === context.projectId &&
    session.scope === context.scope &&
    session.sceneId === context.sceneId &&
    session.stateId === context.stateId
}

export function componentTextTargetMatchesSession(
  target: Readonly<ComponentAuthoringTextTarget>,
  session: Readonly<ComponentTextEditSession>,
): boolean {
  return sameTargetIdentity(target, session)
}

export function beginComponentTextEditSession(
  target: Readonly<ComponentAuthoringTextTarget>,
  context: ComponentTextEditContext,
): BeginComponentTextEditResult {
  if (!targetMatchesContext(target, context)) {
    return { ok: false, reason: 'context-changed' }
  }
  if (!context.targets.some((candidate) => (
    candidate.targetId === target.targetId &&
    candidate.scope === target.scope &&
    candidate.sceneId === target.sceneId &&
    candidate.nodeId === target.nodeId &&
    candidate.componentId === target.componentId &&
    candidate.key === target.key &&
    candidate.source === target.source
  ))) {
    return { ok: false, reason: 'target-invalid' }
  }
  const node = componentNodeForTarget(
    target.nodeId,
    target.componentId,
    undefined,
    context,
  )
  if (!node) return { ok: false, reason: 'target-invalid' }
  const value = resolveCurrentStringValue(node, target.key, context)
  if (value === undefined) return { ok: false, reason: 'target-invalid' }

  return {
    ok: true,
    value,
    session: Object.freeze({
      kind: 'component-text',
      targetId: target.targetId,
      projectId: context.projectId,
      scope: context.scope,
      sceneId: context.sceneId,
      stateId: context.stateId,
      nodeId: target.nodeId,
      componentId: target.componentId,
      componentVersion: node.component.version,
      key: target.key,
      initialValue: value,
      label: target.label,
      multiline: target.multiline,
      ...(target.maxLength === undefined
        ? {}
        : { maxLength: target.maxLength }),
      source: target.source,
      bounds: Object.freeze({ ...target.bounds }),
      rotation: target.rotation,
    }),
  }
}

export function resolveComponentTextEdit(
  session: Readonly<ComponentTextEditSession>,
  value: string,
  context: ComponentTextEditContext,
): ResolveComponentTextEditResult {
  if (!componentTextEditSessionMatchesContext(session, context)) {
    return { ok: false, reason: 'context-changed' }
  }
  if (!context.targets.some((target) => (
    componentTextTargetMatchesSession(target, session)
  ))) {
    return { ok: false, reason: 'target-invalid' }
  }
  const node = componentNodeForTarget(
    session.nodeId,
    session.componentId,
    session.componentVersion,
    context,
  )
  if (!node || resolveCurrentStringValue(node, session.key, context) === undefined) {
    return { ok: false, reason: 'target-invalid' }
  }

  try {
    return {
      ok: true,
      nodeId: node.id,
      props: setComponentPropValue(node.props, session.key, value),
    }
  } catch {
    return { ok: false, reason: 'target-invalid' }
  }
}
