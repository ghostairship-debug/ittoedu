import type { CompositionNode } from './content'
import type { CourseRuntimeDefinition } from '../courseProjectTypes'
import type { DocumentContent } from '../document/content'

export type CompositionSingleContentEdit =
  | { type: 'text'; nodeId: string; text: string }
  | { type: 'attributes'; nodeId: string; patch: Record<string, string | null> }
  | { type: 'style'; nodeId: string; patch: Record<string, string | null> }
  | { type: 'move'; nodeId: string; parentId: string; index: number }
  | { type: 'replace'; nodeId: string; node: CompositionNode<CourseRuntimeDefinition> }
  | { type: 'remove'; nodeId: string }
  | { type: 'document'; nodeId: string; content: DocumentContent }
  | { type: 'native'; nodeId: string; patch: Record<string, unknown> }

/** Several mechanical changes still form one canonical edit and one undo step. */
export type CompositionContentEdit = CompositionSingleContentEdit
  | { type: 'batch'; nodeId: string; edits: CompositionSingleContentEdit[] }
