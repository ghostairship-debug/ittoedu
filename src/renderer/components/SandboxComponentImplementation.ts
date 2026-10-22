import type { CompiledComponentModule } from '../../core/components/compilation/types'
import { preparePublishedNativeComponent, type SandboxRuntimeSnapshots } from '../../player/components/runtime/SandboxComponentRuntime'
import { flowContentClientMatrix } from '../ui/flow/flowParagraphLayout'
import { createHtmlSourceLocator } from '../../shared/html/htmlSourceLocator'
import { COMPONENT_AUTHOR_HIT } from './componentAuthorHit'

export type { RuntimeTargetSnapshot, ComponentBootstrapTransport } from '../../player/components/runtime/SandboxComponentRuntime'

/** Renderer composer only; the same scope/RPC/realm lifecycle also serves Published. */
export function prepareSandboxComponent(artifact: CompiledComponentModule, signal: AbortSignal, snapshots: SandboxRuntimeSnapshots) {
  let authorSource: string | undefined
  let authorLocator: ReturnType<typeof createHtmlSourceLocator> | undefined
  const locateTarget: NonNullable<NonNullable<SandboxRuntimeSnapshots['hostAdapter']>['locateTarget']> = (source, report, identity) => {
    if (source !== authorSource || !authorLocator) { authorSource = source; authorLocator = createHtmlSourceLocator(source) }
    return authorLocator.locateTarget(report, identity)
  }
  const desktop = window.desktopAPI
  const bootstrap = snapshots.bootstrap ?? (typeof desktop?.createComponentBootstrap === 'function'
    && typeof desktop?.releaseComponentBootstrap === 'function' ? {
      createComponentBootstrap: (input: Parameters<NonNullable<typeof desktop.createComponentBootstrap>>[0]) => desktop.createComponentBootstrap!(input),
      releaseComponentBootstrap: (input: Parameters<NonNullable<typeof desktop.releaseComponentBootstrap>>[0]) => desktop.releaseComponentBootstrap!(input),
    } : undefined)
  return preparePublishedNativeComponent(artifact, signal, { ...snapshots, bootstrap,
    hostAdapter: { clientMatrix: flowContentClientMatrix, locateTarget, authorHitEvent: COMPONENT_AUTHOR_HIT, ...snapshots.hostAdapter } })
}
