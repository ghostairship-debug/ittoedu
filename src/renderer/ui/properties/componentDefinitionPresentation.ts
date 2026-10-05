import type { ComponentDefinition, JsonObject, JsonValue } from '../../../shared/contracts/component-platform/project'
import { TEACHER_CONTROLLER_DEFINITION } from '../../../components/teacher-controller/data'
import { AUDIO_DEFINITION, VIDEO_DEFINITION } from '../../../components/media/adapters'
import { WEB_DEFINITION, HTML_PROGRAM_DEFINITION } from '../../../components/web/data'

function object(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Saved once on definition.dataSchema['x-editor']; library/source producers use the same V10 data shapes. */
export interface ComponentEditorMetadata {
  pages?: { id: string; label: string; propertyKeys: string[] }[]
  defaultPageId?: string
  previewPageProp?: string
  variants?: { id: string; label: string; data: JsonObject }[]
  presets?: { id: string; label: string; data: JsonObject }[]
}

export function componentEditorPresentation(definition: ComponentDefinition): ComponentEditorMetadata {
  const metadata=object(definition.dataSchema?.['x-editor'])
  const options=(key:'variants'|'presets')=>Array.isArray(metadata[key])?metadata[key].flatMap(value=>{
    const item=object(value)
    return typeof item.id==='string'&&typeof item.label==='string'&&item.data&&typeof item.data==='object'&&!Array.isArray(item.data)
      ? [{id:item.id,label:item.label,data:item.data}] : []
  }):[]
  return {
    pages:Array.isArray(metadata.pages)?metadata.pages.flatMap(value=>{
      const page=object(value)
      return typeof page.id==='string'&&typeof page.label==='string'&&Array.isArray(page.propertyKeys)
        ? [{id:page.id,label:page.label,propertyKeys:page.propertyKeys.filter((key):key is string=>typeof key==='string')}] : []
    }):[],
    defaultPageId:typeof metadata.defaultPageId==='string'?metadata.defaultPageId:undefined,
    previewPageProp:typeof metadata.previewPageProp==='string'?metadata.previewPageProp:undefined,
    variants:options('variants'),presets:options('presets'),
  }
}

/** Read the existing formal builtin definition; persisted author metadata takes precedence. */
function builtinPresentation(definition: ComponentDefinition | undefined): ComponentDefinition | undefined {
  if (definition?.implementation.kind !== 'builtin') return undefined
  switch (definition.implementation.key) {
    case 'guoling.navigation': return TEACHER_CONTROLLER_DEFINITION
    case 'guoling.audio': return AUDIO_DEFINITION
    case 'guoling.video': return VIDEO_DEFINITION
    case 'guoling.web': return WEB_DEFINITION
    case 'guoling.html-program': return HTML_PROGRAM_DEFINITION
  }
}

export function componentDefinitionPresentation(definition: ComponentDefinition | undefined) {
  const builtin = builtinPresentation(definition)
  const category = definition?.role === 'behavior' ? '功能组件' : definition?.role === 'mixed' ? '内容与功能组件' : '内容组件'
  return {
    title: definition?.title ?? builtin?.title ?? (definition?.implementation.kind === 'source' ? '源码组件' : category),
    category,
    builtinKey: definition?.implementation.kind === 'builtin' ? definition.implementation.key : undefined,
    iconType: definition?.implementation.kind === 'builtin' ? definition.implementation.key
      : definition?.role === 'behavior' ? 'behavior' : definition?.implementation.kind === 'source' ? 'source' : 'component',
  }
}

function fieldSchema(schema: JsonObject | undefined, path: readonly string[]): JsonObject {
  let field = schema ?? {}
  for (const key of path) field = object(object(field.properties)[key])
  return field
}

/** Field metadata is derived, never persisted as a second schema or localization registry. */
export function componentFieldPresentation(definition: ComponentDefinition, path: readonly string[]) {
  const fallback = fieldSchema(builtinPresentation(definition)?.dataSchema, path)
  const explicit = fieldSchema(definition.dataSchema, path)
  const schema = { ...fallback, ...explicit }
  const properties = { ...object(fallback.properties), ...object(explicit.properties) }
  // The author may replace builtin choices with either JSON Schema representation.
  const choiceSchema = 'oneOf' in explicit || 'enum' in explicit ? explicit : fallback
  const choices = Array.isArray(choiceSchema.oneOf) ? choiceSchema.oneOf.flatMap(value => {
    const option = object(value)
    return typeof option.const === 'string' ? [{ value: option.const, label: typeof option.title === 'string' ? option.title : option.const }] : []
  }) : Array.isArray(choiceSchema.enum) ? choiceSchema.enum.filter((value): value is string => typeof value === 'string').map(value => ({ value, label: value })) : []
  const parent = { ...fieldSchema(builtinPresentation(definition)?.dataSchema, path.slice(0, -1)),
    ...fieldSchema(definition.dataSchema, path.slice(0, -1)) }
  return {
    label: typeof schema.title === 'string' ? schema.title : path.at(-1) ?? '组件数据',
    description: typeof schema.description === 'string' ? schema.description : undefined,
    properties, choices,
    type: typeof schema.type === 'string' ? schema.type : undefined,
    defaultValue: schema.default,
    image: schema.format === 'image' || schema.format === 'image-asset',
    maxLength: typeof schema.maxLength === 'number' ? schema.maxLength : undefined,
    placeholder: typeof schema.placeholder === 'string' ? schema.placeholder : undefined,
    color: schema.format === 'color',
    optional: !Array.isArray(parent.required) || !parent.required.includes(path.at(-1) ?? ''),
    minimum: typeof schema.minimum === 'number' ? schema.minimum : undefined,
    maximum: typeof schema.maximum === 'number' ? schema.maximum : undefined,
    step: typeof schema.multipleOf === 'number' ? schema.multipleOf : undefined,
  }
}
