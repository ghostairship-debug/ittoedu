import { useRef } from 'react'
import { X } from 'lucide-react'
import type { FormulaAstNode, FormulaNode } from '../../shared/contracts/native-v1'
import {
  FormulaAuthoringEditor,
  type FormulaAuthoringDraftChange,
} from './FormulaAuthoringEditor'

interface FormulaEditDialogProps {
  node: FormulaNode
  onCommit(ast: FormulaAstNode, accessibleText: string): void
  onCancel(): void
  draftSource?: string
  onDraftChange?: (draft: FormulaAuthoringDraftChange) => void
  onCompositionChange?: (composing: boolean) => void
}

/** Focused canvas-authoring surface opened by a FormulaNode double click. */
export function FormulaEditDialog({
  node,
  onCommit,
  onCancel,
  draftSource,
  onDraftChange,
  onCompositionChange,
}: FormulaEditDialogProps) {
  const finishRef = useRef<() => void>(() => {})
  return (
    <div
      className="formula-edit-dialog-backdrop"
      data-testid="formula-edit-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) finishRef.current()
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <section
        className="formula-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formula-edit-dialog-title"
        data-testid="formula-edit-dialog"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="formula-edit-dialog__header">
          <div>
            <strong id="formula-edit-dialog-title">编辑公式</strong>
            <span>{node.name}</span>
          </div>
          <button
            type="button"
            aria-label="关闭公式编辑"
            title="应用并关闭公式编辑"
            onClick={() => finishRef.current()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="formula-edit-dialog__body">
          <FormulaAuthoringEditor
            onFinishReady={(finish) => { finishRef.current = finish }}
            node={node}
            autoFocus
            onCancel={onCancel}
            onCommit={onCommit}
            draftSource={draftSource}
            onDraftChange={onDraftChange}
            onCompositionChange={onCompositionChange}
          />
        </div>
      </section>
    </div>
  )
}
