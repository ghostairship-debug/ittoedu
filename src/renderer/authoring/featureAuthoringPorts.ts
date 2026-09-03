import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { CourseAssetSidecar } from '../project/v9AssetAdapter'
import type { EffectiveLayerProjection } from '../course/effectiveLayerProjection'
import type { EditorTransactionStep } from './editorTransaction'
import type { CourseAuthoringSession } from './courseAuthoringSession'
import type { SlideAuthoringSession, SlideCommandResult } from '../course/slideAuthoringBackend'
import type { CourseMediaCommandResult } from '../course/v9MediaAudioCommands'
import type { LayerCommandResult } from '../course/effectiveLayerCommands'
import type { SpatialAuthoringSession, SpatialCommandResult } from '../course/spatialEditorCommands'
import type { FlowCommandResult } from '../course/flowEditorCommands'
import type { FlowSharedAuthoringResult } from '../course/flowSharedAuthoringAdapters'
import type { FlowAuthoringSession } from '../project/createFlowCourseProject'

export type FeatureAuthoringContext = {
  readonly document: CourseProjectDocument | null
  readonly sidecar: CourseAssetSidecar | null
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly authoringSession: CourseAuthoringSession | null
  readonly editingScope: 'scene' | 'global'
  readonly activeSceneId: string
  readonly projection: EffectiveLayerProjection | null
  readonly interactionLocationId: string | null
  readonly interactionStateId: string | null
  readonly hasSlideSession: boolean
  readonly hasFlowSession: boolean
  readonly hasSpatialSession: boolean
}

export type FeatureAuthoringFeedback = {
  readonly errorMessage?: string | null
  readonly statusMessage?: string | null
}

export type FeatureAuthoringPorts = {
  read(): FeatureAuthoringContext
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  setFeedback(feedback: FeatureAuthoringFeedback): void
  setActiveTab(tab: 'components' | 'elements' | 'developer'): void
  persistProject(project: CourseProjectDocument, extra?: {
    statusMessage?: string | null
    componentPackages?: Record<string, ComponentPackageData>
  }): void
  persistSlideCommand(
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: {
      statusMessage?: string | null
      sidecar?: CourseAssetSidecar
      componentPackages?: Record<string, ComponentPackageData>
    },
  ): SlideCommandResult
  persistMedia(result: CourseMediaCommandResult): CourseMediaCommandResult
  persistLayer(result: LayerCommandResult, extra?: { statusMessage?: string | null }): void
  readSpatialSession(): SpatialAuthoringSession | null
  readFlowSession(): FlowAuthoringSession | null
  persistSpatial(result: SpatialCommandResult, extra?: {
    statusMessage?: string | null
    sidecar?: CourseAssetSidecar
    componentPackages?: Record<string, ComponentPackageData>
  }): void
  persistFlow(
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra?: {
      statusMessage?: string | null
      sidecar?: CourseAssetSidecar
      componentPackages?: Record<string, ComponentPackageData>
    },
  ): void
}
