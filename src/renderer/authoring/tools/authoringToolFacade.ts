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
