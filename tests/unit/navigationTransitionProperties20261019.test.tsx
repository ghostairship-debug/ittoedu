import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComponentClickNavigationProperties, type ComponentClickNavigationPropertiesContext } from '../../src/renderer/ui/properties/ComponentClickNavigationProperties'
import { componentClickNavigationEdits, componentClickNavigationView, INTERACTIONS_DEFINITION } from '../../src/shared/componentInteractionData'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { NavigationTransitionFields } from '../../src/renderer/ui/properties/NavigationTransitionFields'

it('edits ordinary page presets and retains advanced tracks when changing the target', async () => {
  const onChange = vi.fn(async () => {}), context: ComponentClickNavigationPropertiesContext = {
    action: { type: 'scene.go', sceneId: 'A', targetStateId: 'detail', transition: { outgoing: { keyframes: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: 500 } } } },
    otherActions: false, unavailableReason: null, surfaceId: 'A', scenes: [{ id: 'A', name: 'A', presentation: { states: [{ id: 'detail', name: 'Detail' }] } }, { id: 'B', name: 'B' }],
    onChange, onOpenProfessional() {},
  }
  const view = render(<ComponentClickNavigationProperties context={context} />)
  fireEvent.change(screen.getByLabelText('目标页面'), { target: { value: 'B' } })
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ type: 'scene.go', sceneId: 'B', transition: context.action!.transition }))
  await waitFor(() => expect(screen.getByLabelText('页面转场')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('页面转场'), { target: { value: 'slide' } })
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ ...context.action, transition: { effect: 'slide', direction: 'left', durationMs: 240, easing: 'ease-out' } }))
  view.unmount()
})

it('keeps location.go transition in the current click property projection', () => {
  const project = createBlankCourseProjectV10(), surfaceId = project.surfaces[0].id
  project.definitions.node = { id: 'node', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  project.instances.node = { id: 'node', definitionId: 'node', data: {} }; project.surfaces[0].childIds.push('node')
  project.instances.rules = { id: 'rules', definitionId: INTERACTIONS_DEFINITION.id, attachments: [{ instanceId: 'rules', target: { kind: 'surface', surfaceId } }],
    data: { rules: [{ id: 'r', name: 'r', enabled: true, trigger: { type: 'node.click', nodeId: 'node' }, conditions: [], actions: [{ id: 'a', start: 'after-previous', delayMs: 0,
      action: { type: 'location.go', locationId: surfaceId, transition: { effect: 'fade', durationMs: 320 } } }] }] } }
  project.surfaces[0].childIds.push('rules')
  const target = { project, surfaceId, instanceId: 'node', activeStateId: null }
  const view = componentClickNavigationView(target)
  expect(view.action).toEqual({ type: 'scene.go', sceneId: surfaceId, transition: { effect: 'fade', durationMs: 320 } })
  expect(componentClickNavigationEdits(target, view.action!)[0]).toMatchObject({ type: 'data.set', value: [expect.objectContaining({ actions: [expect.objectContaining({ action: view.action })] })] })
})

it('shows the existing implicit fade and its original defaults for a short transition descriptor', () => {
  const view = render(<NavigationTransitionFields transition={{}} onChange={() => {}} />)
  expect(screen.getByLabelText('页面转场')).toHaveValue('fade')
  expect(screen.getByLabelText('转场时长（毫秒）')).toHaveValue('300')
  expect(screen.getByLabelText('转场缓动')).toHaveValue('linear')
  view.unmount()
})

it('disables transitions without requiring a presentation root, and falls back in a browser without snapshots', async () => {
  const project = createBlankCourseProjectV10(), first = project.surfaces[0].id
  project.surfaces.push({ id: 'B', kind: 'slide', title: 'B', childIds: [], designSize: { width: 800, height: 600 } })
  let current = first
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => current, select(id) { current = id } })
  expect(await owner.execute({ type: 'scene.next', transition: { effect: 'none' } })).toBe(true)
  expect(await owner.execute({ type: 'scene.previous', transition: { effect: 'fade', durationMs: 0 } })).toBe(true)
  owner.dispose()
  const root = document.createElement('main'); document.body.append(root)
  const fallback = new ComponentNavigationOwner({ project: () => project, surfaceId: () => current, select(id) { current = id }, presentationRoot: () => root })
  expect(await fallback.execute({ type: 'scene.next', transition: { effect: 'fade' } })).toBe(true)
  expect(current).toBe('B'); fallback.dispose(); root.remove()
})
