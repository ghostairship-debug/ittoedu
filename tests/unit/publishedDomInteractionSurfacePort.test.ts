import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PublishedDomInteractionSurfacePort,
  PublishedInteractionVisibilityState,
  type PublishedInteractionNodeHandle,
  type PublishedInteractionNodeOwnership,
  type PublishedInteractionNodeState,
} from '@/player/interactions/PublishedDomInteractionSurfacePort'
import type { PublishedNodeMotionContext } from '@/player/interactions/PublishedInteractionSurfacePort'
import type {
  MotionEffect,
  NodeMotionAction,
} from '@/shared/contracts/interaction-v1/types'

interface NodeHarness {
  handle: PublishedInteractionNodeHandle
  states: PublishedInteractionNodeState[]
  current(): HTMLElement
  replace(): HTMLElement
  setAvailable(value: boolean): void
}

function nodeHarness(
  root: HTMLElement,
  nodeId: string,
  options: {
    visible?: boolean
    bindable?: boolean
    motion?: boolean
    ownership?: PublishedInteractionNodeOwnership
    visibilityState?: PublishedInteractionVisibilityState
    opacity?: string
    transform?: string
  } = {},
): NodeHarness {
  let element = root.ownerDocument.createElement('div')
  element.dataset.node = nodeId
  element.style.opacity = options.opacity ?? '0.65'
  element.style.transform = options.transform ?? 'rotate(12deg)'
  root.appendChild(element)
  let available = true
  const states: PublishedInteractionNodeState[] = []
  const handle: PublishedInteractionNodeHandle = {
    nodeId,
    source: options.visibilityState ? 'global' : 'scene',
    ownership: options.ownership ?? 'native',
    visibilityState: options.visibilityState,
    resolveElement: () => element,
    isInteractionAvailable: () => available,
    canBindClick: () => options.bindable ?? true,
    canRunMotion: () => options.motion ?? true,
    authoredVisible: () => options.visible ?? true,
    applyInteractionState: (state) => {
      states.push({ ...state })
      element.hidden = !state.visible
      element.style.pointerEvents = state.clickBound ? 'auto' : 'none'
    },
    authoredMotionStyle: () => ({
      opacity: options.opacity ?? '0.65',
      transform: options.transform ?? 'rotate(12deg)',
    }),
  }
  return {
    handle,
    states,
    current: () => element,
    replace: () => {
      element.remove()
      element = root.ownerDocument.createElement('div')
      element.dataset.node = nodeId
      element.style.opacity = options.opacity ?? '0.65'
      element.style.transform = options.transform ?? 'rotate(12deg)'
      root.appendChild(element)
      return element
    },
    setAvailable: (value) => {
      available = value
    },
  }
}

function motion(
  type: NodeMotionAction['type'],
  nodeId: string,
  effect: MotionEffect = 'fade',
  durationMs = 100,
): NodeMotionAction {
  if (effect === 'slide') {
    return {
      type,
      nodeId,
      effect,
      direction: 'left',
      durationMs,
      easing: 'ease-out',
    }
  }
  return {
    type,
    nodeId,
    effect,
    durationMs,
    easing: 'ease-out',
  }
}

function context(controller = new AbortController()): {
  controller: AbortController
  value: PublishedNodeMotionContext
} {
  return {
    controller,
    value: {
      ruleId: 'rule',
      stepId: 'step',
      signal: controller.signal,
      restartFromBeginning: false,
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('PublishedDomInteractionSurfacePort', () => {
  it('delegates one bubble click without changing browser event behavior', () => {
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'button')
    const child = document.createElement('span')
    node.current().appendChild(child)
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    const calls: string[] = []
    const dispose = port.bindNodeClick('button', () => calls.push('rule'))
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    expect(dispose).toEqual(expect.any(Function))
    expect(child.dispatchEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toEqual(['rule'])
    port.destroy()
  })

  it('delegates targets from the root document realm', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const frameDocument = frame.contentDocument
    if (!frameDocument) throw new Error('iframe document unavailable')
    const root = frameDocument.createElement('section')
    frameDocument.body.appendChild(root)
    const node = nodeHarness(root, 'frame_button')
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    const listener = vi.fn()
    port.bindNodeClick('frame_button', listener)

    node.current().click()

    expect(listener).toHaveBeenCalledTimes(1)
    port.destroy()
  })

  it('keeps click ownership until the final registration is disposed', () => {
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'button')
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    const callback = vi.fn()
    const disposeFirst = port.bindNodeClick('button', callback)
    const disposeSecond = port.bindNodeClick('button', callback)

    expect(node.states.at(-1)).toEqual({ visible: true, clickBound: true })
    node.current().click()
    expect(callback).toHaveBeenCalledTimes(2)
    disposeFirst?.()
    expect(node.states.at(-1)).toEqual({ visible: true, clickBound: true })
    node.current().click()
    expect(callback).toHaveBeenCalledTimes(3)
    disposeSecond?.()
    expect(node.states.at(-1)).toEqual({ visible: true, clickBound: false })
    node.current().click()
    expect(callback).toHaveBeenCalledTimes(3)
    port.destroy()
  })

  it('returns null for inactive, absent and occupied click targets while allowing wrapper motion', async () => {
    const root = document.createElement('section')
    document.body.appendChild(root)
    const occupied = nodeHarness(root, 'video', {
      bindable: false,
      motion: true,
      ownership: 'media',
    })
    const port = new PublishedDomInteractionSurfacePort(root)
    port.refreshNodes([occupied.handle])
    expect(port.bindNodeClick('video', vi.fn())).toBeNull()
    port.setActive(true)
    expect(port.bindNodeClick('missing', vi.fn())).toBeNull()
    expect(port.bindNodeClick('video', vi.fn())).toBeNull()
    expect(await port.executeNodeMotion(
      motion('node.exit', 'video', 'none'),
      context().value,
    )).toBe(true)
    expect(occupied.states.at(-1)).toEqual({ visible: false, clickBound: false })

    occupied.setAvailable(false)
    expect(await port.executeNodeMotion(
      motion('node.enter', 'video', 'none'),
      context().value,
    )).toBe(false)
    port.destroy()
  })

  it('animates initially hidden enter and exit while preserving authored endpoints', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'answer', {
      visible: false,
      opacity: '0.4',
      transform: 'rotate(25deg)',
    })
    Object.defineProperty(node.current(), 'animate', {
      configurable: true,
      value: undefined,
    })
    const startTransforms: string[] = []
    vi.spyOn(node.current(), 'getBoundingClientRect').mockImplementation(() => {
      startTransforms.push(node.current().style.transform)
      return new DOMRect()
    })
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    expect(node.current().hidden).toBe(true)

    const enter = port.executeNodeMotion(
      motion('node.enter', 'answer', 'slide'),
      context().value,
    )
    expect(enter).toBeInstanceOf(Promise)
    expect(node.current().hidden).toBe(false)
    expect(port.localVisibilityState.resolve('answer', false)).toBe(false)
    expect(startTransforms.at(-1)).toBe(
      'translate3d(-48px, 0px, 0) rotate(25deg)',
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(await enter).toBe(true)
    expect(port.localVisibilityState.resolve('answer', false)).toBe(true)
    expect(node.current().style.opacity).toBe('0.4')
    expect(node.current().style.transform).toBe('rotate(25deg)')

    const exit = port.executeNodeMotion(
      motion('node.exit', 'answer', 'scale'),
      context().value,
    )
    expect(node.current().hidden).toBe(false)
    expect(node.current().style.transform).toBe('scale(0.84) rotate(25deg)')
    await vi.advanceTimersByTimeAsync(100)
    expect(await exit).toBe(true)
    expect(node.current().hidden).toBe(true)
    expect(node.current().style.opacity).toBe('0.4')
    expect(node.current().style.transform).toBe('rotate(25deg)')
    port.destroy()
  })

  it('aborts and restarts repeated-node motion without leaking temporary style or visibility', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'answer', { visible: false })
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    const firstContext = context()
    const first = port.executeNodeMotion(
      motion('node.enter', 'answer', 'fade', 500),
      firstContext.value,
    )
    await vi.advanceTimersByTimeAsync(10)
    firstContext.controller.abort()
    expect(await first).toBe(false)
    expect(node.current().hidden).toBe(true)
    expect(node.current().style.opacity).toBe('0.65')

    const oldRun = port.executeNodeMotion(
      motion('node.enter', 'answer', 'slide', 500),
      context().value,
    )
    const newRun = port.executeNodeMotion(
      motion('node.enter', 'answer', 'scale', 25),
      context().value,
    )
    expect(await oldRun).toBe(false)
    await vi.advanceTimersByTimeAsync(25)
    expect(await newRun).toBe(true)
    expect(node.current().hidden).toBe(false)
    expect(node.current().style.transform).toBe('rotate(12deg)')
    port.destroy()
  })

  it('keeps callbacks across rerenders and cancels stale generation motion', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'button', { visible: false })
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle], 1)
    const listener = vi.fn()
    port.bindNodeClick('button', listener)
    const staleElement = node.current()
    const staleMotion = port.executeNodeMotion(
      motion('node.enter', 'button', 'fade', 500),
      context().value,
    )
    expect(node.states.at(-1)).toEqual({ visible: true, clickBound: false })

    const currentElement = node.replace()
    port.refreshNodes([node.handle], 2)
    expect(await staleMotion).toBe(false)
    staleElement.click()
    expect(listener).not.toHaveBeenCalled()
    currentElement.click()
    expect(listener).not.toHaveBeenCalled()

    await port.executeNodeMotion(
      motion('node.enter', 'button', 'none'),
      context().value,
    )
    expect(node.states.at(-1)).toEqual({ visible: true, clickBound: true })
    currentElement.click()
    expect(listener).toHaveBeenCalledTimes(1)
    port.destroy()
  })

  it('shares global state across hosts while local reset stays local', async () => {
    const globalState = new PublishedInteractionVisibilityState()
    const rootA = document.createElement('section')
    const rootB = document.createElement('section')
    document.body.append(rootA, rootB)
    const globalA = nodeHarness(rootA, 'global_badge', { visibilityState: globalState })
    const globalB = nodeHarness(rootB, 'global_badge', { visibilityState: globalState })
    const localA = nodeHarness(rootA, 'local_note')
    const portA = new PublishedDomInteractionSurfacePort(rootA, { active: true })
    const portB = new PublishedDomInteractionSurfacePort(rootB, { active: true })
    portA.refreshNodes([globalA.handle, localA.handle])
    portB.refreshNodes([globalB.handle])

    await portA.executeNodeMotion(
      motion('node.exit', 'global_badge', 'none'),
      context().value,
    )
    expect(globalA.current().hidden).toBe(true)
    expect(globalB.current().hidden).toBe(true)
    await portA.executeNodeMotion(
      motion('node.exit', 'local_note', 'none'),
      context().value,
    )
    expect(localA.current().hidden).toBe(true)

    portA.resetLocalVisibility()
    expect(localA.current().hidden).toBe(false)
    expect(globalA.current().hidden).toBe(true)
    expect(globalB.current().hidden).toBe(true)
    portA.destroy()
    portB.destroy()
  })

  it('honors reduced motion and destroys bindings and runs idempotently', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'button', { visible: false })
    const port = new PublishedDomInteractionSurfacePort(root, {
      active: true,
      prefersReducedMotion: () => true,
    })
    port.refreshNodes([node.handle])
    const listener = vi.fn()
    port.bindNodeClick('button', listener)
    expect(await port.executeNodeMotion(
      motion('node.enter', 'button', 'fade', 100_000),
      context().value,
    )).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    node.current().click()
    expect(listener).toHaveBeenCalledTimes(1)

    const pending = port.executeNodeMotion(
      motion('node.exit', 'button', 'fade', 500),
      context().value,
    )
    // Reduced motion settles immediately; use a normal port for destroy cancellation.
    expect(await pending).toBe(true)
    const runningPort = new PublishedDomInteractionSurfacePort(root, { active: true })
    runningPort.refreshNodes([node.handle])
    const running = runningPort.executeNodeMotion(
      motion('node.enter', 'button', 'fade', 500),
      context().value,
    )
    port.destroy()
    port.destroy()
    runningPort.destroy()
    runningPort.destroy()
    expect(await running).toBe(false)
    node.current().click()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clamps an overlong authored motion duration to the V2 ceiling', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'answer')
    Object.defineProperty(node.current(), 'animate', {
      configurable: true,
      value: undefined,
    })
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    const pending = Promise.resolve(port.executeNodeMotion(
      motion('node.enter', 'answer', 'fade', 99_999),
      context().value,
    ))
    let result: boolean | null = null
    void pending.then((value) => { result = value })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(true)
    port.destroy()
  })

  it('settles a transition-free motion immediately without creating timers', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    document.body.appendChild(root)
    const node = nodeHarness(root, 'answer')
    const port = new PublishedDomInteractionSurfacePort(root, { active: true })
    port.refreshNodes([node.handle])
    expect(await port.executeNodeMotion(
      motion('node.enter', 'answer', 'none'),
      context().value,
    )).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    port.destroy()
  })
})
