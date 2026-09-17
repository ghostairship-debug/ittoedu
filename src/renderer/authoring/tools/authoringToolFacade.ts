import { z } from 'zod'
import { teacherControllerComponentTool } from './teacherControllerComponentTool'
import { componentConfigureTool } from './componentConfigureTool'
import { runtimeConfigureTool } from './runtimeConfigureTool'
import { mediaAssetTool } from './mediaAssetTool'
import { runtimeInsertTool } from './runtimeInsertTool'
import { componentInsertTool } from './componentInsertTool'
import { recipeTool } from './recipeTool'
import { componentPackageTool, componentPackageDiscoveryVariants, componentPackageDiscoveryExamples } from './componentPackageTool'
import { runtimeSourceTool } from './runtimeSourceTool'
import { courseNavigationTool } from './courseNavigationTool'
import { fontAssetTool } from './fontAssetTool'
import { materialCitationTool } from './materialCitationTool'
import { courseSettingsTool } from './courseSettingsTool'
import { backgroundTool, backgroundDiscovery } from './backgroundTool'
import { slideInteractionTool } from './slideInteractionTool'
import { spatialStructureTool } from './spatialStructureTool'
import { projectDocumentTool } from './projectDocumentTool'
import { slideStructureTool } from './slideStructureTool'
import { nativeAuthoringTool } from './nativeAuthoringTool'
import { layerEditTool } from './layerEditTool'
import { flowAuthoringTool } from './flowAuthoringTool'
import { semanticReplacementTool } from './semanticReplacementTool'
import { imageTransformTool } from './imageTransformTool'
import { executeAuthoringTool, type AuthoringToolCommitPort, type AuthoringToolDefinition } from './executeAuthoringTool'
import type { AuthoringToolReceiptV1 } from '../../../shared/authoringToolContract'
import { authoringToolCarrierPolicy } from '../../../shared/authoringToolCarrier'
import type { CourseAgentCapabilityVariant } from '../../../shared/courseAgentCapabilities'

function register<T>(definition: AuthoringToolDefinition<T>) {
  return { name: definition.name, inputSchema: definition.inputSchema, description: definition.description, referenceSchemas: definition.referenceSchemas, conditions: definition.conditions,
    execute: (request: unknown, port: AuthoringToolCommitPort) => executeAuthoringTool(request, definition, port) }
}

// Execution and exported CLI contracts derive from the same formal definitions.
const catalog = [
  register(teacherControllerComponentTool),
  register(projectDocumentTool),
  register(componentConfigureTool),
  register(runtimeConfigureTool),
  register(mediaAssetTool),
  register(runtimeInsertTool),
  register(componentInsertTool),
  register(recipeTool),
  register(componentPackageTool),
  register(runtimeSourceTool),
  register(courseNavigationTool),
  register(fontAssetTool),
  register(materialCitationTool),
  register(courseSettingsTool),
  register(backgroundTool),
  register(slideInteractionTool),
  register(spatialStructureTool),
  register(slideStructureTool),
  register(nativeAuthoringTool),
  register(layerEditTool),
  register(flowAuthoringTool),
  register(semanticReplacementTool),
  register(imageTransformTool),
]
const executors = Object.fromEntries(catalog.map(entry => [entry.name, entry.execute]))

export function describeAuthoringTools(names?: readonly string[]) {
  if (names?.some(name => !Object.hasOwn(executors, name))) throw new Error('未开放的 Authoring Tool')
  return catalog.filter(entry => !names || names.includes(entry.name)).map(entry => ({
    name: entry.name, candidateCarrier: authoringToolCarrierPolicy(entry.name), description: entry.description, inputSchema: z.toJSONSchema(entry.inputSchema, { io: 'input', reused: 'ref' }),
    conditions: entry.conditions,
    references: entry.referenceSchemas ? Object.fromEntries(Object.entries(entry.referenceSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input', reused: 'ref' })])) : undefined,
  }))
}

/** Versioned product entrypoint. External callers provide data, never writers. */
export function createAuthoringToolFacade(port: AuthoringToolCommitPort) {
  return Object.freeze({
    version: 1 as const,
    tools: Object.freeze(Object.keys(executors)),
    execute(request: unknown): Promise<AuthoringToolReceiptV1> {
      const name = typeof request === 'object' && request !== null ? Reflect.get(request, 'tool') : undefined
      const run = typeof name === 'string' && Object.hasOwn(executors, name) ? executors[name] : undefined
      if (run) return run(request, port)
      return executeAuthoringTool(request, {
        name: typeof name === 'string' && name.trim() ? name : 'unknown-tool',
        inputSchema: z.unknown(),
        plan() { throw new Error('未开放的 Authoring Tool') },
      }, port)
    },
  })
}

/** Discovery annotations live with the sole tool registry. They describe the
 * planner's coarse destination domain; the complete input/target contract and
 * actual resource/host checks remain authoritative for each operation. */
export function describeAuthoringToolDiscovery() {
  const content = ['slide:scene', 'slide:global', 'flow:surface', 'flow:global', 'spatial-2d:world', 'spatial-2d:global']
  const global = ['slide:global', 'flow:global', 'spatial-2d:global']
  const scopes: Record<string, readonly string[]> = {
    'component.controller': global,
    'project.document': [...content, 'slide:surface', 'spatial-2d:surface'],
    'native.content': content,
    'layer.edit': [...content, 'slide:surface', 'spatial-2d:surface'],
    'selection.replace': content,
    'asset.image.transform': content,
    'flow.content': ['flow:surface'],
    'component.configure': content,
    'component.insert': content.filter(scope => scope !== 'spatial-2d:global'),
    'component.package': [...new Set(componentPackageDiscoveryVariants.flatMap(variant => variant.scopes))],
    'runtime.insert': ['slide:scene', 'slide:global', 'flow:surface'],
    'runtime.configure': ['slide:scene', 'slide:global', 'flow:surface'],
    'runtime.source': ['slide:scene', 'slide:global', 'flow:surface'],
    'asset.media.import': global,
    'asset.font.import': global,
    'course.navigation': global,
    'course.settings': global,
    'material.citation': content,
    'owner.background': backgroundDiscovery.supportedScopes,
    'recipe.apply': ['slide:scene'],
    'slide.interaction': ['slide:scene'],
    'slide.structure': ['slide:scene'],
    'spatial.structure': ['spatial-2d:world'],
  }
  return describeAuthoringTools().map(tool => {
    const supportedScopes = scopes[tool.name]
    if (!supportedScopes) throw new Error(`Authoring Tool ${tool.name} 缺少正式发现域`)
    // Top-level operation discriminators come directly from the formal Schema.
    const schema = tool.inputSchema as Record<string, any>
    const resolveProperty = (property: any): any => {
      const seen = new Set<string>()
      while (property?.$ref?.startsWith('#/$defs/')) {
        if (seen.has(property.$ref)) throw new Error('工具发现判别器引用循环')
        seen.add(property.$ref)
        property = schema.$defs?.[property.$ref.slice(8)]
      }
      return property
    }
    const operations: string[] = (schema.oneOf ?? schema.anyOf ?? [schema]).flatMap((branch: any) => {
      const resolved = resolveProperty(branch.properties?.operation)
      return typeof resolved?.const === 'string' ? [resolved.const as string] : []
    })
    const variants: CourseAgentCapabilityVariant[] = tool.name === 'component.package' ? componentPackageDiscoveryVariants
      : (operations.length ? operations.map(operation => ({ operation, scopes: [...supportedScopes] })) : [{ scopes: [...supportedScopes] }])
    if (tool.candidateCarrier.operations) for (const variant of variants) {
      variant.carriers = [variant.operation ? tool.candidateCarrier.operations[variant.operation] ?? tool.candidateCarrier.default : tool.candidateCarrier.default]
    }
    // Long-tail examples bind required values from the current task instead of
    // inventing asset IDs, package bytes or project targets. Keys and fixed
    // discriminators are projected from the same schema used to execute input.
    const schemaExamples = (schema.oneOf ?? schema.anyOf ?? [schema]).map((branch: any) => {
      const values: string[] = []
      const fields = (branch.required ?? []).map((key: string) => {
        const resolved = resolveProperty(branch.properties[key])
        if (resolved?.const !== undefined) return `${JSON.stringify(key)}:${JSON.stringify(resolved.const)}`
        values.push(key)
        return `${JSON.stringify(key)}:values[${JSON.stringify(key)}]`
      })
      const operation = resolveProperty(branch.properties?.operation)?.const
      return { ...(operation ? { operation } : {}),
        bindings: `values 的 ${values.join('/')} 来自当前观察、已读资源或用户要求，值须满足本卡 inputSchema；destination 原样复制当前目标。`,
        code: `const input={${fields.join(',')}}; const receipt=await session.execute(${JSON.stringify(tool.name)},input,destination);` }
    })
    const examples = tool.name === 'component.package' ? componentPackageDiscoveryExamples : tool.name === 'native.content' ? [
      { operation: 'edit', input: { operation: 'edit', textStyle: { fontSize: 44 } } },
      { operation: 'edit-text', input: { operation: 'edit-text', textStyle: { fontSize: 44 } } },
      { operation: 'edit-shape', input: { operation: 'edit-shape', shapeStyle: { fillColor: '#22c55e' } } },
      { operation: 'edit-formula', input: { operation: 'edit-formula', formula: { ast: { type: 'token', value: 'x' }, accessibleText: 'x' } } },
      { operation: 'edit-image', bindings: 'assetId来自当前工程图片素材或前序导入回执。', code: 'const receipt=await session.execute("native.content",{operation:"edit-image",image:{assetId}},destination);' },
      { operation: 'properties', input: { operation: 'properties', properties: { frame: { x: 80, y: 120 } } } },
      { operation: 'insert', nativeType: 'text', input: { operation: 'insert', template: { nativeType: 'text', text: '标题' } } },
      { operation: 'insert', nativeType: 'shape', input: { operation: 'insert', template: { nativeType: 'shape', shapeType: 'ellipse', width: 120, height: 120, style: { fillColor: '#ffff00' } } } },
      { operation: 'content', code: 'await session.execute("native.content",{operation:"content",content:{nativeType:"shape",data:{...values.shapeData,lineGeometry:{kind:"straight",start:[0.5,0],end:[0.5,1]}}}},destination);' },
      ...schemaExamples.filter((example: any) => example.operation === 'insert'),
      { operation: 'content', bindings: 'content 原样复制当前对象的完整 content，修改所需字段后仍须满足 references[nativeType]。', code: 'const receipt=await session.execute("native.content",{operation:"content",content},{kind:"update",target});' },
      { operation: 'delete', input: { operation: 'delete' } },
    ] : tool.name === 'asset.image.transform' ? [{ bindings: 'sourceAssetId 来自当前选中图片；sourceColor 为观察原图后选定的待替换颜色；target 复制当前图片的 update target。', code: 'const receipt=await session.execute("asset.image.transform",{sourceAssetId,operations:[{kind:"replace-color",sourceColor,targetColor:"#22c55e"}]},{kind:"update",target});' }]
      : tool.name === 'component.insert' ? [
        { operation: 'candidate', bindings: 'Spatial world 目标使用 create parent:owner；files 来自当前候选 Component API 4 包，staticFallbackAssetId 若由 candidate 输入 Schema 要求则按当前资源绑定。Flow-only 的 parent:flow-body 后备条件不适用于 Spatial world。', code: 'const input={operation:"candidate",files,staticFallbackAssetId}; const receipt=await session.execute("component.insert",input,destination);' },
        ...schemaExamples,
      ] : tool.name === 'component.configure' ? [{ input: { properties: { frame: { x: 80, y: 120 } } } }]
        : tool.name === 'owner.background' ? [{ input: { backgroundColor: '#ffffff' } }] : schemaExamples
    for (const example of examples ?? []) if ('input' in example) catalog.find(entry => entry.name === tool.name)!.inputSchema.parse(example.input)
    return { ...tool, supportedScopes: [...supportedScopes], variants,
      ...(tool.name === 'owner.background' ? { background: backgroundDiscovery } : {}),
      ...(examples ? { examples } : {}),
      invocation: 'Builder: await session.execute(tool,input,destination)。input 遵循本卡完整 Schema；destination 原样使用当前 observe/createScope 的目标；只以 committed receipt 判定成功。',
      recovery: 'invalid-input: 按本卡 Schema 修正字段；revision-conflict: 重新 observe 后复制新 target 和源码基线；tool-failed: 读取 diagnostics 修复所指输入/资源/宿主条件，失败不代表已提交。',
      support: 'conditional-on-input-target-resources-and-host' as const }
  })
}
