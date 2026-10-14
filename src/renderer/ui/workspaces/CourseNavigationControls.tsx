import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCourseNavigationToolbarSlot } from '../../documents/CourseEditorChromeContext'
import type { TeacherControllerDisplayPort } from '../../../shared/teacherControllerViewportGeometry'

/** One host chrome for the existing runtime/navigation owner on each presentation surface. */
export function CourseNavigationControls({ canvasMode, onCanvasModeChange, navigation, beforeNavigate, resetPlayback, report, runTitle = '从当前位置试运行' }: {
  canvasMode: 'edit' | 'run'
  onCanvasModeChange(mode: 'edit' | 'run'): void
  navigation?: TeacherControllerDisplayPort
  beforeNavigate?(): Promise<unknown>
  resetPlayback?(playing: boolean): Promise<void>
  report(message: string): void
  runTitle?: string
}) {
  const slots = useCourseNavigationToolbarSlot()
  const [, refresh] = useState(0), [busy, setBusy] = useState(false)
  useEffect(() => navigation?.subscribe(() => refresh(value => value + 1)), [navigation])
  const perform = async (action: 'step.previous' | 'step.next' | 'scene.replay') => {
    if (busy) return
    setBusy(true)
    try {
      if (action === 'scene.replay' && resetPlayback) await resetPlayback(canvasMode === 'run')
      else {
        if (await beforeNavigate?.() === false) { report('当前编辑未能应用，请完成编辑后重试'); return }
        if (!await navigation?.execute?.({ type: action })) report('当前不能完成导航')
      }
    } catch (error) { report(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const controls = <div className="canvas-mode-switch" role="group" aria-label="画布模式" data-testid="course-try-run-chrome">
    <button type="button" disabled={busy} className={canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''} aria-pressed={canvasMode === 'edit'} onClick={() => onCanvasModeChange('edit')}>编辑</button>
    <button type="button" disabled={busy} className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''} aria-pressed={canvasMode === 'run'} title={runTitle} onClick={() => onCanvasModeChange('run')}>试运行</button>
    <button type="button" aria-label="上一步" title="上一步" data-testid="course-try-run-previous" disabled={busy || !navigation?.execute || navigation.canExecute?.({ type: 'step.previous' }) === false} onClick={() => { void perform('step.previous') }}><ChevronLeft size={16} /></button>
    <button type="button" aria-label="下一步" title="下一步" data-testid="course-try-run-next" disabled={busy || !navigation?.execute || navigation.canExecute?.({ type: 'step.next' }) === false} onClick={() => { void perform('step.next') }}><ChevronRight size={16} /></button>
    <button type="button" aria-label="回到初始画面" title="回到初始画面" disabled={busy || !(resetPlayback || navigation?.execute) || navigation?.canExecute?.({ type: 'scene.replay' }) === false} onClick={() => { void perform('scene.replay') }}><RotateCcw size={15} /></button>
  </div>
  if (!slots) return controls
  const target = slots.targets[slots.mode]
  return target ? createPortal(controls, target) : null
}
