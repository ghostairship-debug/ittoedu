import { z } from 'zod'
import type { ComponentAuthoringTargetUpdate } from './componentTypes'
import { nodeMotionActionSchema } from './interactionSchema'
import type { NodeMotionAction } from './interactionTypes'
import { sceneNodeSchema } from './projectSchema'
import type { SceneNode } from './projectTypes'
import type { RuntimeAuthoringTargetUpdate } from './runtimeTypes'

export const PLAYER_AUTHORING_PROTOCOL_VERSION = 1 as const

export const PLAYER_AUTHORING_MESSAGE_TYPES = Object.freeze({
  patch: 'courseware-editor:authoring-patch',
  ready: 'courseware-player:authoring-ready',
  ack: 'courseware-player:authoring-ack',
  error: 'courseware-player:authoring-error',
  runtimeTargets: 'courseware-player:authoring-targets',
  componentTargets: 'courseware-player:authoring-component-targets',
} as const)

export type PlayerHostMode = 'playback' | 'authoring'
export type PlayerAuthoringScope = 'scene' | 'global'

export interface PlayerAuthoringContext {
  sceneId: string
  /** `null` identifies the canonical base authoring view. */
  stateId: string | null
}

export type PlayerAuthoringTarget =
  | {
      kind: 'native-node'
      scope: PlayerAuthoringScope
      nodeId: string
    }
  | {
      kind: 'scene-background'
      scope: 'scene'
    }
  | {
      kind: 'scene-order'
      scope: 'scene'
    }
  | {
      kind: 'runtime-content'
      scope: PlayerAuthoringScope
      nodeId: string
      key: string
    }

export type PlayerAuthoringPatch =
  | {
      kind: 'native-node'
      target: Extract<PlayerAuthoringTarget, { kind: 'native-node' }>
      /** Complete, materialized Project V8 node. The Player never merges partials. */
      node: SceneNode
    }
  | {
      kind: 'scene-background'
      target: Extract<PlayerAuthoringTarget, { kind: 'scene-background' }>
      backgroundColor: string
      backgroundAssetId?: string | null
    }
  | {
      kind: 'scene-order'
      target: Extract<PlayerAuthoringTarget, { kind: 'scene-order' }>
      /** Complete back-to-front order of every node in the materialized scene. */
      nodeIds: string[]
    }
  | {
      /** Ephemeral visual preview; never mutates Project V8 or playback state. */
      kind: 'preview-node-motion'
      target: Extract<PlayerAuthoringTarget, { kind: 'native-node' }>
      action: NodeMotionAction
      delayMs: number
    }
  | {
      kind: 'runtime-content'
      target: Extract<PlayerAuthoringTarget, { kind: 'runtime-content' }>
      value: string
    }

export interface PlayerAuthoringPatchCommand {
  type: typeof PLAYER_AUTHORING_MESSAGE_TYPES.patch
  protocolVersion: typeof PLAYER_AUTHORING_PROTOCOL_VERSION
  sessionId: string
  requestId: string
  revision: number
  context: PlayerAuthoringContext
  patch: PlayerAuthoringPatch
}

export const PLAYER_AUTHORING_CAPABILITIES = Object.freeze([
  'native-node',
  'scene-background',
  'scene-order',
  'node-motion-preview',
  'runtime-targets',
  'component-targets',
] as const)

/** Published V2 additionally supports transient Runtime content repainting. */
export const PUBLISHED_AUTHORING_CAPABILITIES = Object.freeze([
  ...PLAYER_AUTHORING_CAPABILITIES,
  'runtime-content',
] as const)

export type PlayerAuthoringCapabilities =
  | typeof PLAYER_AUTHORING_CAPABILITIES
  | typeof PUBLISHED_AUTHORING_CAPABILITIES

export interface PlayerAuthoringReadyMessage {
  type: typeof PLAYER_AUTHORING_MESSAGE_TYPES.ready
  protocolVersion: typeof PLAYER_AUTHORING_PROTOCOL_VERSION
  sessionId: string
  context: PlayerAuthoringContext
  capabilities: PlayerAuthoringCapabilities
}

export interface PlayerAuthoringAckMessage {
  type: typeof PLAYER_AUTHORING_MESSAGE_TYPES.ack
  protocolVersion: typeof PLAYER_AUTHORING_PROTOCOL_VERSION
  sessionId: string
  requestId: string
  revision: number
  context: PlayerAuthoringContext
  target: PlayerAuthoringTarget
}

export type PlayerAuthoringErrorCode =
  | 'invalid-command'
  | 'invalid-session'
  | 'unsupported-host-mode'
  | 'not-ready'
  | 'stale-revision'
  | 'scene-mismatch'
  | 'state-mismatch'
  | 'target-not-found'
  | 'target-mismatch'
  | 'asset-missing'
  | 'update-failed'

export interface PlayerAuthoringErrorMessage {
  type: typeof PLAYER_AUTHORING_MESSAGE_TYPES.error
  protocolVersion: typeof PLAYER_AUTHORING_PROTOCOL_VERSION
  sessionId?: string
  requestId?: string
  revision?: number
  code: PlayerAuthoringErrorCode
  message: string
}

export interface PlayerRuntimeAuthoringTargetsMessage {
  type: typeof PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets
  protocolVersion: typeof PLAYER_AUTHORING_PROTOCOL_VERSION
  sessionId: string
  /** Monotonic across global/scene RuntimeHost replacements in this Player. */
  revision: number
  /** Reuses the Runtime API authoring target snapshot without a parallel model. */
  update: Readonly<RuntimeAuthoringTargetUpdate>
}

export interface PlayerComponentAuthoringTargetsMessage {
  type: typeof PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets
  protocolVersion: typeof PLAYER_AUTHORING_PROTOCOL_VERSION
  sessionId: string
  /** Monotonic across every authoring-target message in this Player. */
  revision: number
  /** One component instance's complete current canvas text-target snapshot. */
  update: Readonly<ComponentAuthoringTargetUpdate>
}

export type PlayerAuthoringHostMessage =
  | PlayerAuthoringReadyMessage
  | PlayerAuthoringAckMessage
  | PlayerAuthoringErrorMessage
  | PlayerRuntimeAuthoringTargetsMessage
  | PlayerComponentAuthoringTargetsMessage

const identifier = z.string().min(1).max(256).refine(
  (value) => value.trim() === value,
  { message: '标识不能包含首尾空白' },
)
const contextSchema = z.object({
  sceneId: identifier,
  stateId: identifier.nullable(),
}).strict()
const nativeTargetSchema = z.object({
  kind: z.literal('native-node'),
  scope: z.enum(['scene', 'global']),
  nodeId: identifier,
}).strict()
const sceneBackgroundTargetSchema = z.object({
  kind: z.literal('scene-background'),
  scope: z.literal('scene'),
}).strict()
const sceneOrderTargetSchema = z.object({
  kind: z.literal('scene-order'),
  scope: z.literal('scene'),
}).strict()
const runtimeContentTargetSchema = z.object({
  kind: z.literal('runtime-content'),
  scope: z.enum(['scene', 'global']),
  nodeId: identifier,
  key: identifier,
}).strict()
const targetSchema = z.discriminatedUnion('kind', [
  nativeTargetSchema,
  sceneBackgroundTargetSchema,
  sceneOrderTargetSchema,
  runtimeContentTargetSchema,
])

const legacyCapabilitiesSchema = z.tuple([
  z.literal('native-node'),
  z.literal('scene-background'),
  z.literal('scene-order'),
  z.literal('node-motion-preview'),
  z.literal('runtime-targets'),
  z.literal('component-targets'),
])
const publishedCapabilitiesSchema = z.tuple([
  z.literal('native-node'),
  z.literal('scene-background'),
  z.literal('scene-order'),
  z.literal('node-motion-preview'),
  z.literal('runtime-targets'),
  z.literal('component-targets'),
  z.literal('runtime-content'),
])
const readySchema = z.object({
  type: z.literal(PLAYER_AUTHORING_MESSAGE_TYPES.ready),
  protocolVersion: z.literal(PLAYER_AUTHORING_PROTOCOL_VERSION),
  sessionId: identifier,
  context: contextSchema,
  capabilities: z.union([
    legacyCapabilitiesSchema,
    publishedCapabilitiesSchema,
  ]),
  /** The sandbox bridge adds this transport token to every Player message. */
  token: identifier.optional(),
}).strict()

const ackSchema = z.object({
  type: z.literal(PLAYER_AUTHORING_MESSAGE_TYPES.ack),
  protocolVersion: z.literal(PLAYER_AUTHORING_PROTOCOL_VERSION),
  sessionId: identifier,
  requestId: identifier,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  context: contextSchema,
  target: targetSchema,
  /** The sandbox bridge adds this transport token to every Player message. */
  token: identifier.optional(),
}).strict()

const patchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('native-node'),
    target: nativeTargetSchema,
    node: sceneNodeSchema,
  }).strict(),
  z.object({
    kind: z.literal('scene-background'),
    target: sceneBackgroundTargetSchema,
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    backgroundAssetId: identifier.nullable().optional(),
  }).strict(),
  z.object({
    kind: z.literal('scene-order'),
    target: sceneOrderTargetSchema,
    nodeIds: z.array(identifier).max(1_000),
  }).strict(),
  z.object({
    kind: z.literal('preview-node-motion'),
    target: nativeTargetSchema,
    action: nodeMotionActionSchema,
    delayMs: z.number().finite().min(0).max(60_000),
  }).strict(),
  z.object({
    kind: z.literal('runtime-content'),
    target: runtimeContentTargetSchema,
    value: z.string().max(1_000_000),
  }).strict(),
])

const commandSchema = z.object({
  type: z.literal(PLAYER_AUTHORING_MESSAGE_TYPES.patch),
  protocolVersion: z.literal(PLAYER_AUTHORING_PROTOCOL_VERSION),
  sessionId: identifier,
  requestId: identifier,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  context: contextSchema,
  patch: patchSchema,
}).strict()

export type PlayerAuthoringCommandParseResult =
  | { ok: true; command: PlayerAuthoringPatchCommand }
  | { ok: false; message: string }

export type PlayerAuthoringReadyParseResult =
  | { ok: true; ready: PlayerAuthoringReadyMessage }
  | { ok: false; message: string }

export interface PlayerAuthoringSnapshotBarrier {
  sessionId: string
  requestId: string
  revision: number
  context: PlayerAuthoringContext
  target: PlayerAuthoringTarget
}

export function playerAuthoringSnapshotBarrierForCommand(
  command: PlayerAuthoringPatchCommand,
): PlayerAuthoringSnapshotBarrier {
  return {
    sessionId: command.sessionId,
    requestId: command.requestId,
    revision: command.revision,
    context: command.context,
    target: command.patch.target,
  }
}

function firstParseIssueMessage(
  result: { error: z.ZodError },
  fallback: string,
): string {
  const issue = result.error.issues[0]
  const path = issue?.path.length ? `${issue.path.join('.')}：` : ''
  return `${path}${issue?.message ?? fallback}`
}

/**
 * Treat postMessage input as hostile structured data. Successful parsing also
 * strips no fields: every envelope, target and patch object is strict.
 */
export function parsePlayerAuthoringPatchCommand(
  value: unknown,
): PlayerAuthoringCommandParseResult {
  const result = commandSchema.safeParse(value)
  if (result.success) {
    return {
      ok: true,
      command: result.data as PlayerAuthoringPatchCommand,
    }
  }
  return {
    ok: false,
    message: firstParseIssueMessage(result, '编辑命令格式无效'),
  }
}

/** Validates the complete authoring handshake against one declared host capability set. */
export function parsePlayerAuthoringReadyMessage(
  value: unknown,
): PlayerAuthoringReadyParseResult {
  const result = readySchema.safeParse(value)
  if (!result.success) {
    return {
      ok: false,
      message: firstParseIssueMessage(result, '编辑画布握手格式无效'),
    }
  }
  const { token: _transportToken, ...ready } = result.data
  return {
    ok: true,
    ready: ready as PlayerAuthoringReadyMessage,
  }
}

function authoringTargetsEqual(
  actual: PlayerAuthoringTarget,
  expected: PlayerAuthoringTarget,
): boolean {
  return actual.kind === expected.kind &&
    actual.scope === expected.scope &&
    (actual.kind !== 'native-node' ||
      (expected.kind === 'native-node' && actual.nodeId === expected.nodeId)) &&
    (actual.kind !== 'runtime-content' || (
      expected.kind === 'runtime-content'
      && actual.nodeId === expected.nodeId
      && actual.key === expected.key
    ))
}

/** Only the exact ACK for the snapshot's final command opens the edit canvas. */
export function isPlayerAuthoringSnapshotAck(
  value: unknown,
  barrier: PlayerAuthoringSnapshotBarrier,
): boolean {
  const result = ackSchema.safeParse(value)
  if (!result.success) return false
  const ack = result.data
  return ack.sessionId === barrier.sessionId &&
    ack.requestId === barrier.requestId &&
    ack.revision === barrier.revision &&
    ack.context.sceneId === barrier.context.sceneId &&
    ack.context.stateId === barrier.context.stateId &&
    authoringTargetsEqual(ack.target, barrier.target)
}

export function authoringTargetForPatch(
  patch: PlayerAuthoringPatch,
): PlayerAuthoringTarget {
  return patch.target
}
