import type { CourseProjectDocument } from '../../shared/courseProjectTypes'

export function allocateInputStateKeys(project: CourseProjectDocument, answerType: 'text' | 'number', id: () => string) {
  const keys = new Set(project.courseState.map(entry => entry.key))
  for (let attempt = 0; attempt < 100; attempt++) {
    const token = id()
    const stateKey = `input.${token}.value`
    const validityKey = `input.${token}.valid`
    if (keys.has(stateKey) || keys.has(validityKey)) continue
    project.courseState.push(answerType === 'text'
      ? { key: stateKey, valueType: 'string', defaultValue: '' }
      : { key: stateKey, valueType: 'number', defaultValue: 0 },
    { key: validityKey, valueType: 'boolean', defaultValue: false })
    return { stateKey, validityKey }
  }
  throw new Error('无法生成无冲突的输入状态键')
}

/** Retain keys whenever extension source cannot be inspected from this document. */
export function pruneUnusedInputState(project: CourseProjectDocument, keys: readonly string[]): string[] {
  const { courseState: _declarations, ...content } = project
  const source = JSON.stringify(content)
  const unknownComponents = Object.keys(project.componentPackages).length > 0
  const retained = keys.filter(key => unknownComponents || source.includes(key))
  project.courseState = project.courseState.filter(entry => !keys.includes(entry.key) || retained.includes(entry.key))
  return retained
}
