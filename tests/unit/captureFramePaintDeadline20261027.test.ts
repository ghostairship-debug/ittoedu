// @vitest-environment node
import { expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'
import { JSDOM } from 'jsdom'
import { captureFramePaintInRealm, waitForCaptureFramePaint } from '../../src/main/workbench/observation/captureFramePaint'
import { ObservationDeadline } from '../../src/main/workbench/observation/observationDeadline'

it('a deadline timer still rejects when the wall clock has not advanced to the rounded expiry', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const deadline = new ObservationDeadline(undefined, 5)
  try {
    const waiting = deadline.wait('ready', () => new Promise(() => {})).catch(error => error)
    const result = await Promise.race([waiting, new Promise(resolve => setTimeout(() => resolve('still-pending'), 80))])
    expect(result).toMatchObject({ code: 'observation-timeout', observationStage: 'ready' })
  } finally { deadline.dispose(); clock.mockRestore() }
})

it('a never-ending paint and never-acknowledged cleanup settle inside the same observation budget', async () => {
  const actions: string[] = []
  let stalled = true
  const frame = { detached: false, parent: null, framesInSubtree: [] as unknown[], executeJavaScript: async (script: string) => {
    const action = /,"(install|start|wait|dispose)",/.exec(script)![1]!
    actions.push(action)
    if (stalled && (action === 'wait' || action === 'dispose')) return new Promise(() => {})
    return undefined
  } }
  frame.framesInSubtree = [frame]
  const deadline = new ObservationDeadline(undefined, 40)
  try {
    await expect(waitForCaptureFramePaint(frame as unknown as WebFrameMain, 'first', undefined, deadline))
      .rejects.toMatchObject({ code: 'observation-timeout', observationStage: 'paint-wait' })
    expect(actions).toEqual(['install', 'start', 'wait', 'dispose'])
    stalled = false
    await waitForCaptureFramePaint(frame as unknown as WebFrameMain, 'second')
    expect(actions.slice(-4)).toEqual(['install', 'start', 'wait', 'dispose'])
  } finally { deadline.dispose() }
})

it('synchronous native cleanup failure on a closing frame cannot replace the original paint error', async () => {
  let disposed = false
  const frame = { detached: false, parent: null, framesInSubtree: [] as unknown[], executeJavaScript(script: string) {
    const action = /,"(install|start|wait|dispose)",/.exec(script)![1]!
    if (action === 'dispose') { disposed = true; throw new Error('Frame was destroyed before IPC') }
    if (action === 'wait') return Promise.reject(new Error('original paint failure'))
    return Promise.resolve(undefined)
  } }
  frame.framesInSubtree = [frame]
  await expect(waitForCaptureFramePaint(frame as unknown as WebFrameMain, 'closing')).rejects.toThrow('original paint failure')
  expect(disposed).toBe(true)
})

it.each(['font', 'animation'] as const)('realm disposal releases a pending %s wait and removes its temporary owner', async phase => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true })
  Object.defineProperty(dom.window.document, 'fonts', { value: { ready: phase === 'font' ? new Promise(() => {}) : Promise.resolve() } })
  dom.window.requestAnimationFrame = () => 7
  const cancelled: number[] = []
  dom.window.cancelAnimationFrame = id => { cancelled.push(id) }
  const run = (action: string) => dom.window.eval(`(${captureFramePaintInRealm.toString()})('owned','${action}',1000)`)
  try {
    run('install'); run('start')
    const painted = run('wait') as Promise<void>
    await new Promise<void>(resolve => setImmediate(resolve))
    run('dispose')
    await painted
    expect(Reflect.has(dom.window, '__guoling_capture_paint_owned')).toBe(false)
    if (phase === 'animation') expect(cancelled).toEqual([7])
  } finally { dom.window.close() }
})
