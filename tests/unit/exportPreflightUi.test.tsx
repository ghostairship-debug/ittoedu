import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CourseProjectExportPreflightReportV1,
} from '../../src/renderer/export/exportPreflight'
import { ExportPreflightDialog } from '../../src/renderer/ui/ExportPreflightDialog'

afterEach(cleanup)

function report(canExport: boolean): CourseProjectExportPreflightReportV1 {
  const severity = canExport ? 'warning' : 'error'
  return {
    reportVersion: 1,
    projectId: 'project',
    schemaVersion: 9,
    target: 'pptx',
    generatedAt: '2026-08-11T00:00:00.000Z',
    items: [{
      severity,
      code: 'asset-bytes-missing',
      message: '节点需要处理',
      target: 'pptx',
      diagnosticTarget: {
        version: 1,
        kind: 'layer-item',
        owner: 'scene',
        projectId: 'project',
        surfaceId: 'surface',
        sceneId: 'scene',
        layerItemId: 'node',
      },
      sceneId: 'scene',
      nodeId: 'node',
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
      nodeId: 'node',
      diagnosticTarget: expect.objectContaining({
        kind: 'layer-item',
        layerItemId: 'node',
      }),
    }))
    fireEvent.click(screen.getByRole('button', { name: /保存报告/ }))
    expect(onSaveReport).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '去修复' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('allows an explicitly confirmed warning-only export', () => {
    const onContinue = vi.fn()
    render(
      <ExportPreflightDialog
        report={report(true)}
        onCancel={() => undefined}
        onContinue={onContinue}
        onLocate={() => undefined}
        onSaveReport={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '继续导出' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
