import { z } from 'zod'
import type { ModelToolCall, ToolDefinition, ToolResult, ToolTarget } from '../../shared/workbench/tools'
import type { DocumentKind } from '../../shared/workbench/document'

export interface RunToolScope {
  kind: DocumentKind
  writableTargetKinds: readonly ToolTarget['kind'][]
  wholeDocumentWritable: boolean
}
export const toolFamilies = ['content', 'layout', 'navigation', 'interaction', 'media', 'build', 'jobs', 'office'] as const
export type ToolFamily = typeof toolFamilies[number]

/** These are the existing service owners, supplied by the composition root. */
export type ToolSupportContext = Partial<Record<'componentContent' | 'images' | 'skills' | 'deliveries' | 'observations'
  | 'projectFiles' | 'files' | 'office' | 'artifacts' | 'materials' | 'htmlActions' | 'jobs' | 'compute' | 'delegation' | 'web' | 'mcp' | 'media' | 'openImages' | 'assetLibrary', boolean>> & {
  scopes?: readonly RunToolScope[]
  standaloneImage?: boolean
  projectFilesAccess?: 'read' | 'write'
  fileAccess?: 'read' | 'write'
  courseAuthoring?: boolean
  /** The existing built-in actor/file grant for workbench service tools. */
  workbenchServices?: boolean
}
export type ToolCapability = 'read' | 'write' | 'save' | 'resource'
export interface ResolvedToolTarget { documentId: string; target: ToolTarget }
export interface ToolTargetResolver {
  resolveHandle(handle: string): ResolvedToolTarget | undefined
  /** Bind the original observed project path, or the task's formal project when path is omitted. */
  resolveProject(project?: string, path?: string): ResolvedToolTarget | undefined | Promise<ResolvedToolTarget | undefined>
}
type TargetResolution = ResolvedToolTarget[] | undefined
export interface ToolRegistration<Context> {
  name: string
  description: string
  inputSchema: z.ZodType
  manual: ToolDefinition['manual']
  capability: ToolCapability
  /** Equal values identify existing effects which must not replay an unresolved operation. */
  effect: string | null | ((input: unknown) => string | null)
  family?: ToolFamily | null
  supports(context: ToolSupportContext): boolean
  targets(input: unknown, resolver: ToolTargetResolver): TargetResolution | Promise<TargetResolution>
  handler(context: Context, input: unknown): Promise<ToolResult>
}
export type ToolRegistrationMetadata = Omit<ToolRegistration<never>, 'handler'>

/** Attach behavior to the existing parser and descriptor, without another schema or dispatch owner. */
export function toolRegistrationFor<Context>() {
  return <Name extends string, Schema extends z.ZodType>(
    tool: { name: Name; description: string; inputSchema: Schema; manual: ToolDefinition['manual'] },
    behavior: {
      capability: ToolCapability
      effect: string | null | ((input: z.output<Schema>) => string | null)
      family?: ToolFamily | null
      supports(context: ToolSupportContext): boolean
      targets(input: z.output<Schema>, resolver: ToolTargetResolver): TargetResolution | Promise<TargetResolution>
      handler(context: Context, input: z.output<Schema>): Promise<ToolResult>
    },
  ) => ({
    ...tool,
    ...behavior,
    effect: typeof behavior.effect === 'function'
      ? (input: unknown) => typeof behavior.effect === 'function' ? behavior.effect(tool.inputSchema.parse(input)) : behavior.effect
      : behavior.effect,
    callSchema: z.object({ name: z.literal(tool.name), input: tool.inputSchema }).strict(),
    targets: (input: unknown, resolver: ToolTargetResolver) => behavior.targets(tool.inputSchema.parse(input), resolver),
    handler: (context: Context, input: unknown) => behavior.handler(context, tool.inputSchema.parse(input)),
  })
}

export function handleToolTarget(input: { target: string }, resolver: ToolTargetResolver): TargetResolution {
  const target = resolver.resolveHandle(input.target)
  return target ? [target] : undefined
}
export async function projectToolTarget(input: { project?: string; path?: string }, resolver: ToolTargetResolver): Promise<TargetResolution> {
  const target = await resolver.resolveProject(input.project, input.path)
  return target ? [target] : undefined
}

/** An omitted run scope means the canonical catalog, rather than an empty task grant. */
export function hasRunDocument(context: ToolSupportContext, kind?: DocumentKind): boolean {
  return context.scopes === undefined || context.scopes.some(scope => !kind || scope.kind === kind)
}
export function hasRunWrite(context: ToolSupportContext, kinds: readonly ToolTarget['kind'][] = [], documentKind?: DocumentKind): boolean {
  return context.scopes === undefined || context.scopes.some(scope => (!documentKind || scope.kind === documentKind)
    && (scope.wholeDocumentWritable || kinds.some(kind => scope.writableTargetKinds.includes(kind))))
}
export function supportsWorkbenchService(context: ToolSupportContext, service: 'jobs' | 'compute' | 'delegation' | 'web' | 'mcp' | 'media' | 'openImages' | 'assetLibrary'): boolean {
  return context.workbenchServices !== false && context[service] !== false
}

/** The registry's classifications replace separate no-replay name lists. Unknown tools keep their own identity. */
export function registeredEffectNames(registrations: readonly ToolRegistrationMetadata[], call: ModelToolCall): string[] {
  const registration = registrations.find(tool => tool.name === call.name)
  if (!registration) return [call.name]
  let effect: string | null
  try { effect = typeof registration.effect === 'function' ? registration.effect(call.input) : registration.effect }
  catch { return [call.name] }
  if (effect === null) return []
  return [...registrations.filter(tool => tool.effect === effect).map(tool => tool.name), `effect:${effect}`]
}
