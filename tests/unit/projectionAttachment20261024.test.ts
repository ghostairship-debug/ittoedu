import { afterEach, expect, it, vi } from 'vitest'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'

const worlds: ComponentRuntimeWorld[] = []
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.dispose())); document.body.replaceChildren() })
function fixture() {
  const world = new ComponentRuntimeWorld('projection-attachment', { mode: 'edit' })
  worlds.push(world)
  const host = document.createElement('div'); document.body.append(host)
  return { world, host }
}

it('keeps the latest attachment when a reused host receives a late release, then parks once without resetting state', () => {
  const { world, host } = fixture()
  const first = world.attachProjection('program', { content: host, target: host, subtree: host })
  const root = host.firstElementChild!
  const button = document.createElement('button'); button.textContent = 'running 7'; root.append(button)
  world.setState('program.counter', 7)
  const second = world.attachProjection('program', { content: host, target: host, subtree: host })
  first()
  expect(root.parentElement).toBe(host)
  expect(world.contentElement('program')).toBe(host)
  second(); second()
  expect(root.isConnected).toBe(true)
  expect(root.parentElement).not.toBe(host)
  expect(world.contentElement('program')).toBeUndefined()
  const next = document.createElement('div'); document.body.append(next)
  world.attachProjection('program', { content: next, target: next, subtree: next })
  expect(next.firstElementChild).toBe(root)
  expect(button.textContent).toBe('running 7')
  expect(world.getState('program.counter')).toBe(7)
})

it('cancels a released or superseded delayed mount before it can move a newer runtime root', async () => {
  const { world, host } = fixture(), oldPrepare = vi.fn()
  const release = world.attachProjection('program', { content: host, subtree: host, prepare: oldPrepare, defer: true })
  const next = document.createElement('div'); document.body.append(next)
  world.attachProjection('program', { content: next, target: next, subtree: next })
  release()
  await Promise.resolve()
  expect(oldPrepare).not.toHaveBeenCalled()
  expect(world.contentElement('program')).toBe(next)
  expect(next.querySelector('[data-component-runtime-root="program"]')).not.toBeNull()
  const cancelled = world.attachProjection('never', { content: host, subtree: host, defer: true })
  cancelled(); await Promise.resolve()
  expect(host.childElementCount).toBe(0)
})

it('parks nested runtime roots before a caller removes its own view subtree and retires them only with the World', async () => {
  const { world, host } = fixture()
  const child = document.createElement('div'); host.append(child)
  world.bind('child', child)
  const root = child.firstElementChild!
  const release = world.attachProjection('container', { subtree: host, defer: true })
  release(); host.remove()
  expect(root.isConnected).toBe(true)
  await world.dispose()
  expect(root.isConnected).toBe(false)
  expect(world.contentElement('child')).toBeUndefined()
})
