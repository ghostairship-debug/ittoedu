import { describe, expect, it } from 'vitest'
import { SlideAuthoringObservationReady } from '../../src/renderer/ui/workspaces/slideAuthoringObservationReady'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('Slide Published command readiness', () => {
  it('waits for every incremental command, including work queued while the first ACK is resolving', async () => {
    const ready = new SlideAuthoringObservationReady(), generation = {}
    ready.begin(generation)
    const first = deferred(), second = deferred()
    ready.track(generation, first.promise.then(() => { ready.track(generation, second.promise) }))
    let observed = false
    const observation = ready.waitForReady(generation).then(() => { observed = true })
    first.resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(observed).toBe(false)
    second.resolve(); await observation
    expect(observed).toBe(true)
  })

  it('does not let an old generation completion release the current canvas', async () => {
    const ready = new SlideAuthoringObservationReady(), oldGeneration = {}, currentGeneration = {}
    const old = deferred(), current = deferred()
    ready.begin(oldGeneration); ready.track(oldGeneration, old.promise)
    const oldObservation = ready.waitForReady(oldGeneration)
    ready.begin(currentGeneration); ready.track(currentGeneration, current.promise)
    let observed = false
    const observation = ready.waitForReady(currentGeneration).then(() => { observed = true })
    const oldFailure = expect(oldObservation).rejects.toThrow(/销毁|失效|同步/)
    old.resolve(); await oldFailure
    expect(observed).toBe(false)
    current.resolve(); await observation
    expect(observed).toBe(true)
  })

  it('keeps an actual command failure visible and only clears it for a new mounted generation', async () => {
    const ready = new SlideAuthoringObservationReady(), generation = {}, failed = deferred()
    ready.begin(generation); ready.track(generation, failed.promise)
    failed.reject(new Error('Published update rejected'))
    await Promise.resolve()
    await expect(ready.waitForReady(generation)).rejects.toThrow('Published update rejected')
    ready.end(generation)
    await expect(ready.waitForReady(generation)).rejects.toThrow('尚未同步或已经失效')
    const next = {}; ready.begin(next)
    await expect(ready.waitForReady(next)).resolves.toBeUndefined()
  })
})
