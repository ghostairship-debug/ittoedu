import type {
  ComponentInstance, ComponentSurface, CourseProjectV10, PublishedCourseV3,
} from '../../../../shared/contracts/component-platform'
import type { ExportPageOptions } from '../../../../shared/workbench/toolPorts'

export type ComponentPptxInput = CourseProjectV10 | PublishedCourseV3
export interface ComponentPptxDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  surfaceId?: string
  instanceId?: string
}
export interface ComponentPptxPage {
  id: string
  surfaceId: string
  title: string
  spatialFrameId?: string
}
export interface ComponentPptxCaptureContext {
  input: ComponentPptxInput
  surface: ComponentSurface
  instance: ComponentInstance
}
export interface BuildComponentPptxOptions extends ExportPageOptions {
  /** C0 resources come from the existing resource service; P0 can use embedded URLs. */
  resolveAsset?(assetId: string, input: ComponentPptxInput): string | undefined | Promise<string | undefined>
  /** Real runtime capture in instance-local coordinates, excluding its children. */
  captureInstance?(context: ComponentPptxCaptureContext): string | undefined | Promise<string | undefined>
  /** Spatial pages require the actual Player camera view, including global planes. */
  captureSurface?(context: { input: ComponentPptxInput; surface: ComponentSurface; page: ComponentPptxPage }): string | undefined | Promise<string | undefined>
  onDiagnostic?(diagnostic: ComponentPptxDiagnostic): void
}
export interface ComponentPptxResult {
  bytes: Uint8Array
  slideCount: number
  pages: ComponentPptxPage[]
  status: 'complete' | 'partial' | 'empty'
  diagnostics: ComponentPptxDiagnostic[]
}
