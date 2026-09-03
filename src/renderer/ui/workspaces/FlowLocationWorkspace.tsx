import { useEffect, useRef } from 'react'
import { MousePointer2, Play } from 'lucide-react'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import {
  assertActiveFlowEditorView,
  type FlowEditorView,
} from '../../course/flowEditorView'
import type { FlowTextEditSession } from '../../authoring/flowTextEdit'
import type { CourseAuthoringSessionToken } from '../../authoring/courseAuthoringSession'
import {
  attachPublishedCourseStageFit,
} from '../coursePlayerTryRun'
import {
  beginSerializedSessionMount,
  enqueueSerial,
} from '../serializedSessionMount'
import { FlowWorkspace } from '../FlowWorkspace'
import type { FlowCurrentSessionCommandPort } from '../flow/useFlowTextAuthoringController'

export type FlowCanvasMode = 'edit' | 'run'
export type FlowEditingScope = 'scene' | 'global'
export interface FlowTryRunSession {
  destroy(): void | Promise<void>
}

export interface FlowLocationWorkspaceProps {
  readonly view: FlowEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly selection: FlowEditorSelection | null
  readonly textEdit: FlowTextEditSession | null
  readonly canvasMode: FlowCanvasMode
  readonly editingScope: FlowEditingScope
  readonly assetFiles: Record<string, Uint8Array>
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly commands: FlowCurrentSessionCommandPort
  readonly onCanvasModeChange: (mode: FlowCanvasMode) => void
  readonly onMountTryRun: (container: HTMLElement) => Promise<FlowTryRunSession>
}

export function FlowLocationWorkspace({
  view,
  sessionToken,
  assets,
  selection,
  textEdit,
  canvasMode,
  editingScope,
  assetFiles,
  componentPackages,
  commands,
  onCanvasModeChange,
  onMountTryRun,
}: FlowLocationWorkspaceProps) {
  const tryRunRef = useRef<HTMLDivElement>(null)
  const tryRunMountChainRef = useRef(Promise.resolve())
  const hostRef = useRef<FlowTryRunSession | null>(null)
  const tryRunFitRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const container = tryRunRef.current
    if (!container) return
    if (canvasMode !== 'run') {
      tryRunFitRef.current?.()
      tryRunFitRef.current = null
      const leftover = hostRef.current
      hostRef.current = null
      if (leftover) enqueueSerial(tryRunMountChainRef, async () => {
        await leftover.destroy()
      })
      return
    }
    return beginSerializedSessionMount(tryRunMountChainRef, () => onMountTryRun(container), {
      onReady: (mounted) => {
        hostRef.current = mounted
        tryRunFitRef.current?.()
        tryRunFitRef.current = attachPublishedCourseStageFit(container)
      },
      onCleanup: () => {
        tryRunFitRef.current?.()
        tryRunFitRef.current = null
        hostRef.current = null
      },
    })
  }, [canvasMode, onMountTryRun, view])

  useEffect(() => () => {
    enqueueSerial(tryRunMountChainRef, async () => {
      await hostRef.current?.destroy()
      hostRef.current = null
    })
  }, [])

  assertActiveFlowEditorView(view)

  return (
    <main
      className={`workspace workspace--${canvasMode} workspace--flow`}
      data-testid="flow-workspace-shell"
      data-flow-not-slide-stage="true"
    >
      <div className="canvas-mode-switch" role="group" aria-label="画布模式">
        <button
          type="button"
          className={canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'edit'}
          onClick={() => onCanvasModeChange('edit')}
        >
          <MousePointer2 size={13} />编辑状态
        </button>
        <button
          type="button"
          className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'run'}
          onClick={() => onCanvasModeChange('run')}
        >
          <Play size={13} />当前位置试运行
        </button>
      </div>
      <div className={`canvas-label${editingScope === 'global' ? ' canvas-label--global' : ''}`}>
        {editingScope === 'global' ? '全局层 · 视口浮层' : view.surfaceTitle}
      </div>
      <div className="canvas-viewport">
        {canvasMode === 'edit' ? (
          <FlowWorkspace
            view={view}
            sessionToken={sessionToken}
            assets={assets}
            selection={selection}
            textEdit={textEdit}
            commands={commands}
            assetFiles={assetFiles}
            componentPackages={componentPackages}
          />
        ) : null}
        <div
          ref={tryRunRef}
          className="flow-try-run-host"
          data-testid="flow-try-run-host"
          hidden={canvasMode !== 'run'}
        />
      </div>
    </main>
  )
}
