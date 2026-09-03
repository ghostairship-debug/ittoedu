import { useReducer, useRef, type ComponentProps } from 'react'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import {
  buildCourseAuthoringSessionForProject,
  updateCourseAuthoringSessionItems,
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringSession,
} from '../../src/renderer/authoring/courseAuthoringSession'
import type { FlowTextEditSession } from '../../src/renderer/authoring/flowTextEdit'
import {
  buildFlowEditorView,
  type FlowEditorView,
} from '../../src/renderer/course/flowEditorView'
import {
  commitFlowEditorHistory,
  createFlowEditorHistory,
  selectFlowEditorBlock,
  type FlowEditorHistory,
  type FlowEditorSelection,
} from '../../src/renderer/course/flowEditorSlice'
import type {
  FlowCommandResult,
  FlowDeleteRequest,
} from '../../src/renderer/course/flowEditorCommands'
import type { FlowSharedAuthoringResult } from '../../src/renderer/course/flowSharedAuthoringAdapters'
import {
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  type CourseAssetSidecar,
} from '../../src/renderer/project/v9AssetAdapter'
import {
  createFlowAuthoringSlice,
  type FlowApplyBackendExtra,
  type FlowAuthoringIntent,
  type FlowAuthoringReceipt,
  type FlowPersistExtra,
} from '../../src/renderer/store/slices/flowAuthoringSlice'
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'

interface HarnessState {
  history: FlowEditorHistory
  selection: FlowEditorSelection
  textEdit: FlowTextEditSession | null
  authoringSession: CourseAuthoringSession
  sidecar: CourseAssetSidecar
}

export interface FlowWorkspaceTestHarnessProps {
  readonly project: CourseProjectDocument
  readonly view: FlowEditorView
  readonly selection: FlowEditorSelection | null
  readonly textEdit?: FlowTextEditSession | null
  readonly readOnly?: boolean
  readonly assetFiles?: Record<string, Uint8Array>
  readonly componentPackages?: Record<string, ComponentPackageData>
  readonly onProjectChange?: (result: FlowCommandResult | FlowSharedAuthoringResult) => void
  readonly onDeleteRequest?: (request: FlowDeleteRequest) => FlowCommandResult | void
  readonly onSelectionChange?: (selection: FlowEditorSelection | null) => void
  readonly onTextEditChange?: (edit: FlowTextEditSession | null) => void
}

function initialSelection(
  project: CourseProjectDocument,
  view: FlowEditorView,
  selection: FlowEditorSelection | null,
): FlowEditorSelection {
  return selection ?? selectFlowEditorBlock(project, view.locationId, view.activeBlockId)
}

function initialState(props: FlowWorkspaceTestHarnessProps): HarnessState {
  const selection = initialSelection(props.project, props.view, props.selection)
  return {
    history: createFlowEditorHistory(props.project),
    selection,
    textEdit: props.textEdit ?? null,
    authoringSession: buildCourseAuthoringSessionForProject(
      props.project,
      selection.locationId,
      selection.selectedOverlayIds.length > 0
        ? selection.selectedOverlayIds
        : selection.selectedBlockIds,
    ),
    sidecar: freezeCourseAssetSidecar(props.assetFiles ?? {}),
  }
}

const PROJECT_INTENTS = new Set<FlowAuthoringIntent['kind']>([
  'commit-text-edit',
  'format-text-style',
  'format-block',
  'execute-editor-command',
  'delete-blocks',
  'transform-overlay-frame',
  'commit-block-formula',
  'rename-page',
  'set-paper-background',
  'patch-block',
  'replace-media-asset',
  'import-replacement-media',
  'move-block',
  'convert-block-to-overlay',
  'convert-overlay-to-document',
  'patch-overlay-paper-space',
  'commit-overlay-formula',
])

/**
 * Legacy-callback adapter used only while the old component tests are migrated.
 * The product component still receives only immutable views and the typed port.
 */
export function FlowWorkspaceTestHarness(props: FlowWorkspaceTestHarnessProps) {
  const [, forceRender] = useReducer((value: number) => value + 1, 0)
  const propsRef = useRef(props)
  propsRef.current = props
  const stateRef = useRef<HarnessState>(initialState(props))
  const lastProjectRef = useRef(props.project)
  const lastSelectionRef = useRef(props.selection)
  const lastTextEditRef = useRef(props.textEdit)

  if (lastProjectRef.current !== props.project) {
    stateRef.current = initialState(props)
    lastProjectRef.current = props.project
    lastSelectionRef.current = props.selection
    lastTextEditRef.current = props.textEdit
  } else {
    if (lastSelectionRef.current !== props.selection && props.selection) {
      stateRef.current.selection = props.selection
      stateRef.current.authoringSession = updateCourseAuthoringSessionItems(
        stateRef.current.authoringSession,
        props.selection.selectedOverlayIds.length > 0
          ? props.selection.selectedOverlayIds
          : props.selection.selectedBlockIds,
      )
      lastSelectionRef.current = props.selection
    }
    if (lastTextEditRef.current !== props.textEdit && props.textEdit !== undefined) {
      stateRef.current.textEdit = props.textEdit
      lastTextEditRef.current = props.textEdit
    }
  }

  const sliceRef = useRef<ReturnType<typeof createFlowAuthoringSlice> | null>(null)
  if (!sliceRef.current) {
    sliceRef.current = createFlowAuthoringSlice({} as never, {
      read: () => ({
        flowSession: {
          history: stateRef.current.history,
          selection: stateRef.current.selection,
        },
        flowTextEdit: stateRef.current.textEdit,
      }),
      readAuthoringSession: () => stateRef.current.authoringSession,
      readAssetSidecar: () => stateRef.current.sidecar,
      patch: (patch) => {
        if (patch.flowTextEdit !== undefined) stateRef.current.textEdit = patch.flowTextEdit
        forceRender()
      },
      persist: (result, extra: FlowPersistExtra = {}) => {
        if (!result.ok) return result
        const current = stateRef.current
        const nextDocument = extra.replaceHistory?.present
          ?? result.nextDocument
          ?? current.history.present
        current.history = extra.replaceHistory ?? (result.historyEntry
          ? commitFlowEditorHistory(current.history, nextDocument)
          : { ...current.history, present: nextDocument })
        current.selection = extra.selection
          ?? result.selection
          ?? current.selection
        current.textEdit = extra.textEdit !== undefined
          ? extra.textEdit
          : extra.clearTextEdit
            ? null
            : current.textEdit
        if (extra.sidecar) current.sidecar = extra.sidecar
        current.authoringSession = updateCourseAuthoringSessionItems(
          updateCourseAuthoringSessionRevision(
            current.authoringSession,
            current.history.present.revision,
          ),
          current.selection.selectedOverlayIds.length > 0
            ? current.selection.selectedOverlayIds
            : current.selection.selectedBlockIds,
        )
        forceRender()
        return result
      },
      applyBackend: (
        session,
        extra: FlowApplyBackendExtra = {},
      ) => {
        stateRef.current.history = session.history
        stateRef.current.selection = session.selection
        stateRef.current.textEdit = null
        stateRef.current.sidecar = extra.sidecar ?? emptyCourseAssetSidecar()
        stateRef.current.authoringSession = buildCourseAuthoringSessionForProject(
          session.history.present,
          session.selection.locationId,
        )
        forceRender()
      },
    })
  }

  const commandsRef = useRef<{ run(target: Parameters<NonNullable<typeof sliceRef.current>['runFlowAuthoringIntent']>[0], intent: FlowAuthoringIntent): FlowAuthoringReceipt } | null>(null)
  if (!commandsRef.current) {
    commandsRef.current = {
      run: (target, intent) => {
        const before = stateRef.current
        const beforeSelection = before.selection
        const beforeEdit = before.textEdit
        if (intent.kind === 'delete-blocks') {
          propsRef.current.onDeleteRequest?.({
            selection: beforeSelection,
            expectedRevision: target.documentRevision,
            deleteSelectedBlocks: true,
            ...(intent.direction ? { direction: intent.direction } : {}),
          })
        }
        const receipt = sliceRef.current!.runFlowAuthoringIntent(target, intent)
        const after = stateRef.current
        if (
          after.selection !== beforeSelection
          && !(
            (intent.kind === 'begin-text-edit' || intent.kind === 'begin-formula-edit')
            && beforeSelection.focus === 'text'
          )
        ) {
          propsRef.current.onSelectionChange?.(after.selection)
        }
        if (!Object.is(after.textEdit, beforeEdit)) {
          propsRef.current.onTextEditChange?.(after.textEdit)
        }
        if (PROJECT_INTENTS.has(intent.kind) && !(intent.kind === 'delete-blocks' && propsRef.current.onDeleteRequest)) {
          propsRef.current.onProjectChange?.({
            ok: receipt.ok,
            ...(receipt.reason ? { reason: receipt.reason } : {}),
            historyEntry: receipt.historyEntry,
            ...(receipt.ok ? { nextDocument: after.history.present, selection: after.selection } : {}),
          })
        }
        return receipt
      },
    }
  }

  const current = stateRef.current
  const currentView = current.history.present === props.project
    ? props.view
    : buildFlowEditorView({
        project: current.history.present,
        locationId: current.selection.locationId,
      })
  const workspaceProps: ComponentProps<typeof FlowWorkspace> = {
    view: currentView,
    sessionToken: current.authoringSession.token,
    assets: current.history.present.assets,
    selection: current.selection,
    textEdit: current.textEdit,
    commands: commandsRef.current,
    ...(props.readOnly === undefined ? {} : { readOnly: props.readOnly }),
    ...(props.assetFiles ? { assetFiles: props.assetFiles } : {}),
    ...(props.componentPackages ? { componentPackages: props.componentPackages } : {}),
  }
  return <FlowWorkspace {...workspaceProps} />
}
