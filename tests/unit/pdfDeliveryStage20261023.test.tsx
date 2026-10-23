import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createComponentPlatformMixedDeliveryFixture } from '../fixtures/componentPlatformMixedDeliveryFixture'
import { useCourseDelivery, type CourseDeliveryPorts } from '../../src/renderer/app/useCourseDelivery'
import type { BuiltComponentDelivery } from '../../src/shared/workbench/frozenDelivery'

vi.mock('../../src/renderer/export/componentPlatform/delivery', () => ({ buildComponentDelivery: vi.fn() }))
vi.mock('../../src/renderer/export/componentPlatform/buildHtml', () => ({ buildComponentPublished: vi.fn() }))
vi.mock('../../src/player/componentPlatform/publishedPlayer', () => ({ mountPublishedCourseV3: vi.fn() }))
vi.mock('../../src/renderer/export/componentPlatform/capture', () => ({ createComponentDeliveryCapture: vi.fn() }))

it('keeps PDF printing cancellable until Main starts the native saving phase', async () => {
  const sample = createComponentPlatformMixedDeliveryFixture()
  let options: Parameters<CourseDeliveryPorts['exportPdf']>[1]
  let rejectPrint!: (error: unknown) => void
  const exportPdf = vi.fn<CourseDeliveryPorts['exportPdf']>(async (_input, value) => {
    options = value
    return new Promise<{ path: string } | null>((_resolve, reject) => { rejectPrint = reject; value?.signal?.addEventListener('abort', () => reject(value?.signal?.reason), { once: true }) })
  })
  const errors: unknown[] = []
  const buildOutput = async (): Promise<BuiltComponentDelivery> => ({ artifacts: [{ extension: 'pdf', suggestedName: 'sample.pdf', html: '<main class="page">sample</main>' }],
    report: { reportVersion: 1, schemaVersion: 11, projectId: sample.project.id, target: 'pdf', generatedAt: new Date().toISOString(),
      items: [], summary: { error: 0, warning: 0, info: 0, total: 0, canExport: true } } })
  const ports: CourseDeliveryPorts = {
    captureSnapshot: async () => sample.delivery, readCanonicalSnapshot: () => sample.delivery,
    compileComponent: vi.fn(), buildOutput,
    runBusy: async work => { try { return await work() } catch (error) { errors.push(error); return undefined } },
    commitStatus: vi.fn(), reportError: vi.fn(), navigateFinding: vi.fn(),
    exportHtml: vi.fn(), exportWebPackage: vi.fn(), exportBinary: vi.fn(), exportPdf,
  }
  const hook = renderHook(() => useCourseDelivery(ports, { documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null }))
  act(() => hook.result.current.exportCourse('pdf'))
  await waitFor(() => expect(exportPdf).toHaveBeenCalledOnce())
  expect(hook.result.current.exportProgress).toBe('generating')
  act(() => hook.result.current.cancelExport())
  expect(options!.signal!.aborted).toBe(true)
  await waitFor(() => expect(hook.result.current.exportProgress).toBeNull())
  expect(errors).toEqual([])

  act(() => hook.result.current.exportCourse('pdf'))
  await waitFor(() => expect(exportPdf).toHaveBeenCalledTimes(2))
  act(() => options!.onSaving!())
  expect(hook.result.current.exportProgress).toBe('saving')
  act(() => hook.result.current.cancelExport())
  expect(options!.signal!.aborted).toBe(false)
  await act(async () => { rejectPrint(new Error('native save failed')) })
  await waitFor(() => expect(hook.result.current.exportProgress).toBeNull())
  expect(errors).toHaveLength(1)
  hook.unmount()
})
