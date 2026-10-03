import type { NativeElementContent } from '../contracts/course-project-v9/types'
import type { CourseStateDeclaration } from '../contracts/course-state/types'
import type { InteractionRule } from '../contracts/interaction-v1/types'
import type { NativeInputContent } from '../contracts/native-v1/types'
import type { CompositionNode, WebComposition } from './content'

type Path = Array<string | number>
type InputLayer =
  | { layerItemId: string; kind: 'native'; content: NativeElementContent }
  | { layerItemId: string; kind: 'composition'; content: WebComposition<unknown> }
  | { layerItemId: string; kind: 'runtime' | 'component' }

export interface SceneNativeInputReference {
  /** The same public identity used by the owning Slide and composition mount. */
  nodeId: string
  input: NativeInputContent
  path: Path
}

/** References author fields directly; does not copy or register a second input model. */
export function sceneNativeInputs(items: readonly InputLayer[], path: Path = []): SceneNativeInputReference[] {
  const inputs: SceneNativeInputReference[] = []
  items.forEach((item, index) => {
    const ownPath = [...path, 'layerItems', index]
    if (item.kind === 'native' && item.content.nativeType === 'input') {
      inputs.push({ nodeId: item.layerItemId, input: item.content.data, path: [...ownPath, 'content', 'data'] })
    } else if (item.kind === 'composition') {
      const visit = (node: CompositionNode<unknown>, nodePath: Path): void => {
        if (node.kind === 'native' && node.content.nativeType === 'input') {
          inputs.push({ nodeId: `${item.layerItemId}/${node.id}`, input: node.content.data, path: [...nodePath, 'content', 'data'] })
        } else if (node.kind === 'element') node.children.forEach((child, childIndex) => visit(child, [...nodePath, 'children', childIndex]))
      }
      visit(item.content.root, [...ownPath, 'content', 'root'])
    }
  })
  return inputs
}

/** The existing saved-input contract shared by V9 and Published V2. */
export function nativeInputReferenceIssues(
  reference: SceneNativeInputReference,
  states: ReadonlyMap<string, CourseStateDeclaration>,
  rules: ReadonlyMap<string, InteractionRule>,
): Array<{ path: Path; message: string }> {
  const issues: Array<{ path: Path; message: string }> = []
  const { input, path, nodeId } = reference
  const issue = (field: string, message: string, index?: number) => issues.push({ path: [...path, field, ...(index === undefined ? [] : [index])], message })
  const value = states.get(input.stateKey)
  if (!value) issue('stateKey', `Missing course-state key: ${input.stateKey}`)
  else if (value.valueType !== (input.answerType === 'text' ? 'string' : 'number')) {
    issue('stateKey', `Input state key '${input.stateKey}' value type must match answerType '${input.answerType}'`)
  }
  const validity = states.get(input.validityKey)
  if (!validity) issue('validityKey', `Missing course-state key: ${input.validityKey}`)
  else if (validity.valueType !== 'boolean') issue('validityKey', `Input validity key '${input.validityKey}' must be a boolean course state`)
  input.ruleFamilyRuleIds.forEach((ruleId, index) => {
    const rule = rules.get(ruleId)
    if (!rule) issue('ruleFamilyRuleIds', `Input rule family references missing interaction rule: ${ruleId}`, index)
    else if (rule.trigger.type !== 'input.submit' || rule.trigger.nodeId !== nodeId) {
      issue('ruleFamilyRuleIds', `Input rule family rule must target this input node: ${ruleId}`, index)
    }
  })
  return issues
}
