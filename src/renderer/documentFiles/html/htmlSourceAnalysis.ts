import { analyzeHtmlAuthoringRecords, type HtmlAuthoringAnalysis } from '../../../shared/html/htmlAuthoringRecords'
import { scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import { inspectHtmlSource, flattenHtmlSourceNodes, type HtmlSourceStructure, type HtmlSourceNode } from '../../../shared/html/htmlSourceStructure'

/** One committed source value belongs to its HTML document's views. Results are
 * lazy, pure and discarded with those views; runtime handles never enter here. */
export class HtmlSourceAnalysis {
  private scanned?: ReturnType<typeof scanHtmlSource>
  private authoringValue?: HtmlAuthoringAnalysis
  private structureValue?: HtmlSourceStructure
  private nodesValue?: HtmlSourceNode[]
  constructor(readonly source: string) {}
  get scan() { return this.scanned ??= scanHtmlSource(this.source) }
  get authoring() { return this.authoringValue ??= analyzeHtmlAuthoringRecords(this.source, () => this.scan.tokens) }
  get structure() { return this.structureValue ??= inspectHtmlSource(this.source) }
  get nodes() { return this.nodesValue ??= flattenHtmlSourceNodes(this.structure.roots) }
}
