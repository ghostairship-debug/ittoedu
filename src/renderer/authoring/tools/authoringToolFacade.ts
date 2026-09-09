import { z } from 'zod'
import { componentConfigureTool } from './componentConfigureTool'
import { runtimeConfigureTool } from './runtimeConfigureTool'
import { mediaAssetTool } from './mediaAssetTool'
import { runtimeInsertTool } from './runtimeInsertTool'
import { componentInsertTool } from './componentInsertTool'
import { recipeTool } from './recipeTool'
import { componentPackageTool } from './componentPackageTool'
import { runtimeSourceTool } from './runtimeSourceTool'
import { courseNavigationTool } from './courseNavigationTool'
import { fontAssetTool } from './fontAssetTool'
import { materialCitationTool } from './materialCitationTool'
import { courseSettingsTool } from './courseSettingsTool'
import { backgroundTool } from './backgroundTool'
import { slideInteractionTool } from './slideInteractionTool'
import { spatialStructureTool } from './spatialStructureTool'
import { slideStructureTool } from './slideStructureTool'
import { nativeAuthoringTool } from './nativeAuthoringTool'
import { flowAuthoringTool } from './flowAuthoringTool'
import { semanticReplacementTool } from './semanticReplacementTool'
import { imageTransformTool } from './imageTransformTool'
import { executeAuthoringTool, type AuthoringToolCommitPort, type AuthoringToolDefinition } from './executeAuthoringTool'
import type { AuthoringToolReceiptV1 } from '../../../shared/authoringToolContract'
import { authoringToolCarrierPolicy } from './authoringToolCarrier'

function register<T>(definition: AuthoringToolDefinition<T>) {
  return { name: definition.name, inputSchema: definition.inputSchema, description: definition.description, referenceSchemas: definition.referenceSchemas,
    execute: (request: unknown, port: AuthoringToolCommitPort) => executeAuthoringTool(request, definition, port) }
}

// Execution and exported CLI contracts derive from the same formal definitions.
const catalog = [
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
  register(flowAuthoringTool),
  register(semanticReplacementTool),
  register(imageTransformTool),
]
const executors = Object.fromEntries(catalog.map(entry => [entry.name, entry.execute]))

export function describeAuthoringTools(names?: readonly string[]) {
  if (names?.some(name => !Object.hasOwn(executors, name))) throw new Error('未开放的 Authoring Tool')
  return catalog.filter(entry => !names || names.includes(entry.name)).map(entry => ({
    name: entry.name, candidateCarrier: authoringToolCarrierPolicy(entry.name), description: entry.description, inputSchema: z.toJSONSchema(entry.inputSchema, { io: 'input', reused: 'ref' }),
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
    'native.content': content,
    'selection.replace': content,
    'asset.image.transform': content,
    'flow.content': ['flow:surface'],
    'component.configure': content,
    'component.insert': content.filter(scope => scope !== 'spatial-2d:global'),
    'component.package': global,
    'runtime.insert': ['slide:scene', 'slide:global', 'flow:surface'],
    'runtime.configure': ['slide:scene', 'slide:global', 'flow:surface'],
    'runtime.source': ['slide:scene', 'slide:global', 'flow:surface'],
    'asset.media.import': global,
    'asset.font.import': global,
    'course.navigation': global,
    'course.settings': global,
    'material.citation': content,
    'owner.background': ['slide:scene', 'slide:surface', 'slide:global', 'flow:surface', 'flow:global', 'spatial-2d:surface', 'spatial-2d:global'],
    'recipe.apply': ['slide:scene'],
    'slide.interaction': ['slide:scene'],
    'slide.structure': ['slide:scene'],
    'spatial.structure': ['spatial-2d:world'],
  }
  return describeAuthoringTools().map(tool => {
    const supportedScopes = scopes[tool.name]
    if (!supportedScopes) throw new Error(`Authoring Tool ${tool.name} 缺少正式发现域`)
    return { ...tool, supportedScopes: [...supportedScopes], support: 'conditional-on-input-target-resources-and-host' as const }
  })
}
