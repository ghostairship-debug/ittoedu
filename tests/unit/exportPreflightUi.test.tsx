import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentDeliveryReport,
} from '../../src/renderer/export/componentPlatform/delivery'
import { ExportPreflightDialog } from '../../src/renderer/ui/ExportPreflightDialog'

afterEach(cleanup)

function report(canExport: boolean): ComponentDeliveryReport {
  const severity = canExport ? 'warning' : 'error'
  return {
    reportVersion: 1,
    projectId: 'project',
    schemaVersion: 10,
    target: 'docx',
    generatedAt: '2026-08-11T00:00:00.000Z',
    items: [{
      severity,
      code: 'asset-bytes-missing',
      message: '节点需要处理',
      surfaceId: 'surface',
      instanceId: 'picture',
    }],
    summary: {
      error: canExport ? 0 : 1,
      warning: canExport ? 1 : 0,
      info: 0,
      total: 1,
      canExport,
    },
  }
}

describe('export preflight dialog', () => {
  it('blocks continuation on errors while keeping locate and report save available', () => {
    const onContinue = vi.fn()
    const onLocate = vi.fn()
    const onSaveReport = vi.fn()
    const onCancel = vi.fn()
    render(
      <ExportPreflightDialog
        report={report(false)}
        onCancel={onCancel}
        onContinue={onContinue}
        onLocate={onLocate}
        onSaveReport={onSaveReport}
      />,
    )

    expect(screen.queryByRole('button', { name: '继续导出' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '定位' }))
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({
      surfaceId: 'surface',
      instanceId: 'picture',
    }))
    fireEvent.click(screen.getByRole('button', { name: /保存报告/ }))
    expect(onSaveReport).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '去修复' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('allows an explicitly confirmed warning-only export', () => {
    const onContinue = vi.fn()
    const onLocate = vi.fn()
    render(
      <ExportPreflightDialog
        report={report(true)}
        onCancel={() => undefined}
        onContinue={onContinue}
        onLocate={onLocate}
        onSaveReport={() => undefined}
      />,
    )

    expect(screen.getByRole('heading', { name: 'DOCX 导出预检' })).toBeInTheDocument()
    expect(screen.getByText('警告')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '定位' }))
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', surfaceId: 'surface', instanceId: 'picture' }))
    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
