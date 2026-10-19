import { expect, it, vi } from 'vitest'
import { COMPONENT_AUTHOR_HIT, requestComponentAuthorHit, type ComponentAuthorHitRequest } from '../../src/renderer/components/componentAuthorHit'

it('reaches the Host private root through the World slot without changing the local point', async () => {
  const mount = document.createElement('div'), worldRoot = document.createElement('div'), activeRoot = document.createElement('div')
  mount.dataset.componentRender = 'roof-label'; worldRoot.dataset.componentRuntimeRoot = 'roof-label'
  activeRoot.dataset.componentInstanceId = 'roof-label'; worldRoot.append(activeRoot); mount.append(worldRoot)
  const point = { x: 239.5, y: 237 }, receive = vi.fn((event: Event) => {
    const request = (event as CustomEvent<ComponentAuthorHitRequest>).detail
    event.preventDefault()
    expect(request.point).toBe(point)
    request.resolve({ authorKey: 'roof-text', painted: true })
  })
  activeRoot.addEventListener(COMPONENT_AUTHOR_HIT, receive)
  expect(await requestComponentAuthorHit(mount, point)).toEqual({ authorKey: 'roof-text', painted: true })
  expect(receive).toHaveBeenCalledOnce()
})

it('keeps no-realm fallback and never selects another instance or a nested author marker', async () => {
  const mount = document.createElement('div'), other = document.createElement('div'), author = document.createElement('div'), nested = document.createElement('div')
  mount.dataset.componentRender = 'roof-label'; other.dataset.componentInstanceId = 'other'; nested.dataset.componentInstanceId = 'roof-label'
  author.append(nested); mount.append(other, author)
  const unexpected = vi.fn((event: Event) => event.preventDefault())
  other.addEventListener(COMPONENT_AUTHOR_HIT, unexpected); nested.addEventListener(COMPONENT_AUTHOR_HIT, unexpected)
  expect(await requestComponentAuthorHit(mount, { x: 20, y: 30 })).toBeUndefined()
  expect(unexpected).not.toHaveBeenCalled()
})
