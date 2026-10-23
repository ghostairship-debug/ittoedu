import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PptxImportForm } from '../../src/renderer/ui/productivity/PptxImportForm'
import { createComponentPlatformMixedDeliveryFixture } from '../fixtures/componentPlatformMixedDeliveryFixture'
import type { ProductivityContext } from '../../src/renderer/authoring/productivity'

const originalAPI = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
afterEach(() => { if (originalAPI) Object.defineProperty(window, 'desktopAPI', originalAPI); else Reflect.deleteProperty(window, 'desktopAPI') })

it('keeps legacy import disabled and shows cancellation until Main acknowledges cleanup', async () => {
  let finishCancel!: () => void
  const cancel = new Promise<void>(resolve => { finishCancel = resolve })
  const legacyPpt = vi.fn(({ operation }: { operation: string }) => operation === 'cancel' ? cancel.then(() => null) : new Promise<never>(() => {}))
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { legacyPpt } })
  const sample = createComponentPlatformMixedDeliveryFixture()
  const context: ProductivityContext = { document: sample.project, target: {
    documentId: sample.snapshot.documentId, epoch: sample.snapshot.epoch, project: sample.project,
    resources: sample.resources, editingProject: sample.project, activeStateId: null,
    surfaceId: sample.project.rootIds[0] ?? null, instanceIds: [], instanceId: null,
  } }
  render(<PptxImportForm getContext={() => context} getAssetFiles={() => sample.resources.assets} onCommit={async () => true} onClose={vi.fn()} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导入旧版 PPT' })) })
  expect(legacyPpt).toHaveBeenCalledWith({ operation: 'select' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消读取' })) })
  expect(screen.getByRole('status').textContent).toContain('等待转换清理完成')
  expect(screen.getByRole('button', { name: '导入旧版 PPT' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '正在取消读取…' })).toBeDisabled()

  await act(async () => { finishCancel(); await cancel })
  expect(screen.getByRole('button', { name: '导入旧版 PPT' })).not.toBeDisabled()
  expect(screen.queryByRole('status')).toBeNull()
})
