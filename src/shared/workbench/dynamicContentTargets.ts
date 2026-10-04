/** Normalized M15 host hits. The renderer/Player bridge supplies these, never model input. */
export type DynamicContentObservedTarget =
  | { readonly kind: 'runtime.text' | 'component.text'; readonly source: 'auto';
      /** DocumentSnapshot revision stamped by the renderer bridge, not Player target-update sequence. */
      readonly revision: number;
      readonly locationId: string; readonly itemId: string; readonly original: string; readonly region?: string; readonly text: string }
  | { readonly kind: 'component.image'; readonly source: 'auto'; readonly revision: number;
      readonly locationId: string; readonly itemId: string; readonly assetKey: string }

/** What the renderer publishes for its current view; Main adds the sender and validates it again. */
export interface DynamicContentTargetsPublication {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
  readonly locationId: string
  readonly viewGeneration: string
  /** Globally increasing for one sender/document, including generation changes. */
  readonly publicationSeq: number
  readonly source: 'authoring' | 'live'
  readonly targets: readonly DynamicContentObservedTarget[]
  readonly truncatedItemIds?: readonly string[]
}
