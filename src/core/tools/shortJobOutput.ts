/** A prefix of retained owner logs, with a cursor that never skips an omitted entry. */
export function shortJobOutput(logs: unknown, job: string) {
  const value = logs as { entries?: Array<{ cursor: number; message: string; stream: string }> }
  if (!Array.isArray(value?.entries)) throw new Error('作业日志快照不可用')
  const entries: NonNullable<typeof value.entries> = []
  const output = { entries, complete: false, nextAfter: 0,
    source: { tool: 'job.logs', input: { job, after: 0 } } }
  for (const entry of value.entries.slice(0, 32)) {
    if (!Number.isSafeInteger(entry.cursor) || entry.cursor <= output.nextAfter || typeof entry.message !== 'string')
      throw new Error('作业日志游标无效')
    const next = { ...output, entries: [...entries, entry], nextAfter: entry.cursor,
      source: { tool: 'job.logs', input: { job, after: entry.cursor } } }
    if (new TextEncoder().encode(JSON.stringify(next)).length > 6144) break
    entries.push(entry); output.nextAfter = entry.cursor; output.source.input.after = entry.cursor
  }
  output.complete = entries.length === value.entries.length
  return output
}
