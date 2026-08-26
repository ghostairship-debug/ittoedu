import { nanoid } from 'nanoid'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import {
  createBlankFlowSurface,
} from '../course/flowDocumentModel'
import {
  createFlowEditorHistory,
  selectFlowEditorBlock,
  type FlowEditorHistory,
  type FlowEditorSelection,
} from '../course/flowEditorSlice'
import { createBlankCourseProject } from './createCourseProject'
import type { CreateProjectOptions } from './createProject'

export interface FlowAuthoringSession {
  readonly history: FlowEditorHistory
  readonly selection: FlowEditorSelection
}

export function courseProjectStartsAsFlow(
  project: CourseProjectDocument,
): boolean {
  const start = project.locations.find((location) => location.id === project.startLocationId)
  return start?.kind === 'flow-block'
}

/**
 * Blank Flow Course Project V9. Default `createBlankCourseProject` remains
 * Slide; callers must opt into this factory.
 */
export function createBlankFlowCourseProject(
  options: CreateProjectOptions = {},
): CourseProjectDocument {
  const slide = createBlankCourseProject(options)
  const idFactory = options.idFactory ?? nanoid
  const created = createBlankFlowSurface({
    id: `surface-flow-${idFactory()}`,
    title: '流式讲义',
  })
  return courseProjectDocumentSchema.parse({
    ...slide,
    locations: [created.location],
    startLocationId: created.location.id,
    surfaces: [created.surface],
  })
}

export function openFlowAuthoringSession(
  project: CourseProjectDocument,
): FlowAuthoringSession {
  const parsed = courseProjectDocumentSchema.parse(structuredClone(project))
  const location = parsed.locations.find((candidate) => (
    candidate.id === parsed.startLocationId && candidate.kind === 'flow-block'
  )) ?? parsed.locations.find((candidate) => candidate.kind === 'flow-block')
  if (!location || location.kind !== 'flow-block') {
    throw new Error('找不到 Flow 页面位置')
  }
  return {
    history: createFlowEditorHistory(parsed),
    selection: selectFlowEditorBlock(parsed, location.id, location.blockId),
  }
}
