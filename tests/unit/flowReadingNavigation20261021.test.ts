import { afterEach, expect, it } from 'vitest'
import { createFlowReadingNavigation } from '../../src/shared/flowReading'

afterEach(() => document.body.replaceChildren())

function reading(height: number, stops: number[]) {
  const scroll = document.createElement('div'), body = document.createElement('article')
  scroll.append(body); document.body.append(scroll)
  let top = 0
  Object.defineProperties(scroll, {
    clientHeight: { value: 200 }, clientTop: { value: 0 },
    scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(height - 200, value)) } },
  })
  Object.defineProperty(body, 'offsetWidth', { value: 500 })
  scroll.getBoundingClientRect = () => new DOMRect(0, 0, 500, 200)
  body.getBoundingClientRect = () => new DOMRect(0, -top, 500, height)
  const targets = stops.map((position, index) => {
    const element = document.createElement('h2'); element.textContent = `标题${index}`; body.append(element)
    element.getBoundingClientRect = () => new DOMRect(0, position - top, 500, 30)
    return element
  })
  const ids = targets.map((_, index) => String(index))
  const navigation = createFlowReadingNavigation(() => ({ scroll, body }), id => targets[Number(id)])
  return { scroll, targets, ids, navigation, active: () => navigation.readReading(ids)?.activeInstanceId }
}

it('retains distinct explicit headings when the entire article fits in one viewport', () => {
  const h = reading(160, [0, 80])
  expect(h.active()).toBe('0')
  expect(h.navigation.goToInstance('1')).toBe(true)
  expect(h.scroll.scrollTop).toBe(0)
  expect(h.active()).toBe('1')
  expect(h.navigation.goToInstance('0')).toBe(true)
  expect(h.active()).toBe('0')
})

it('does not skip a first heading that is still below a long introduction', () => {
  const h = reading(1000, [450, 700])
  expect(h.active()).toBeNull()
  h.navigation.goToInstance('0')
  expect(h.active()).toBe('0')
})

it('keeps adjacent final headings navigable and releases the explicit target after manual scroll and reset', () => {
  const h = reading(1000, [0, 450, 820, 900])
  expect(h.navigation.goToInstance('3')).toBe(true)
  expect(h.scroll.scrollTop).toBe(800)
  expect(h.active()).toBe('3')
  expect(h.navigation.goToInstance('2')).toBe(true)
  expect(h.scroll.scrollTop).toBe(800)
  expect(h.active()).toBe('2')
  h.scroll.scrollTop = 400
  expect(h.active()).toBe('0')
  h.scroll.scrollTop = 800
  expect(h.active()).toBe('3')
  h.navigation.goToInstance(null)
  expect(h.scroll.scrollTop).toBe(0)
  expect(h.active()).toBe('0')
})

it('releases a removed or hidden heading without restoring it when it reappears', () => {
  const h = reading(160, [0, 80])
  h.navigation.goToInstance('1')
  h.targets[1].getBoundingClientRect = () => new DOMRect()
  expect(h.active()).toBe('0')
  h.targets[1].getBoundingClientRect = () => new DOMRect(0, 80, 500, 30)
  expect(h.active()).toBe('0')
})
