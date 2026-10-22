import type { ConversationMessage } from './conversations'
import type { ExecutionBlobRef, ExecutionItem } from './executionEvents'
import type { PendingApproval, PendingQuestion } from './executionTimelineReadModel'

export const EXECUTION_TEXT_PAGE = 12_000
export interface ExecutionTimelineBodyRequest {
  runId: string; itemId: string; part: number; offset?: number; maxChars?: number; complete?: boolean
}
export interface ExecutionTimelineBodyPage {
  cursor: number; sequence: number; text: string; offset: number; total: number; hasMore: boolean
}
export type ExecutionTimelineBodyPart =
  | { kind: 'text'; part: number; text: string; offset: number; total: number; hasMore: boolean }
  | { kind: 'blob'; ref: ExecutionBlobRef }
/** Display page, explicitly distinct from the complete canonical projection content. */
export interface ExecutionTimelineBodyWindow { sequence: number; parts: ExecutionTimelineBodyPart[] }
export type ExecutionTimelineWindowItem = Omit<ExecutionItem, 'content'> & { body: ExecutionTimelineBodyWindow }
export interface ExecutionTimelineItemFact {
  runId: string; itemId: string; documentId?: string; application?: string; save?: string
  ended: boolean; endStatus?: string; parent?: { type: ExecutionItem['type']; label?: string }; runCommitSequence?: number
}
export interface ExecutionTimelineGroupRange { itemStart?: number; itemLimit?: number; fileStart?: number; fileLimit?: number }
export interface ExecutionTimelineGroupRequest extends ExecutionTimelineGroupRange { key: string }
export interface ExecutionTimelineGroupPage {
  kind: 'tools'; cursor: number; key: string; time: number; order: number; runId: string; firstItemId: string; source: ExecutionItem['source']
  summary: string; itemCount: number; fileCount: number
  itemStart: number; itemEnd: number; items: ExecutionTimelineWindowItem[]
  fileStart: number; fileEnd: number; files: ExecutionTimelineWindowItem[]; itemFacts: ExecutionTimelineItemFact[]
}
export type ExecutionTimelineWindowEntry =
  | { kind: 'item'; item: ExecutionTimelineWindowItem; time: number; order: number }
  | { kind: 'message'; message: ConversationMessage; time: number; order: number }
  | ExecutionTimelineGroupPage
export interface ExecutionTimelinePageRequest {
  start?: number; limit?: number; anchorKey?: string; groups?: Record<string, ExecutionTimelineGroupRange>
  /** Desktop chooses the authoritative 20-user-message window; the reader never accepts renderer-authored history. */
  userHistoryOffset?: number; includeEndedRuns?: boolean
}
export interface ExecutionTimelineEntryPage {
  conversationId: string; cursor: number; start: number; end: number; total: number; anchorKey?: string
  /** Main stamps the actual authoritative conversation revision, never the requested hint. */
  userHistoryRevision?: number
  userHistoryOffset?: number
  entries: ExecutionTimelineWindowEntry[]; itemFacts: ExecutionTimelineItemFact[]
  activity: { busy: boolean; activeRuns: number; waitingRuns: number; externalTools: number }; status: string | null
  pendingQuestion: PendingQuestion | null; pendingApproval: PendingApproval | null
  /** Requested for cold conversation settlement; live endings continue through real event notifications. */
  endedRunIds?: string[]
}
/** The host owns range/fact freshness. Every read result carries the durable cursor. */
export interface ExecutionTimelineWindowControl {
  page: ExecutionTimelineEntryPage; busy?: boolean
  readPage(input: ExecutionTimelinePageRequest): Promise<ExecutionTimelineEntryPage>
  readGroup(input: ExecutionTimelineGroupRequest): Promise<ExecutionTimelineGroupPage>
  readBody(input: ExecutionTimelineBodyRequest): Promise<ExecutionTimelineBodyPage>
}
