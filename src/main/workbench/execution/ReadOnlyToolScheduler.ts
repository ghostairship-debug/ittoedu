/**
 * A deliberately small allowlist. A tool is not parallel merely because its name
 * contains `read`: external GET/MCP calls, material extraction, observation
 * resources and context image delivery can change host or remote state.
 */
const independentReadNames = new Set([
  'read', 'inspect', 'listChildren',
  'file.read', 'file.grep',
  'material.list', 'material.find',
  'skills.list', 'skills.read',
])

export function isIndependentReadTool(name: string): boolean {
  return independentReadNames.has(name)
}

export type ToolRoundOutcome<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }

export interface OrderedToolRoundOptions<T extends { call: { name: string } }, R> {
  /** Fetches a tool result. Parallel reads may issue read handles but must not publish a receipt or commit content here. */
  execute(tool: T, index: number, signal?: AbortSignal): Promise<R>
  /** Publishes one result/receipt. Called in provider order, including failures. */
  commit(tool: T, outcome: ToolRoundOutcome<R>, index: number): Promise<void>
  /** Can only narrow the built-in pure-read allowlist. */
  mayParallel?(tool: T, index: number): boolean
  /** The initial ceiling is four; callers may lower but cannot raise it. */
  maxParallel?: number
  signal?: AbortSignal
}

function stopped(): Error {
  const error = new Error('工具轮已停止，后续工具未开始')
  error.name = 'AbortError'
  return error
}

async function settle<R>(task: () => Promise<R>): Promise<ToolRoundOutcome<R>> {
  try { return { status: 'fulfilled', value: await task() } }
  catch (reason) { return { status: 'rejected', reason } }
}

/**
 * Execute contiguous, independent reads in windows of at most four. A write,
 * approval, dependency-changing or unknown tool is a serial barrier. Read
 * results are committed in the original model tool order, even when a later
 * read finishes first. In-flight reads settle before a later write can start.
 */
export async function runToolRoundInOrder<T extends { call: { name: string } }, R>(
  tools: readonly T[], options: OrderedToolRoundOptions<T, R>,
): Promise<void> {
  const requested = options.maxParallel ?? 4
  const width = Number.isFinite(requested) ? Math.max(1, Math.min(4, Math.floor(requested))) : 4
  let index = 0
  while (index < tools.length) {
    if (options.signal?.aborted) throw stopped()
    const eligible = (at: number) => isIndependentReadTool(tools[at].call.name)
      && (options.mayParallel?.(tools[at], at) ?? true)
    if (!eligible(index)) {
      const outcome = await settle(() => options.execute(tools[index], index, options.signal))
      // A side effect can have happened just before stop; its receipt must be
      // archived even if the signal changed while execute was in flight.
      await options.commit(tools[index], outcome, index)
      index += 1
      continue
    }
    const from = index
    while (index < tools.length && index - from < width && eligible(index)) index += 1
    const started = tools.slice(from, index).map((tool, offset) =>
      settle(() => options.execute(tool, from + offset, options.signal)))
    const outcomes = await Promise.all(started)
    for (let offset = 0; offset < outcomes.length; offset++)
      await options.commit(tools[from + offset], outcomes[offset], from + offset)
  }
}
