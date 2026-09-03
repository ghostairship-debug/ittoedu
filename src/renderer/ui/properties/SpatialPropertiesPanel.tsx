import { Palette } from 'lucide-react'
import type {
  LayerItem,
  SpatialPathDocument,
  SpatialPathStyle,
  SpatialRelationKind,
  SpatialSemanticZoomRule,
} from '../../../shared/courseProjectTypes'
import {
  spatialEditorWorldLayerItems,
  type SpatialEditorView,
  type SpatialSessionCamera,
} from '../../course/spatialEditorView'
import { ColorInput } from '../ColorInput'
import { SpatialCameraPanel } from '../SpatialCameraPanel'
import { SpatialPathEditor } from '../SpatialPathEditor'
import { FlowSpatialInteractionUnavailableSection } from './FlowSpatialInteractionUnavailableSection'

export type SpatialPropertiesKind = 'spatial-page' | 'spatial-graph'

export interface SpatialPropertiesCommands {
  readonly setBackgroundColor: (backgroundColor: string) => void
  readonly setShowCameraFrames: (show: boolean) => void
  readonly addCameraFrame: () => void
  readonly renameCameraFrame: (frameId: string, name: string) => void
  readonly reorderCameraFrame: (frameId: string, toIndex: number) => void
  readonly deleteCameraFrame: (frameId: string) => void
  readonly setHome: () => void
  readonly updateActiveFromSession: () => void
  readonly activateFrame: (frameId: string) => void
  readonly fitWorldContent: () => void
  readonly setPlaybackPathId: (pathId: string | null) => void
  readonly addSemanticZoomRule: (rule: {
    layerItemIds: string[]
    minZoom: number
    maxZoom: number
    visible: boolean
  }) => void
  readonly updateSemanticZoomRule: (
    ruleId: string,
    patch: Partial<Omit<SpatialSemanticZoomRule, 'id'>>,
  ) => void
  readonly deleteSemanticZoomRule: (ruleId: string) => void
  readonly addPath: (input: {
    name: string
    layerItemIds: string[]
    style?: SpatialPathStyle
  }) => void
  readonly renamePath: (pathId: string, name: string) => void
  readonly updatePathStyle: (pathId: string, style: SpatialPathStyle) => void
  readonly reorderPathWaypoints: (pathId: string, layerItemIds: string[]) => void
  readonly deletePath: (pathId: string) => void
  readonly addRelation: (input: {
    sourceLayerItemId: string
    targetLayerItemId: string
    kind: SpatialRelationKind
    label?: string
  }) => void
  readonly updateRelationLabel: (relationId: string, label: string) => void
  readonly updateRelationKind: (relationId: string, kind: SpatialRelationKind) => void
  readonly deleteRelation: (relationId: string) => void
  readonly reportError: (message: string) => void
}

export interface SpatialPropertiesDraftBindings {
  readonly surface: string
  readonly cameraFrames: ReadonlyMap<string, string>
  readonly paths: ReadonlyMap<string, string>
  readonly relations: ReadonlyMap<string, string>
  readonly semanticRules: ReadonlyMap<string, string>
}

export interface SpatialPropertiesContext {
  readonly kind: SpatialPropertiesKind
  readonly view: SpatialEditorView
  readonly sessionCamera: SpatialSessionCamera
  readonly showCameraFrames: boolean
  readonly playbackPathId: string | null
  readonly selectedPathId: string | null
  readonly selectedRelationId: string | null
  readonly draftBindings: SpatialPropertiesDraftBindings
  readonly commands: SpatialPropertiesCommands
  readonly professionalInteraction?: {
    readonly editingScopeGlobal: boolean
    readonly onOpenAutomation: () => void
  } | null
}

function worldLayerItemsFromView(view: SpatialEditorView): LayerItem[] {
  return spatialEditorWorldLayerItems(view).map((item) => item as LayerItem)
}

function pathsFromView(view: SpatialEditorView): SpatialPathDocument[] {
  return view.worldGraph.paths.map((entry) => entry.path as SpatialPathDocument)
}

function semanticZoomFromView(view: SpatialEditorView): SpatialSemanticZoomRule[] {
  return view.visibilityRules.map((rule) => rule as SpatialSemanticZoomRule)
}

function SpatialPathRelationFields({
  context,
  pageSection,
}: {
  context: SpatialPropertiesContext
  pageSection?: boolean
}) {
  const { view, commands } = context
  return (
    <SpatialPathEditor
      surfaceTitle={view.surfaceTitle}
      worldLayerItems={worldLayerItemsFromView(view)}
      paths={pathsFromView(view)}
      relations={view.worldGraph.relations.map((entry) => entry.relation)}
      pageSection={pageSection}
      selectedPathId={context.selectedPathId}
      selectedRelationId={context.selectedRelationId}
      draftBindingKey={context.draftBindings.surface}
      pathDraftBindings={context.draftBindings.paths}
      relationDraftBindings={context.draftBindings.relations}
      onDraftStale={() => commands.reportError('属性草稿对应的编辑目标已经改变，请重新编辑。')}
      onAddPath={commands.addPath}
      onRenamePath={commands.renamePath}
      onUpdatePathStyle={commands.updatePathStyle}
      onReorderPathWaypoints={commands.reorderPathWaypoints}
      onDeletePath={commands.deletePath}
      onAddRelation={commands.addRelation}
      onUpdateRelationLabel={commands.updateRelationLabel}
      onUpdateRelationKind={commands.updateRelationKind}
      onDeleteRelation={commands.deleteRelation}
    />
  )
}

function SpatialPageProperties({ context }: { context: SpatialPropertiesContext }) {
  const { view, sessionCamera, commands } = context
  return (
    <>
      <section className="property-section" data-testid="spatial-page-properties">
        <h3 className="property-title"><Palette size={14} />空间画布</h3>
        <ColorInput
          id="spatial-canvas-background"
          data-testid="spatial-canvas-background"
          label="画布背景色"
          value={view.backgroundColor}
        onChange={commands.setBackgroundColor}
          key={context.draftBindings.surface}
        />
      </section>
      <SpatialCameraPanel
        surfaceTitle={view.surfaceTitle}
        frames={[...view.camera.frames]}
        home={view.camera.home}
        sessionCamera={sessionCamera}
        activeCameraFrameId={view.camera.activeFrameId}
        showCameraFrames={context.showCameraFrames}
        worldLayerItems={worldLayerItemsFromView(view)}
        paths={pathsFromView(view)}
        playbackPathId={context.playbackPathId}
        semanticZoomRules={semanticZoomFromView(view)}
        sessionCameraLabel={`${Math.round(sessionCamera.zoom * 100)}%`}
        draftBindingKey={context.draftBindings.surface}
        frameDraftBindings={context.draftBindings.cameraFrames}
        semanticRuleDraftBindings={context.draftBindings.semanticRules}
        onDraftStale={() => commands.reportError('属性草稿对应的编辑目标已经改变，请重新编辑。')}
        onShowCameraFramesChange={commands.setShowCameraFrames}
        onAddFrame={commands.addCameraFrame}
        onRenameFrame={commands.renameCameraFrame}
        onReorderFrame={commands.reorderCameraFrame}
        onDeleteFrame={commands.deleteCameraFrame}
        onSetHome={commands.setHome}
        onUpdateActiveFromSession={commands.updateActiveFromSession}
        onActivateFrame={commands.activateFrame}
        onFitWorldContent={commands.fitWorldContent}
        onPlaybackPathIdChange={commands.setPlaybackPathId}
        onAddSemanticZoomRule={commands.addSemanticZoomRule}
        onUpdateSemanticZoomRule={commands.updateSemanticZoomRule}
        onDeleteSemanticZoomRule={commands.deleteSemanticZoomRule}
      />
      <SpatialPathRelationFields context={context} pageSection />
    </>
  )
}

export function SpatialPropertiesPanel({ context }: { context: SpatialPropertiesContext }) {
  if (context.kind === 'spatial-graph') {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <SpatialPathRelationFields context={context} />
        {context.professionalInteraction && (
          <FlowSpatialInteractionUnavailableSection {...context.professionalInteraction} />
        )}
      </div>
    )
  }
  return (
    <div className="properties-scroll" data-testid="properties-tab">
      <SpatialPageProperties context={context} />
      {context.professionalInteraction && (
        <FlowSpatialInteractionUnavailableSection {...context.professionalInteraction} />
      )}
    </div>
  )
}
