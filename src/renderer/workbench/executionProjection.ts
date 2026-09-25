// The renderer projects stored facts only. Replay never calls an executor or changes a document.
export { emptyExecutionProjection, foldExecutionEvents } from '../../shared/workbench/executionEvents'
export type { ExecutionProjection, ExecutionItem, ExecutionContent } from '../../shared/workbench/executionEvents'
