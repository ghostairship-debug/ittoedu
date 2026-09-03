import type { RuntimeInspectorAuthoringView } from '../../runtime/runtimeInspectorAuthoringView'
import type {
  RuntimeInspectorCommitResult,
  RuntimePropertiesContext,
} from './RuntimePropertiesPanel'

export interface RuntimePropertiesContexts {
  readonly scene: RuntimePropertiesContext
  readonly global: RuntimePropertiesContext
}

export function buildRuntimePropertiesContexts(input: {
  readonly view: RuntimeInspectorAuthoringView | null
  readonly editingScope: 'scene' | 'global'
  readonly updateProperty: RuntimePropertiesContext['commands']['updateProperty']
  readonly updateContentText: RuntimePropertiesContext['commands']['updateContentText']
  readonly report: (feedback: { kind: 'error' | 'success'; message: string }) => void
}): RuntimePropertiesContexts {
    const build = (scope: 'scene' | 'global'): RuntimePropertiesContext => ({
      kind: 'runtime',
      scope,
      view: input.editingScope === scope ? input.view : null,
      disabledReason: input.editingScope === scope
        && input.view
        && input.view.availability !== 'available'
        ? input.view.label
        : null,
      commands: {
        updateProperty: (target, update) => (
          input.updateProperty(target, update) as RuntimeInspectorCommitResult
        ),
        updateContentText: (target, value) => (
          input.updateContentText(target, value) as RuntimeInspectorCommitResult
        ),
      },
      onFeedback: input.report,
    })
    return { scene: build('scene'), global: build('global') }
}
