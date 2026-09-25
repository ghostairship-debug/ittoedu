import type { DocumentCommand, DocumentDriver, DocumentModel } from '../../shared/workbench/document'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { createCourseProjectArchive, openCourseProjectArchive, validateCourseProjectArchiveData } from './codecs/courseProjectArchive'
import { cloneDocumentResources } from './resources'
import { locateCourseLayer, normalizeEffectiveLayerPropertyPatch, writeBasePropertyPatch, type NativeTextFramePort } from './course/layerProperties'
import { nativeLayerTextAutoSizeFrame, prepareNativeLayerTextMeasurement } from '../tools/nativeTextLayout'
import { prepareNativeTextFrame, type AsyncNativeTextMeasurePort } from '../tools/prepareNativeTextFrame'

function course(model: DocumentModel): asserts model is Extract<DocumentModel, { kind: 'course-v9' }> {
  if (model.kind !== 'course-v9') throw new TypeError('Course V9 Driver 不接受其他文档格式')
}

export interface CourseV9DriverOptions { measureTextFrame?: NativeTextFramePort; measureNativeTextAsync?: AsyncNativeTextMeasurePort }
export const createCourseV9Driver = (options: CourseV9DriverOptions = {}): DocumentDriver => new CourseV9Driver(options)

export class CourseV9Driver implements DocumentDriver {
  readonly kind = 'course-v9' as const
  constructor(private readonly options: CourseV9DriverOptions = {}) {}
  validate(model: DocumentModel): void {
    course(model)
    cloneDocumentResources(model.resources)
    validateCourseProjectArchiveData({ project: model.project, assetFiles: model.resources.assets, componentFiles: model.resources.components })
  }
  apply(model: DocumentModel, command: DocumentCommand): DocumentModel | Promise<DocumentModel> {
    this.validate(model)
    course(model)
    let project: CourseProjectDocument
    let resources = model.resources
    if (command.type === 'course.replace') {
      if (command.project.id !== model.project.id) throw new TypeError('替换文档不能改变 Course Project 身份')
      // Authority supplies revision; a caller cannot overwrite or advance the operation sequence.
      if (command.project.revision !== model.project.revision) throw new TypeError('替换文档的基准版本已失效')
      project = structuredClone(command.project)
      resources = command.resources ?? model.resources
    } else if (command.type === 'course.object.patch') {
      project = structuredClone(model.project)
      const location = project.locations.find(value => value.id === command.locationId)
      if (!location) throw new TypeError('目标页面已不存在')
      const layer = locateCourseLayer(project, command.itemId)
      if (!layer) throw new TypeError('目标图层已不存在')
      if (layer.source !== 'global' && (layer.surfaceId !== location.surfaceId
        || layer.source === 'scene' && (location.kind !== 'slide-scene' || layer.sceneId !== location.sceneId))) {
        throw new TypeError('目标图层不属于指定页面')
      }
      const frozenPatch = structuredClone(command.patch)
      if (!this.options.measureTextFrame && this.options.measureNativeTextAsync && prepareNativeLayerTextMeasurement(layer.item, frozenPatch)) {
        const frozenResources = cloneDocumentResources(resources)
        return prepareNativeTextFrame(layer.item, frozenPatch, this.options.measureNativeTextAsync).then(measureTextFrame => {
          const { patch } = normalizeEffectiveLayerPropertyPatch(layer.item, layer.source, frozenPatch, { allowOwnedNativeData: true, measureTextFrame })
          writeBasePropertyPatch(layer.item, patch)
          const next: DocumentModel = { kind: 'course-v9', project: courseProjectDocumentSchema.parse(project), resources: frozenResources }
          this.validate(next); return next
        })
      }
      const { patch } = normalizeEffectiveLayerPropertyPatch(layer.item, layer.source, frozenPatch, {
        allowOwnedNativeData: true, measureTextFrame: this.options.measureTextFrame ?? nativeLayerTextAutoSizeFrame,
      })
      writeBasePropertyPatch(layer.item, patch)
    } else throw new TypeError('Course V9 Driver 不支持该操作')
    const next: DocumentModel = { kind: 'course-v9', project: courseProjectDocumentSchema.parse(project), resources: cloneDocumentResources(resources) }
    this.validate(next)
    return next
  }
  withRevision(model: DocumentModel, revision: number): DocumentModel {
    course(model)
    if (!Number.isSafeInteger(revision) || revision < model.project.revision) throw new RangeError('Course Project 版本必须单调递增')
    const next: DocumentModel = { ...model, project: { ...model.project, revision, updatedAt: new Date().toISOString() } }
    this.validate(next)
    return next
  }
  load(bytes: Uint8Array): DocumentModel {
    const { project, assetFiles, componentFiles } = openCourseProjectArchive(bytes)
    return { kind: 'course-v9', project, resources: { assets: assetFiles, components: componentFiles } }
  }
  serialize(model: DocumentModel): Uint8Array {
    this.validate(model)
    course(model)
    return createCourseProjectArchive({ project: model.project, assetFiles: model.resources.assets, componentFiles: model.resources.components })
  }
}
