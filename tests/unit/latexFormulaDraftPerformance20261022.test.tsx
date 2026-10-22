import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as math from '../../src/shared/document/math'
import * as renderMath from '../../src/shared/document/render'
import { LatexFormulaAuthoringEditor } from '../../src/renderer/ui/LatexFormulaAuthoringEditor'

vi.mock('../../src/shared/document/math', async importOriginal => {
  const actual = await importOriginal<typeof math>()
  return { ...actual, parseDocumentMath: vi.fn(actual.parseDocumentMath) }
})
vi.mock('../../src/shared/document/render', async importOriginal => {
  const actual = await importOriginal<typeof renderMath>()
  return { ...actual, renderDocumentMath: vi.fn(actual.renderDocumentMath) }
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('LaTeX draft analysis belongs to the current source', () => {
  it('shares analysis and preview across draft notification, rendering and commit while preserving a custom description', () => {
    const onCommit = vi.fn(), onDraftChange = vi.fn()
    render(<LatexFormulaAuthoringEditor id="formula" latex="x" accessibleText="custom description" onCommit={onCommit} onDraftChange={onDraftChange} />)
    expect(math.parseDocumentMath).toHaveBeenCalledTimes(1)
    expect(renderMath.renderDocumentMath).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('textbox', { name: '公式 LaTeX' }), { target: { value: 'x+y' } })
    expect(math.parseDocumentMath).toHaveBeenCalledTimes(2)
    expect(renderMath.renderDocumentMath).toHaveBeenCalledTimes(2)
    expect(onDraftChange).toHaveBeenLastCalledWith({ source: 'x+y', accessibleText: 'custom description', error: null, committable: true })
    fireEvent.click(screen.getByRole('button', { name: '应用公式' }))
    expect(onCommit).toHaveBeenCalledWith('x+y', 'custom description')
    expect(math.parseDocumentMath).toHaveBeenCalledTimes(2)
    expect(renderMath.renderDocumentMath).toHaveBeenCalledTimes(2)
  })

  it('keeps composing text without evaluating partial input, then honours deferred completion after composition ends', async () => {
    const onCommit = vi.fn(), onDraftChange = vi.fn()
    let finish = () => {}
    render(<LatexFormulaAuthoringEditor id="formula" latex="x" onCommit={onCommit} onDraftChange={onDraftChange} onFinishReady={value => { finish = value }} />)
    const input = screen.getByRole('textbox', { name: '公式 LaTeX' })
    const preview = screen.getByTestId('formula-preview').innerHTML
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'x+中' } })
    expect(onDraftChange).toHaveBeenLastCalledWith({ source: 'x+中', accessibleText: 'x', error: null, committable: false })
    expect(screen.getByTestId('formula-preview').innerHTML).toBe(preview)
    expect(math.parseDocumentMath).toHaveBeenCalledTimes(1)
    expect(renderMath.renderDocumentMath).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: 'x+y' } })
    act(() => finish())
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('x+y', 'x+y'))
    expect(math.parseDocumentMath).toHaveBeenCalledTimes(2)
    expect(renderMath.renderDocumentMath).toHaveBeenCalledTimes(2)
  })

  it('does not prepare an extra notification when there is no draft consumer and still rejects incomplete syntax', () => {
    const onCommit = vi.fn()
    render(<LatexFormulaAuthoringEditor id="formula" latex="x" onCommit={onCommit} />)
    fireEvent.change(screen.getByRole('textbox', { name: '公式 LaTeX' }), { target: { value: '\\frac{' } })
    expect(math.parseDocumentMath).toHaveBeenCalledTimes(2)
    expect(renderMath.renderDocumentMath).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '应用公式' })).toBeDisabled()
    expect(onCommit).not.toHaveBeenCalled()
  })
})
