/** Bounded waiting for existing job ownership; a timeout is not completion or failure. */
export async function waitForHostWork(work: Promise<unknown> | undefined, milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 30_000) throw new Error('作业等待范围必须在 0–30000ms 内')
  if (!work || milliseconds === 0 || signal?.aborted) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => undefined
  const stopped = new Promise<void>(resolve => {
    abort = resolve
    timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) resolve()
  })
  // A rejected owner operation is still a settled job. Its durable status is the
  // source of truth; a waiter must not turn that rejection into a second request.
  try { await Promise.race([work.then(() => undefined, () => undefined), stopped]) }
  finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
