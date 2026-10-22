export * from '../../shared/workbench/executionTimelineReadModel'
import { readableExecutionText } from '../../shared/workbench/executionDisplayText'
export { readableExecutionText } from '../../shared/workbench/executionDisplayText'
// By-content memo for redaction. Streaming replays the same strings every
// turn, so without a cache each render runs 5 regex passes over every visible
// label/text/detail. Bounded LRU: refresh on hit, drop the oldest entry when full.
const READABLE_CACHE_LIMIT = 2000
const readableCache = new Map<string, string>()
/** Presentation only: never interprets HTML, opens links, or replays tool arguments. */
export function readableExecutionData(value: string): string {
  const hit = readableCache.get(value)
  if (hit !== undefined) {
    readableCache.delete(value)
    readableCache.set(value, hit)
    return hit
  }
  const result = readableExecutionText(value)
  if (readableCache.size >= READABLE_CACHE_LIMIT) {
    const oldest = readableCache.keys().next().value
    if (oldest !== undefined) readableCache.delete(oldest)
  }
  readableCache.set(value, result)
  return result
}

