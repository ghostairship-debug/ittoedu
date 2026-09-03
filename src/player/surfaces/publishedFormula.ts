import {
  analyzeFormulaNodeLayout,
  renderFormulaNodeCanvas,
} from '../../shared/formulaRenderer'
import type { FormulaAstNode, FormulaNode, TextAlign } from '../../shared/contracts/native-v1'

export interface PublishedFormulaPaintInput {
  formulaId: string
  accessibleText: string
  ast: FormulaAstNode
  style: {
    fontSize: number
    color: string
    align: TextAlign
  }
  width: number
  height: number
}

export function publishedFormulaNode(input: PublishedFormulaPaintInput): FormulaNode {
  return {
    id: input.formulaId,
    name: input.accessibleText,
    type: 'formula',
    x: 0,
    y: 0,
    width: input.width,
    height: input.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    formulaId: input.formulaId,
    accessibleText: input.accessibleText,
    ast: input.ast,
    style: input.style,
  }
}

export function fittedPublishedFormulaSize(
  input: PublishedFormulaPaintInput,
): { width: number; height: number } {
  try {
    const layout = analyzeFormulaNodeLayout(
      publishedFormulaNode(input),
      input.width,
      input.height,
    )
    return {
      width: input.width,
      height: Math.max(input.height, Math.ceil(layout.requiredHeight)),
    }
  } catch {
    return { width: input.width, height: input.height }
  }
}

/**
 * Paints the same AST canvas the editor uses. Falls back to accessible text
 * only when this document cannot create a 2D canvas (jsdom without a mock).
 */
export function paintPublishedFormula(
  wrap: HTMLElement,
  input: PublishedFormulaPaintInput,
): void {
  wrap.replaceChildren()
  wrap.setAttribute('role', 'math')
  wrap.setAttribute('aria-label', input.accessibleText)
  wrap.dataset.publishedFormula = input.formulaId
  try {
    const rendered = renderFormulaNodeCanvas(
      publishedFormulaNode(input),
      input.width,
      input.height,
      Math.min(2, wrap.ownerDocument.defaultView?.devicePixelRatio || 1),
    )
    const canvas = rendered.canvas
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.setAttribute('aria-hidden', 'true')
    wrap.appendChild(canvas)
  } catch {
    wrap.dataset.formulaFallback = 'text'
    wrap.textContent = input.accessibleText
  }
}
