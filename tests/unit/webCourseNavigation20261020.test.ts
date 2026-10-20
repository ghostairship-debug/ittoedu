import { expect, it, vi } from 'vitest'
import { installCourseNavigationReady, type WebCourseNavigation } from '../../src/components/web/courseNavigation'

it('connects parser-time callers to the same current navigation owner and its lifecycle', async () => {
  const bridge = installCourseNavigationReady()
  const ready = (window as unknown as { courseNavigationReady: Promise<WebCourseNavigation> }).courseNavigationReady
  let location = 'page-one'
  const read = vi.fn(() => ({ locationId: location, scenes: [{ id: 'page-one', title: '一' }, { id: 'page-two', title: '二' }] }))
  const unsubscribe = vi.fn(), subscribe = vi.fn(() => unsubscribe)
  const execute = vi.fn(async () => { location = 'page-two'; return true })
  const owner = { read, readLocation: () => location, subscribe, execute, canExecute: () => true } as unknown as WebCourseNavigation
  bridge.connect(owner)
  const navigation = await ready
  const off = navigation.subscribe(() => {})
  expect(navigation.read()).toBe(read.mock.results.at(-1)!.value)
  expect(navigation.canExecute({ type: 'step.next' })).toBe(true)
  expect(await navigation.execute({ type: 'step.next' })).toBe(true)
  expect(execute).toHaveBeenCalledExactlyOnceWith({ type: 'step.next' }, undefined)
  expect(navigation.readLocation()).toBe('page-two')
  off(); expect(unsubscribe).toHaveBeenCalledOnce()
  bridge.dispose()
  expect('courseNavigationReady' in window).toBe(false)
})

it('diagnoses missing navigation and restores the prior realm property on exit', async () => {
  Object.defineProperty(window, 'courseNavigationReady', { configurable: true, value: 'previous' })
  const bridge = installCourseNavigationReady()
  const ready = (window as unknown as { courseNavigationReady: Promise<WebCourseNavigation> }).courseNavigationReady
  bridge.connect()
  await expect(ready).rejects.toThrow('未接通正式课程导航')
  bridge.dispose()
  expect((window as unknown as { courseNavigationReady: unknown }).courseNavigationReady).toBe('previous')
  Reflect.deleteProperty(window, 'courseNavigationReady')
})
