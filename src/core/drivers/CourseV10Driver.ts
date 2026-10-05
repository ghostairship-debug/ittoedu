import type { DocumentCommand, DocumentDriver, DocumentModel } from '../../shared/workbench/document'
import { applyComponentOperation, ComponentOperationConflict, describeComponentChanges, equalComponentValue } from './courseV10Operations'
import { cloneDocumentResources } from './resources'
import { validateComponentData } from '../components/validateComponentData'
import { createCourseProjectV10Archive, openCourseProjectV10Archive, validateCourseProjectV10Archive } from './codecs/courseProjectV10Archive'

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
    course(model)
    if (command.type !== 'component-platform.apply') throw new TypeError('V10 只接受身份定位的组件操作')
    const resources = cloneDocumentResources(model.resources)
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
    const next: DocumentModel = { kind: 'course-v10', project: applyComponentOperation(model.project, command), resources }
    this.validate(next)
    return next
  }
  withRevision(model: DocumentModel, revision: number): DocumentModel {
    course(model)
    if (!Number.isSafeInteger(revision) || revision < model.project.revision) throw new Error('工程版本必须单调递增')
    const next: DocumentModel = { ...model, project: { ...model.project, revision } }
    this.validate(next)
    return next
  }
  describeChanges(before: DocumentModel, after: DocumentModel) {
    course(before); course(after)
    return describeComponentChanges(before.project, after.project)
  }
  load(bytes: Uint8Array): DocumentModel { return { kind: 'course-v10', ...openCourseProjectV10Archive(bytes) } }
  serialize(model: DocumentModel): Uint8Array {
    this.validate(model); course(model)
    return createCourseProjectV10Archive({ project: model.project, resources: model.resources })
  }
}
