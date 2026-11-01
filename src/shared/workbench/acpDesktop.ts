import { z } from 'zod';
import { executionPermissionModeSchema } from './executionPermission';
import type { AcpHostSnapshot } from './acp';
import type { ConversationRecord } from './conversations';
import type { ExecutionDocumentReference } from './executionDesktop';

const identity = { workspaceId: z.string().min(1), conversationId: z.string().min(1) };
export const acpDesktopRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ...identity }).strict(),
  z.object({ action: z.literal('discover'), ...identity }).strict(),
  z.object({ action: z.literal('install'), ...identity, agentId: z.enum(['codex', 'claude', 'opencode']) }).strict(),
  z.object({ action: z.literal('select'), ...identity, agentId: z.enum(['builtin', 'codex', 'claude', 'opencode']), fresh: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('authenticate'), ...identity, methodId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('configure'), ...identity, values: z.record(z.string().min(1), z.union([z.string(), z.boolean()])) }).strict(),
  z.object({ action: z.literal('permission'), ...identity, id: z.string().min(1), optionId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('cancel'), ...identity }).strict(),
  z.object({ action: z.literal('confirm'), ...identity, submissionId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('documentation'), ...identity, agentId: z.enum(['codex', 'claude', 'opencode']) }).strict(),
]);
export type AcpDesktopRequest = z.infer<typeof acpDesktopRequestSchema>;
export interface AcpDesktopResult { snapshot: AcpHostSnapshot; conversation: ConversationRecord }
export interface AcpSnapshotEvent { workspaceId: string; conversationId: string; snapshot: AcpHostSnapshot }
export interface AcpSendInput {
  workspaceId: string;
  conversationId: string;
  submissionId: string;
  expectedRevision: number;
  text: string;
  documents: ExecutionDocumentReference[];
  permission: z.infer<typeof executionPermissionModeSchema>;
}
