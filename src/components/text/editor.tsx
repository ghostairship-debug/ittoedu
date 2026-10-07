import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../renderer/document/SharedDocumentEditor'
import type { DocumentCommitResult, DocumentOperation } from '../../renderer/document/editorSession'
import { normalizeDocumentText, type DocumentBlock, type FlowInline } from '../../shared/document/content'
import type { MarkdownDocument } from '../../shared/document/markdown'
import { emptyDocumentResources } from '../../shared/document/resources'
import { formulaComponentDataSchema, textComponentDataSchema, type FormulaComponentData, type TextComponentData } from './data'
import { textAppearanceStyles } from './render'
import type { CSSProperties, Ref } from 'react'
import './editor.css'

/** Editor-only paragraph identity. It is not a second persisted component object. */
const paragraphId = 'text-component-body'
export function textEditorDocument(data: TextComponentData): MarkdownDocument {
  return { content: { blocks: [{ id: paragraphId, type: 'paragraph', content: data.content,
    textAlign: data.appearance.align }] }, resources: emptyDocumentResources() }
}
export function textDataFromEditor(data: TextComponentData, document: MarkdownDocument): TextComponentData {
  const inlines: FlowInline[] = []
  document.content.blocks.forEach((block, index) => {
    if (block.type !== 'paragraph') throw new Error('文字组件支持正文和行内公式；其他内容请作为独立组件插入')
    if (index) inlines.push({ type: 'text', text: '\n' })
    inlines.push(...block.content.inlines)
  })
  const first = document.content.blocks[0]
  return textComponentDataSchema.parse({ ...data, content: normalizeDocumentText({ inlines }),
    appearance: { ...data.appearance, ...(first?.type === 'paragraph' && first.textAlign ? { align: first.textAlign } : {}) } })
}
export interface TextComponentEditorOwner<Data> {
  data: Data
  revision: string
  /** Void accepts a caller-owned draft; a Promise carries the formal writer's ACK. */
  onChange(data: Data, operation: DocumentOperation): DocumentCommitResult
  onUndo(): void
  onRedo(): void
  onDiagnostic?(message: string): void
  onCompositionChange?(active: boolean): void
  toolbarHost?: HTMLElement | null
  editorRef?: Ref<SharedDocumentEditorHandle>
}
/** Reuses professional formatting, inline math, IME and selection. Persistence/history stay with the caller. */
export function TextComponentEditor(props: TextComponentEditorOwner<TextComponentData>) {
  const styles = textAppearanceStyles(props.data.appearance, props.data.sizing)
  return <div className="component-text-editor" style={styles.box as CSSProperties}><div style={styles.content as CSSProperties}><SharedDocumentEditor ref={props.editorRef} document={textEditorDocument(props.data)} revision={props.revision} contentScope="inline-text"
    inlineStyleDefaults={() => ({ bold: props.data.appearance.bold, italic: props.data.appearance.italic,
      underline: props.data.appearance.underline, strike: props.data.appearance.strike,
      emphasis: props.data.appearance.emphasis, highlightColor: props.data.appearance.highlightColor })}
    toolbarHost={props.toolbarHost} onUndo={props.onUndo} onRedo={props.onRedo}
    onCompositionChange={active => props.onCompositionChange?.(active)}
    onDraft={(_source, diagnostics) => { if (diagnostics.length) props.onDiagnostic?.(diagnostics[0].message) }}
    onChange={(document, operation) => {
      try { return props.onChange(textDataFromEditor(props.data, document), operation) }
      catch (error) { props.onDiagnostic?.(error instanceof Error ? error.message : String(error)); return false }
    }} /></div></div>
}
export function formulaEditorDocument(data: FormulaComponentData): MarkdownDocument {
  const formula = data.formula
  const block: DocumentBlock = { id: 'formula-component-body', type: 'formula', formulaId: formula.formulaId,
    latex: formula.latex, accessibleText: formula.accessibleText, style: formula.style }
  return { content: { blocks: [block] }, resources: emptyDocumentResources() }
}
export function formulaDataFromEditor(data: FormulaComponentData, document: MarkdownDocument): FormulaComponentData {
  const block = document.content.blocks[0]
  if (document.content.blocks.length !== 1 || block?.type !== 'formula') throw new Error('公式组件需要一个可编辑公式')
  return formulaComponentDataSchema.parse({ ...data, formula: { ...data.formula, latex: block.latex,
    accessibleText: block.accessibleText, style: block.style } })
}
export function FormulaComponentEditor(props: TextComponentEditorOwner<FormulaComponentData>) {
  const styles = textAppearanceStyles({ ...props.data.appearance, ...props.data.formula.style }, props.data.sizing)
  return <div className="component-text-editor" style={styles.box as CSSProperties}><div style={styles.content as CSSProperties}><SharedDocumentEditor document={formulaEditorDocument(props.data)} revision={props.revision} contentScope="formula"
    toolbarHost={props.toolbarHost} onUndo={props.onUndo} onRedo={props.onRedo}
    onCompositionChange={active => props.onCompositionChange?.(active)}
    onDraft={(_source, diagnostics) => { if (diagnostics.length) props.onDiagnostic?.(diagnostics[0].message) }}
    onChange={(document, operation) => {
      try { return props.onChange(formulaDataFromEditor(props.data, document), operation) }
      catch (error) { props.onDiagnostic?.(error instanceof Error ? error.message : String(error)); return false }
    }} /></div></div>
}
