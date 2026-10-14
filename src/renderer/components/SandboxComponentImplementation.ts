import type { CompiledComponentModule } from '../../core/components/compilation/types'
import { preparePublishedNativeComponent, type SandboxRuntimeSnapshots } from '../../player/components/runtime/SandboxComponentRuntime'
import { flowContentClientMatrix } from '../ui/flow/flowParagraphLayout'
import { locateHtmlSourceTarget } from '../../main/workbench/htmlPreview/htmlSourceLocator'
import { COMPONENT_AUTHOR_HIT } from './componentAuthorHit'

export type { RuntimeTargetSnapshot, ComponentBootstrapTransport } from '../../player/components/runtime/SandboxComponentRuntime'

/** Renderer composer only; the same scope/RPC/realm lifecycle also serves Published. */
export function prepareSandboxComponent(artifact: CompiledComponentModule, signal: AbortSignal, snapshots: SandboxRuntimeSnapshots) {
  const desktop = window.desktopAPI
  const bootstrap = snapshots.bootstrap ?? (typeof desktop?.createComponentBootstrap === 'function'
    && typeof desktop?.releaseComponentBootstrap === 'function' ? {
      createComponentBootstrap: (input: Parameters<NonNullable<typeof desktop.createComponentBootstrap>>[0]) => desktop.createComponentBootstrap!(input),
      releaseComponentBootstrap: (input: Parameters<NonNullable<typeof desktop.releaseComponentBootstrap>>[0]) => desktop.releaseComponentBootstrap!(input),
    } : undefined)
  return preparePublishedNativeComponent(artifact, signal, { ...snapshots, bootstrap,
    hostAdapter: { clientMatrix: flowContentClientMatrix, locateTarget: locateHtmlSourceTarget, authorHitEvent: COMPONENT_AUTHOR_HIT, ...snapshots.hostAdapter } })
}
