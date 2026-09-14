import { z } from 'zod'
import type { AiTask } from './localAgentTaskContract'
import { workspaceIdentityKey } from './workspaceIdentity'

const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const MAX_AI_TASK_INPUT_METRICS_ENTRIES = 256

/** JSON transport byte counts, never model tokens or native history/tool usage. */
export const localAgentInputMetricsSchema = z.object({
  boundary: z.enum(['native-turn-params', 'native-user-message']),
  promptUtf8Bytes: byteCount,
  promptJsonBytes: byteCount,
  outputSchemaJsonBytes: byteCount,
  otherHostJsonBytes: byteCount,
  hostTechnicalJsonBytes: byteCount,
  imageTransportJsonBytes: byteCount,
  totalTransportJsonBytes: byteCount,
}).strict().superRefine((metrics, ctx) => {
  if (metrics.promptJsonBytes < metrics.promptUtf8Bytes + 2) {
    ctx.addIssue({ code: 'custom', message: 'JSON 提示字符串字节数不能少于正文与引号' })
  }
  if (metrics.promptJsonBytes + metrics.outputSchemaJsonBytes + metrics.otherHostJsonBytes !== metrics.hostTechnicalJsonBytes
    || metrics.hostTechnicalJsonBytes + metrics.imageTransportJsonBytes !== metrics.totalTransportJsonBytes) {
    ctx.addIssue({ code: 'custom', message: '原生输入字节分项不闭合' })
  }
})
export type LocalAgentInputMetrics = z.infer<typeof localAgentInputMetricsSchema>

export const aiTaskInputMetricsEntrySchema = z.object({
  runId: z.uuid(), observationId: z.uuid(), metrics: localAgentInputMetricsSchema,
}).strict()
export const aiTaskInputMetricsSchema = z.object({
  version: z.literal(1), entries: z.array(aiTaskInputMetricsEntrySchema).max(MAX_AI_TASK_INPUT_METRICS_ENTRIES),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.entries.map(entry => entry.runId)).size !== input.entries.length) {
    ctx.addIssue({ code: 'custom', message: '重复原生回合输入计量' })
  }
})

const utf8 = new TextEncoder()
function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError('原生输入必须可编码为 JSON')
  return utf8.encode(json).byteLength
}

/**
 * Called at the actual adapter send boundary. technicalTransport is that same
 * payload with image content entries removed; the difference includes their
 * JSON delimiters. Key names, separators and all remaining fields are otherHost.
 * No prompt, image content, paths or model configuration survive this function.
 */
export function measureLocalAgentInput(input: {
  boundary: LocalAgentInputMetrics['boundary']
  prompt: string
  transport: unknown
  technicalTransport: unknown
  outputSchema?: unknown
}): LocalAgentInputMetrics {
  const promptUtf8Bytes = utf8.encode(input.prompt).byteLength
  const promptJsonBytes = jsonBytes(input.prompt)
  const outputSchemaJsonBytes = input.outputSchema === undefined ? 0 : jsonBytes(input.outputSchema)
  const hostTechnicalJsonBytes = jsonBytes(input.technicalTransport)
  const totalTransportJsonBytes = jsonBytes(input.transport)
  return localAgentInputMetricsSchema.parse({
    boundary: input.boundary, promptUtf8Bytes, promptJsonBytes, outputSchemaJsonBytes,
    otherHostJsonBytes: hostTechnicalJsonBytes - promptJsonBytes - outputSchemaJsonBytes,
    hostTechnicalJsonBytes,
    imageTransportJsonBytes: totalTransportJsonBytes - hostTechnicalJsonBytes,
    totalTransportJsonBytes,
  })
}

type InputMetricsIdentity = Pick<AiTask, 'taskId' | 'epoch' | 'observationId' | 'workspace'>

/** First confirmed send per native run; stale callbacks and duplicate ACKs cannot replace it. */
export function recordAiTaskInputMetrics(
  task: AiTask, observed: InputMetricsIdentity, runId: string, metrics: LocalAgentInputMetrics,
): AiTask {
  if (!task.execution || !task.observationId || task.taskId !== observed.taskId || task.epoch !== observed.epoch
    || task.observationId !== observed.observationId
    || workspaceIdentityKey(task.workspace) !== workspaceIdentityKey(observed.workspace)) return task
  const entries = task.execution.inputMetrics?.entries ?? []
  if (entries.length >= MAX_AI_TASK_INPUT_METRICS_ENTRIES || entries.some(entry => entry.runId === runId)
    || task.execution.timing?.entries.some(entry => entry.runId === runId && entry.observationId !== observed.observationId)) return task
  const entry = aiTaskInputMetricsEntrySchema.safeParse({ runId, observationId: task.observationId, metrics })
  if (!entry.success) return task
  return { ...task, execution: { ...task.execution, inputMetrics: { version: 1, entries: [...entries, entry.data] } } }
}
