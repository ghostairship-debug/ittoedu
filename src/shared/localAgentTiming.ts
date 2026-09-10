import { MAX_AI_TASK_TIMING_ENTRIES, type AiTask, type AiTaskTimingStage } from './localAgentTaskContract'

type TimingIdentity = Pick<AiTask, 'taskId' | 'epoch' | 'observationId'>

/** Pure update for the existing task owner. Full buffers and stale asynchronous work are harmless. */
export function recordAiTaskTiming(task: AiTask, observed: TimingIdentity, runId: string, stage: AiTaskTimingStage, at = Date.now()): AiTask {
  if (!task.execution || !task.observationId || task.taskId !== observed.taskId || task.epoch !== observed.epoch
    || task.observationId !== observed.observationId || !Number.isSafeInteger(at) || at < 0) return task
  const entries = task.execution.timing?.entries ?? []
  if (entries.length >= MAX_AI_TASK_TIMING_ENTRIES || entries.some(entry => entry.runId === runId
    && (entry.stage === stage || entry.observationId !== observed.observationId))) return task
  return { ...task, execution: { ...task.execution, timing: { version: 1,
    entries: [...entries, { runId, observationId: task.observationId, stage, at }],
  } } }
}

/** Read-only diagnostic projection. Missing marks and backwards wall-clock jumps remain unknown. */
export function summarizeAiTaskTiming(task: AiTask) {
  const runs = new Map<string, { runId: string; observationId: string; marks: Partial<Record<AiTaskTimingStage, number>> }>()
  for (const entry of task.execution?.timing?.entries ?? []) {
    const run = runs.get(entry.runId) ?? { runId: entry.runId, observationId: entry.observationId, marks: {} }
    run.marks[entry.stage] = entry.at
    runs.set(entry.runId, run)
  }
  return [...runs.values()].map(run => {
    const elapsed = (start: AiTaskTimingStage, end: AiTaskTimingStage): number | null => {
      const from = run.marks[start], to = run.marks[end]
      return from !== undefined && to !== undefined && to >= from ? to - from : null
    }
    return { ...run, durationsMs: {
      nativeOpen: elapsed('nativeOpenStarted', 'nativeOpened'),
      turnDispatch: elapsed('turnDispatchStarted', 'turnAccepted'),
      acceptedToFirstNativeEvent: elapsed('turnAccepted', 'firstNativeEvent'),
      firstNativeEventToCandidateParsed: elapsed('firstNativeEvent', 'candidateParsed'),
      preparedToCandidateParsed: elapsed('requestPrepared', 'candidateParsed'),
      candidateParsedToHostResultRecorded: elapsed('candidateParsed', 'hostResultRecorded'),
      candidateParsedToHostCommitRecorded: elapsed('candidateParsed', 'hostCommitRecorded'),
    } }
  })
}
