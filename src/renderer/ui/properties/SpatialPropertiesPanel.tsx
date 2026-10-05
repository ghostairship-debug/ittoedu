import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { ComponentInstance, ComponentSpatialAuthoring, ComponentSpatialPose } from '../../../shared/contracts/component-platform'
type SpatialPathDocument = NonNullable<ComponentSpatialAuthoring['paths']>[number]
type SpatialPathStyle = NonNullable<SpatialPathDocument['style']>
type SpatialRelationKind = NonNullable<ComponentSpatialAuthoring['relations']>[number]['kind']
type SpatialSemanticZoomRule = NonNullable<ComponentSpatialAuthoring['semanticZoom']>[number]
import {
  type CourseBackgroundFields,
  type SpatialSurfaceBackgroundFields,
} from '../../../shared/effectiveBackground'
import type { propertiesEffectiveBackground } from './componentProperties'
import { SpatialCameraPanel } from '../SpatialCameraPanel'
import { SpatialPathEditor } from '../SpatialPathEditor'
import { FlowSpatialInteractionUnavailableSection } from './FlowSpatialInteractionUnavailableSection'
import { SharedBackgroundProperties } from './SharedBackgroundProperties'

export type SpatialPropertiesKind = 'spatial-page' | 'spatial-graph'

export interface SpatialPropertiesCommands {
  readonly setBackgroundColor: (backgroundColor: string) => void
  readonly updateBackground: (patch: SpatialSurfaceBackgroundFields) => void
  readonly previewBackground?: (patch: { backgroundColor?: string | null }) => void
  readonly setShowCameraFrames: (show: boolean) => void
  readonly addCameraFrame: () => void
  readonly renameCameraFrame: (frameId: string, name: string) => void
  readonly updateCameraFrameTarget?: (frameId: string, instanceId: string | null) => void
  readonly reorderCameraFrame: (frameId: string, toIndex: number) => void
  readonly deleteCameraFrame: (frameId: string) => void
  readonly setHome: () => void
  readonly updateActiveFromSession: () => void
  readonly activateFrame: (frameId: string) => void
  readonly fitWorldContent: () => void
  readonly setPlaybackPathId: (pathId: string | null) => void
  readonly addSemanticZoomRule: (rule: {
    instanceIds: string[]
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
    title: string
    instanceIds: string[]
    frameIds?: string[]
    style?: SpatialPathStyle
  }) => void | Promise<unknown>
  readonly renamePath: (pathId: string, name: string) => void
  readonly updatePathStyle: (pathId: string, style: SpatialPathStyle) => void
  readonly reorderPathWaypoints: (pathId: string, instanceIds: string[]) => void
  readonly reorderPathFrames?: (pathId: string, frameIds: string[]) => void
  readonly deletePath: (pathId: string) => void
  readonly addRelation: (input: {
    sourceInstanceId: string
    targetInstanceId: string
    kind: SpatialRelationKind
    label?: string
  }) => void | Promise<unknown>
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
  readonly view: {
    readonly surfaceId: string
    readonly surfaceTitle: string
    readonly spatial: ComponentSpatialAuthoring
    readonly worldInstances: readonly ComponentInstance[]
    readonly backgroundMode: 'inherit' | 'own'
    readonly backgroundColor?: string
    readonly backgroundAssetId?: string | null
    readonly effectiveBackground: ReturnType<typeof propertiesEffectiveBackground>
  }
  /** Course-wide background fields, needed only to resolve the Spatial surface's effective preview. */
  readonly course: CourseBackgroundFields
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly sessionCamera: ComponentSpatialPose
  readonly showCameraFrames: boolean
  readonly activeCameraFrameId: string | null
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
      worldInstances={view.worldInstances}
      paths={view.spatial.paths ?? []}
      frames={view.spatial.frames}
      relations={view.spatial.relations ?? []}
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
      onReorderPathFrames={commands.reorderPathFrames}
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
  const effective = view.effectiveBackground
  return (
    <>
      <SharedBackgroundProperties
        key={`spatial-surface-background:${view.surfaceId}`}
        ownerLabel="无限画布"
        color={view.backgroundColor}
        assetId={view.backgroundAssetId}
        assets={context.assets}
        effective={effective}
        mode={{
          value: view.backgroundMode,
          onChange: (backgroundMode) => commands.updateBackground({ backgroundMode }),
        }}
        onColorChange={(backgroundColor) => commands.updateBackground({ backgroundColor })}
        onPreviewColorChange={commands.previewBackground ? (backgroundColor) => commands.previewBackground!({ backgroundColor }) : undefined}
        onAssetChange={(backgroundAssetId) => commands.updateBackground({ backgroundAssetId })}
        testId="spatial-surface-background-properties"
      />
      <SpatialCameraPanel
        surfaceTitle={view.surfaceTitle}
        frames={view.spatial.frames}
        home={view.spatial.home}
        sessionCamera={sessionCamera}
        activeCameraFrameId={context.activeCameraFrameId}
        showCameraFrames={context.showCameraFrames}
        worldInstances={view.worldInstances}
        paths={view.spatial.paths ?? []}
        playbackPathId={context.playbackPathId}
        semanticZoomRules={view.spatial.semanticZoom ?? []}
        sessionCameraLabel={`${Math.round(sessionCamera.zoom * 100)}%`}
        draftBindingKey={context.draftBindings.surface}
        frameDraftBindings={context.draftBindings.cameraFrames}
        semanticRuleDraftBindings={context.draftBindings.semanticRules}
        onDraftStale={() => commands.reportError('属性草稿对应的编辑目标已经改变，请重新编辑。')}
        onShowCameraFramesChange={commands.setShowCameraFrames}
        onAddFrame={commands.addCameraFrame}
        onRenameFrame={commands.renameCameraFrame}
        onUpdateFrameTarget={commands.updateCameraFrameTarget}
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
