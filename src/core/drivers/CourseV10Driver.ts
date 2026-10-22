import type { DocumentCommand, DocumentDriver, DocumentModel } from '../../shared/workbench/document'
import { applyComponentOperation, applyValidatedComponentOperation, beginComponentOperationPlanning, ComponentOperationConflict, describeComponentChanges, describeComponentOperationChanges, equalComponentValue } from './courseV10Operations'
import { cloneDocumentResources } from './resources'
import { validateComponentData } from '../components/validateComponentData'
import { createCourseProjectV10Archive, openCourseProjectV10Archive, validateCourseProjectV10Archive, validateCourseProjectV10Resources } from './codecs/courseProjectV10Archive'
import { scopeComponentSourceEdits } from '../components/source/sourceAuthoringEdits'

function course(model: DocumentModel): asserts model is Extract<DocumentModel, { kind: 'course-v10' }> {
  if (model.kind !== 'course-v10') throw new TypeError('Course V10 Driver 不接受其他文档格式')
}

export const createCourseV10Driver = (): DocumentDriver => new CourseV10Driver()

export class CourseV10Driver implements DocumentDriver {
  readonly kind = 'course-v10' as const
  validate(model: DocumentModel): void {
    course(model)
    validateCourseProjectV10Archive({ project: model.project, resources: model.resources })
    validateComponentData(model.project)
  }
  apply(model: DocumentModel, command: DocumentCommand): DocumentModel {
    this.validate(model)
    // Public callers own mutable buffers; detach them before using the Session path.
    course(model)
    return this.applyValidated({ ...model, project: structuredClone(model.project), resources: cloneDocumentResources(model.resources) }, command)
  }
  applyValidated(model: DocumentModel, command: DocumentCommand): DocumentModel {
    return this.applyCandidate(model, command, applyValidatedComponentOperation, true)
  }
  applyValidatedWithChanges(model: DocumentModel, command: DocumentCommand) {
    const next = this.applyValidated(model, command)
    course(model); course(next)
    return { model: next, appliedChanges: command.type === 'component-platform.apply'
      ? describeComponentOperationChanges(model.project, next.project, command) : this.describeChanges(model, next) }
  }
  beginPlanningBatch(model: DocumentModel) {
    this.validate(model)
    course(model)
    let current: DocumentModel = { ...model, project: structuredClone(model.project), resources: cloneDocumentResources(model.resources) }
    const projectPlanning = beginComponentOperationPlanning(current.project)
    return { apply: (command: DocumentCommand): DocumentModel => {
      const next = this.applyCandidate(current, command, (_project, operation, resources) => projectPlanning.apply(operation, resources!), false)
      current = next
      return next
    } }
  }
  private applyCandidate(model: DocumentModel, command: DocumentCommand, applyProject: typeof applyComponentOperation, validateCandidate: boolean): DocumentModel {
    course(model)
    if (command.type !== 'component-platform.apply') throw new TypeError('V10 只接受身份定位的组件操作')
    // Check the captured bytes before COW; a new sharing reference alone does
    // not invalidate this instance's input or authorize changing its neighbor.
    for (const edit of command.edits) if (edit.type === 'component.files.set' && edit.sourceScope) {
      const current = Object.hasOwn(model.resources.components, edit.ownerId) ? model.resources.components[edit.ownerId] : null
      if (!equalComponentValue(current, edit.expectedFiles)) throw new ComponentOperationConflict(['@componentFiles', edit.ownerId], '组件源码文件已变化')
    }
    command = { ...command, edits: scopeComponentSourceEdits(model.project, command.edits) }
    const resources = command.edits.some(edit => edit.type === 'component.files.set' || edit.type === 'asset.add'
      || edit.type === 'asset.replace' || edit.type === 'asset.remove')
      ? { assets: { ...model.resources.assets }, components: { ...model.resources.components } } : model.resources
    for (const edit of command.edits) if (edit.type === 'component.files.set') {
      const current = Object.hasOwn(model.resources.components, edit.ownerId) ? model.resources.components[edit.ownerId] : null
      if (!equalComponentValue(current, edit.expectedFiles)) throw new ComponentOperationConflict(['@componentFiles', edit.ownerId], '组件源码文件已变化')
      if (edit.files === null) delete resources.components[edit.ownerId]
      else Object.defineProperty(resources.components, edit.ownerId, { value: Object.fromEntries(Object.entries(edit.files)
        .map(([name, bytes]) => [name, Uint8Array.from(bytes)])), enumerable: true, configurable: true, writable: true })
    }
    for (const edit of command.edits) if (edit.type === 'asset.remove') { delete resources.assets[edit.assetId] } else if (edit.type === 'asset.add') {
      if (Object.hasOwn(resources.assets, edit.asset.id)) throw new Error('素材字节身份已存在')
      Object.defineProperty(resources.assets, edit.asset.id, { value: Uint8Array.from(edit.bytes), enumerable: true, configurable: true, writable: true })
    } else if (edit.type === 'asset.replace') {
      if (!equalComponentValue(model.resources.assets[edit.asset.id], edit.expectedBytes)) throw new ComponentOperationConflict(['@assetBytes', edit.asset.id], '素材字节已变化')
      Object.defineProperty(resources.assets, edit.asset.id, { value: Uint8Array.from(edit.bytes), enumerable: true, configurable: true, writable: true })
    }
    const next: DocumentModel = { kind: 'course-v10', project: applyProject(model.project, command, model.resources), resources }
    // The accepted project path validates changed fields or the full structural
    // result. Unchanged resource closure and professional data remain validated.
    if (validateCandidate) {
      if (next.project.assets !== model.project.assets || next.resources !== model.resources) validateCourseProjectV10Resources(next.project, next.resources)
      validateComponentData(next.project, model.project)
    }
    return next
  }
  withRevision(model: DocumentModel, revision: number): DocumentModel {
    course(model)
    if (!Number.isSafeInteger(revision) || revision < model.project.revision) throw new Error('工程版本必须单调递增')
    const next: DocumentModel = { ...model, project: { ...model.project, revision } }
    return next
  }
  describeChanges(before: DocumentModel, after: DocumentModel) {
    course(before); course(after)
    return describeComponentChanges(before.project, after.project)
  }
  load(bytes: Uint8Array): DocumentModel { return { kind: 'course-v10', ...openCourseProjectV10Archive(bytes) } }
  serialize(model: DocumentModel): Uint8Array {
    course(model)
    validateComponentData(model.project)
    return createCourseProjectV10Archive({ project: model.project, resources: model.resources })
  }
}
