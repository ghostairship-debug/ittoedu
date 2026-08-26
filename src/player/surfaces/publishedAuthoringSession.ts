import type { ComponentAuthoringTargetUpdate } from '../../shared/componentTypes'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  PUBLISHED_AUTHORING_CAPABILITIES,
  parsePlayerAuthoringPatchCommand,
  type PlayerAuthoringAckMessage,
  type PlayerAuthoringContext,
  type PlayerAuthoringErrorCode,
  type PlayerAuthoringErrorMessage,
  type PlayerAuthoringHostMessage,
  type PlayerAuthoringPatch,
  type PlayerAuthoringPatchCommand,
  type PlayerAuthoringReadyMessage,
  type PlayerAuthoringTarget,
  type PlayerComponentAuthoringTargetsMessage,
  type PlayerRuntimeAuthoringTargetsMessage,
} from '../../shared/playerAuthoringProtocol'
import type { RuntimeAuthoringTargetUpdate } from '../../shared/runtimeTypes'

export type PublishedAuthoringPatchResult =
  | {
      ok: true
      target: PlayerAuthoringTarget
    }
  | {
      ok: false
      code: PlayerAuthoringErrorCode
      message: string
    }

/**
 * The Published surface owns transient painting; this coordinator only owns
 * the existing authoring protocol's session, ordering, and response rules.
 */
export interface PublishedAuthoringPatchSurface {
  getAuthoringContext(): PlayerAuthoringContext
  applyAuthoringPatch(
    context: PlayerAuthoringContext,
    patch: PlayerAuthoringPatch,
  ): Promise<PublishedAuthoringPatchResult> | PublishedAuthoringPatchResult
}

export interface PublishedAuthoringSessionCoordinatorOptions {
  sessionId: string
  surface: PublishedAuthoringPatchSurface
  onMessage?: (message: PlayerAuthoringHostMessage) => void
}

function authoringError(
  value: unknown,
  code: PlayerAuthoringErrorCode,
  message: string,
): PlayerAuthoringErrorMessage {
  const candidate = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
  return {
    type: PLAYER_AUTHORING_MESSAGE_TYPES.error,
    protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
    ...(typeof candidate.sessionId === 'string'
      ? { sessionId: candidate.sessionId }
      : {}),
    ...(typeof candidate.requestId === 'string'
      ? { requestId: candidate.requestId }
      : {}),
    ...(typeof candidate.revision === 'number'
      ? { revision: candidate.revision }
      : {}),
    code,
    message,
  }
}

function describeState(stateId: string | null): string {
  return stateId === null ? '基础状态' : `状态“${stateId}”`
}

/**
 * Direct, same-document replacement for the former iframe bridge. It keeps
 * the V1 wire contract so Workspace can retain one revision/ACK state machine.
 */
export class PublishedAuthoringSessionCoordinator {
  readonly #sessionId: string
  readonly #surface: PublishedAuthoringPatchSurface
  readonly #onMessage?: (message: PlayerAuthoringHostMessage) => void
  #queue: Promise<void> = Promise.resolve()
  #lastAppliedRevision = -1
  #targetMessageRevision = 0
  #ready = false
  #destroyed = false
  #lifecycleRevision = 0

  constructor(options: PublishedAuthoringSessionCoordinatorOptions) {
    this.#sessionId = options.sessionId
    this.#surface = options.surface
    this.#onMessage = options.onMessage
  }

  markReady(): PlayerAuthoringReadyMessage {
    if (this.#destroyed) {
      throw new Error('Published 编辑会话已销毁，不能重新就绪。')
    }
    const context = this.#surface.getAuthoringContext()
    const message: PlayerAuthoringReadyMessage = {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ready,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      context: { ...context },
      capabilities: PUBLISHED_AUTHORING_CAPABILITIES,
    }
    this.#ready = true
    this.#publish(message)
    return message
  }

  apply(
    value: unknown,
  ): Promise<PlayerAuthoringAckMessage | PlayerAuthoringErrorMessage> {
    const execute = async (): Promise<
      PlayerAuthoringAckMessage | PlayerAuthoringErrorMessage
    > => {
      const response = await this.#applyQueued(value)
      this.#publish(response)
      return response
    }
    const response = this.#queue.then(execute, execute)
    this.#queue = response.then(
      () => undefined,
      () => undefined,
    )
    return response
  }

  publishRuntimeTargets(update: Readonly<RuntimeAuthoringTargetUpdate>): void {
    if (this.#destroyed) return
    const message: PlayerRuntimeAuthoringTargetsMessage = {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      revision: ++this.#targetMessageRevision,
      update,
    }
    this.#publish(message)
  }

  publishComponentTargets(
    update: Readonly<ComponentAuthoringTargetUpdate>,
  ): void {
    if (this.#destroyed) return
    const message: PlayerComponentAuthoringTargetsMessage = {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      revision: ++this.#targetMessageRevision,
      update,
    }
    this.#publish(message)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#ready = false
    this.#lifecycleRevision += 1
  }

  async #applyQueued(
    value: unknown,
  ): Promise<PlayerAuthoringAckMessage | PlayerAuthoringErrorMessage> {
    const parsed = parsePlayerAuthoringPatchCommand(value)
    if (!parsed.ok) {
      return authoringError(value, 'invalid-command', parsed.message)
    }
    const command = parsed.command
    if (command.sessionId !== this.#sessionId) {
      return authoringError(
        command,
        'invalid-session',
        '编辑命令不属于当前 Published 编辑会话。',
      )
    }
    if (this.#destroyed || !this.#ready) {
      return this.#notReady(command)
    }

    let currentContext: PlayerAuthoringContext
    try {
      currentContext = this.#surface.getAuthoringContext()
    } catch (error) {
      return authoringError(
        command,
        'update-failed',
        `无法读取 Published 编辑上下文：${this.#errorDetail(error)}`,
      )
    }
    if (command.context.sceneId !== currentContext.sceneId) {
      return authoringError(
        command,
        'scene-mismatch',
        `编辑命令场景“${command.context.sceneId}”与当前场景“${currentContext.sceneId}”不一致。`,
      )
    }
    if (command.context.stateId !== currentContext.stateId) {
      return authoringError(
        command,
        'state-mismatch',
        `编辑命令${describeState(command.context.stateId)}与当前${describeState(currentContext.stateId)}不一致。`,
      )
    }
    if (command.revision <= this.#lastAppliedRevision) {
      return authoringError(
        command,
        'stale-revision',
        `编辑修订 ${command.revision} 已过期，当前已应用 ${this.#lastAppliedRevision}。`,
      )
    }

    const lifecycleRevision = this.#lifecycleRevision
    let result: PublishedAuthoringPatchResult
    try {
      result = await this.#surface.applyAuthoringPatch(
        command.context,
        command.patch,
      )
    } catch (error) {
      if (
        this.#destroyed ||
        lifecycleRevision !== this.#lifecycleRevision
      ) {
        return this.#notReady(command)
      }
      return authoringError(
        command,
        'update-failed',
        `Published 编辑画面更新失败：${this.#errorDetail(error)}`,
      )
    }
    if (
      this.#destroyed ||
      lifecycleRevision !== this.#lifecycleRevision
    ) {
      return this.#notReady(command)
    }
    if (!result.ok) {
      return authoringError(command, result.code, result.message)
    }

    this.#lastAppliedRevision = command.revision
    return {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.ack,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: command.sessionId,
      requestId: command.requestId,
      revision: command.revision,
      context: { ...command.context },
      target: result.target,
    }
  }

  #notReady(command: PlayerAuthoringPatchCommand): PlayerAuthoringErrorMessage {
    return authoringError(
      command,
      'not-ready',
      this.#destroyed
        ? 'Published 编辑会话已销毁。'
        : 'Published 编辑宿主尚未就绪。',
    )
  }

  #publish(message: PlayerAuthoringHostMessage): void {
    if (this.#destroyed) return
    try {
      this.#onMessage?.(message)
    } catch {
      // Delivery is observational. A consumer failure must not corrupt the
      // coordinator's successful revision or serial command queue.
    }
  }

  #errorDetail(error: unknown): string {
    return error instanceof Error && error.message.trim()
      ? error.message
      : String(error)
  }
}
