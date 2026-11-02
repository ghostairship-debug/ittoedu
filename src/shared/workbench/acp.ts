/** Product-facing ACP state. Capability values always originate in the native Agent response. */
export type AcpAgentId = 'builtin' | 'codex' | 'claude' | 'opencode';
export type AcpAgentReadiness = 'missing' | 'adapter_missing' | 'unverified' | 'installing' | 'connecting' | 'authentication_required' | 'ready' | 'error';

export interface AcpAgentChoice {
  id: Exclude<AcpAgentId, 'builtin'>;
  name: string;
  nativeInstalled: boolean;
  adapterInstalled: boolean;
  readiness: AcpAgentReadiness;
  detail?: string;
  documentationUrl: string;
  nativeLoginHint: string;
}

export interface AcpSelectValue { value: string; name: string; description?: string; group?: string }
export type AcpConfigurationControl = {
  id: string;
  name: string;
  description?: string;
  category?: string;
} & ({ type: 'select'; currentValue: string; options: AcpSelectValue[] } | { type: 'boolean'; currentValue: boolean });

export interface AcpAuthenticationMethod { id: string; name: string; description?: string }
export interface AcpPermissionPrompt {
  id: string;
  title: string;
  kind?: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

/** A segment keeps the native history boundary. Handoffs contain public work facts, never provider-private reasoning. */
export interface AcpSessionSegment {
  id: string;
  agentId: Exclude<AcpAgentId, 'builtin'>;
  nativeSessionId: string;
  startedAt: string;
  endedAt?: string;
  modelId?: string;
  effort?: string;
  /** Only explicit user choices that still matched the native configuration readback. */
  configurationChoices?: Record<string, string | boolean>;
}

export interface AcpStructuredHandoff {
  version: 1;
  goal?: string;
  userInstructions?: string[];
  latestPublicReply?: string;
  confirmedDecisions: string[];
  artifacts: Array<{ path: string; documentId?: string; revision?: string; dirty?: boolean;
    undoHead?: { operationId: string; actor?: 'human' | 'agent' | 'external' }; summary?: string }>;
  unfinishedWork: string[];
  unsettledOperations: string[];
  /** Describes protected edits; it never authorizes overwriting them. */
  humanChanges: string[];
  /** Read-only projections of the existing conversation/event owners, not old MCP connection tickets. */
  history?: {
    instructionCount: number;
    includedInstructions: number;
    workItemCount: number;
    confirmedDecisionCount: number;
    includedDecisions: number;
    unfinishedRunCount: number;
    pendingOperationCount: number;
    eventCursor?: number;
    instructions: { tool: 'handoff.read'; input: { section: 'instructions'; offset: number } };
    work: { tool: 'handoff.read'; input: { section: 'work'; offset: number } };
  };
}

export type AcpHandoffReadInput =
  | { section: 'instructions'; offset?: number; limit?: number; messageId?: string; textOffset?: number }
  | { section: 'work'; offset?: number; limit?: number }
  | { section: 'item'; runId: string; itemId: string; field?: 'input' | 'output' | 'diff' | 'error' | 'text' | 'decision' | 'facts'; offset?: number; limit?: number };

export interface AcpHostSnapshot {
  selectedAgentId: AcpAgentId;
  phase: 'idle' | 'installing' | 'switching' | 'ready' | 'prompting' | 'authenticating' | 'error';
  agents: AcpAgentChoice[];
  configuration: AcpConfigurationControl[];
  authenticationMethods: AcpAuthenticationMethod[];
  pendingPermissions: AcpPermissionPrompt[];
  segment?: AcpSessionSegment;
  segments: AcpSessionSegment[];
  error?: string;
  /** Native processes can access disk outside the workbench domain gateway. */
  nativeDiskAccess: boolean;
}

export interface AcpHostEvent {
  type: 'state' | 'update';
  snapshot?: AcpHostSnapshot;
  segmentId?: string;
  nativeSessionId?: string;
  update?: Record<string, unknown>;
  replay?: boolean;
}
