import type { Page } from '@playwright/test'

/**
 * D5 measurement helper for a real mounted Flow UI. Call once per externally
 * driven change after fonts/resources are ready. `act` must resolve immediately
 * after its last user input (not after the layout has been allowed to settle).
 * The caller owns fixture creation, actual UI interactions, save and cold open.
 */
export async function sampleFlowD5(
  page: Page,
  name: string,
  selectors: Record<string, string>,
  act: () => Promise<void>,
  history: () => Promise<{ revision: number; undoDepth: number; redoDepth: number }>,
) {
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.message)
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(message.text())
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  try {
    await page.evaluate(async () => { await document.fonts.ready })
    for (const selector of Object.values(selectors)) await page.locator(selector).first().waitFor({ state: 'visible' })
    // Install the sampler before the action, so history IPC cannot hide early
    // layout changes. Mark the deadline immediately after the last input.
    await page.evaluate(selectorsInPage => {
      const state = { frames: [] as Array<{ at: number; boxes: Record<string, number[]>; missing: string[] }>, errors: [] as string[], running: true, mark: 0 }
      ;(window as any).__flowD5 = state
      const onWindowError = (event: ErrorEvent) => { if (state.running) state.errors.push(event.message) }
      ;(state as any).dispose = () => window.removeEventListener('error', onWindowError)
      window.addEventListener('error', onWindowError)
      const sample = () => {
        if (!state.running) return
        const boxes: Record<string, number[]> = {}, missing: string[] = []
        for (const [key, selector] of Object.entries(selectorsInPage)) {
          const node = Array.from(document.querySelectorAll(selector)).find(candidate => {
            const rect = candidate.getBoundingClientRect(), style = getComputedStyle(candidate)
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
          })
          if (!node) { missing.push(key); continue }
          const rect = node.getBoundingClientRect()
          boxes[key] = [rect.x, rect.y, rect.width, rect.height]
        }
        state.frames.push({ at: performance.now(), boxes, missing })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, selectors)
    await act()
    await page.evaluate(() => { (window as any).__flowD5.mark = performance.now() })
    const before = await history()
    const result: { frames: Array<{ t: number; boxes: Record<string, number[]>; missing: string[] }>; windowErrors: string[] } = await page.evaluate(async () => {
      const state = (window as any).__flowD5
      await new Promise<void>(resolve => {
        // Observe for two full seconds after the first frame at/after the 1 s deadline.
        // A fixed 3.1 s stop can truncate this window when resizing stalls a frame.
        const check = () => {
          const frames = state.frames.filter((frame: any) => frame.at - state.mark >= 1000)
          if (!state.running || frames.length >= 2 && frames[frames.length - 1].at - frames[0].at >= 2000 || performance.now() - state.mark >= 6500) resolve()
          else requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })
      state.running = false
      state.dispose()
      return { frames: state.frames.map((frame: any) => ({ t: frame.at - state.mark, boxes: frame.boxes, missing: frame.missing })), windowErrors: state.errors as string[] }
    })
    const after = await history()
    const stable = result.frames.filter(frame => frame.t >= 1000)
    const insufficient = stable.length < 2 || stable[0]!.t > 1100 || stable[stable.length - 1]!.t - stable[0]!.t < 2000
    const maxFrameGap = stable.length < 2 ? null : Math.max(...stable.slice(1).map((frame, index) => frame.t - stable[index]!.t))
    const ranges: Record<string, number[]> = {}
    for (const key of Object.keys(selectors)) {
      ranges[key] = [0, 1, 2, 3].map(i => {
        const values = stable.flatMap(frame => frame.boxes[key] ? [frame.boxes[key]![i]!] : [])
        return values.length ? Math.max(...values) - Math.min(...values) : Number.POSITIVE_INFINITY
      })
    }
    const issues: string[] = []
    const missingInWindow = stable.flatMap(frame => frame.missing.map(key => ({ t: frame.t, key })))
    if (missingInWindow.length) issues.push(`sample elements missing during stability window: ${[...new Set(missingInWindow.map(item => item.key))].join(', ')}`)
    if (insufficient) issues.push('insufficient frames to establish the full 1 s deadline and 2 s observation')
    if (maxFrameGap !== null && maxFrameGap > 100) issues.push(`sampling gap ${maxFrameGap.toFixed(1)} ms; cannot establish continuous stability`)
    if (Object.values(ranges).some(values => values.some(value => value > 0.5))) issues.push('geometry varies by more than 0.5 CSS px in the 2 s observation window')
    // Detect sustained alternating values even when their total span is below
    // the tolerance. Collapse adjacent near-identical samples first.
    for (const key of Object.keys(selectors)) for (let axis = 0; axis < 4; axis++) {
      const changes: number[] = []
      for (const frame of stable) {
        const value = frame.boxes[key]?.[axis]
        if (value === undefined) continue
        if (!changes.length || Math.abs(value - changes[changes.length - 1]!) > 0.05) changes.push(value)
      }
      for (let i = 5; i < changes.length; i++) {
        const six = changes.slice(i - 5, i + 1)
        if (six.every((value, j) => j < 2 || Math.abs(value - six[j - 2]!) <= 0.05)) {
          issues.push(`repeated two-value oscillation: ${key} axis ${axis}`)
          break
        }
      }
    }
    if (before.revision !== after.revision || before.undoDepth !== after.undoDepth || before.redoDepth !== after.redoDepth) issues.push('document revision or History changed during observation')
    issues.push(...result.windowErrors, ...errors)
    return { name, before, after, ranges, maxFrameGap, missingInWindow, frames: result.frames, issues, passed: issues.length === 0 }
  } finally {
    await page.evaluate(() => { const state = (window as any).__flowD5; if (state) { state.running = false; state.dispose() } }).catch(() => undefined)
    page.off('pageerror', onError)
    page.off('console', onConsole)
  }
}
