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
import { executeAuthoringTool, type AuthoringToolCommitPort } from './executeAuthoringTool'
import type { AuthoringToolReceiptV1 } from '../../../shared/authoringToolContract'

const executors: Readonly<Record<string, (request: unknown, port: AuthoringToolCommitPort) => Promise<AuthoringToolReceiptV1>>> = {
  [componentConfigureTool.name]: (request, port) => executeAuthoringTool(request, componentConfigureTool, port),
  [runtimeConfigureTool.name]: (request, port) => executeAuthoringTool(request, runtimeConfigureTool, port),
  [mediaAssetTool.name]: (request, port) => executeAuthoringTool(request, mediaAssetTool, port),
  [runtimeInsertTool.name]: (request, port) => executeAuthoringTool(request, runtimeInsertTool, port),
  [componentInsertTool.name]: (request, port) => executeAuthoringTool(request, componentInsertTool, port),
  [recipeTool.name]: (request, port) => executeAuthoringTool(request, recipeTool, port),
  [componentPackageTool.name]: (request, port) => executeAuthoringTool(request, componentPackageTool, port),
  [runtimeSourceTool.name]: (request, port) => executeAuthoringTool(request, runtimeSourceTool, port),
  [courseNavigationTool.name]: (request, port) => executeAuthoringTool(request, courseNavigationTool, port),
  [fontAssetTool.name]: (request, port) => executeAuthoringTool(request, fontAssetTool, port),
  [materialCitationTool.name]: (request, port) => executeAuthoringTool(request, materialCitationTool, port),
  [courseSettingsTool.name]: (request, port) => executeAuthoringTool(request, courseSettingsTool, port),
  [backgroundTool.name]: (request, port) => executeAuthoringTool(request, backgroundTool, port),
  [slideInteractionTool.name]: (request, port) => executeAuthoringTool(request, slideInteractionTool, port),
  [spatialStructureTool.name]: (request, port) => executeAuthoringTool(request, spatialStructureTool, port),
  [slideStructureTool.name]: (request, port) => executeAuthoringTool(request, slideStructureTool, port),
  [nativeAuthoringTool.name]: (request, port) => executeAuthoringTool(request, nativeAuthoringTool, port),
  [flowAuthoringTool.name]: (request, port) => executeAuthoringTool(request, flowAuthoringTool, port),
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
