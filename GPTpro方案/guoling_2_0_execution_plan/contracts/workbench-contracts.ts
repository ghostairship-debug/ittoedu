/** Design-only contracts. No product implementation is supplied by this file. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type DocId = Brand<string, 'DocId'>;
export type RunId = Brand<string, 'RunId'>;
export type OpId = Brand<string, 'OpId'>;
export type TargetHandle = Brand<string, 'TargetHandle'>;
export type BlobId = Brand<string, 'BlobId'>;
export type Revision = number;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface FileBinding {
  readonly kind: 'file';
  readonly uri: string;
  readonly bindingVersion: number;
  readonly diskVersion: string | null;
}
export type DocumentBinding = FileBinding | {
  readonly kind: 'untitled'; readonly suggestedName: string;
};
export interface DocumentIdentity {
  readonly docId: DocId;
  readonly driver: 'markdown' | 'course-v9' | string;
  readonly binding: DocumentBinding;
  readonly sessionEpoch: number;
}
export interface DocumentStatus {
  readonly revision: Revision;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly conflict: boolean;
  readonly recoverable: boolean;
}
export interface ReadSelection {
  readonly handle: TargetHandle;
  readonly label: string;
  readonly text?: string;
  readonly properties?: Readonly<Record<string, Json>>;
  readonly nextCursor?: string;
}
/** Model input is intentionally smaller than the host command envelope. */
export interface ModelToolCall {
  readonly name: string;
  /** Required for mutations by the tool schema; list/discovery tools need no target. */
  readonly target?: TargetHandle;
  readonly input: Json;
}
export interface Grant {
  readonly grantId: string;
  readonly workspaceId: string;
  readonly runId: RunId;
  readonly readableDocs: readonly DocId[];
  readonly writableTargets: readonly TargetHandle[];
  readonly permissionEpoch: number;
}
export interface Preconditions {
  readonly docId: DocId;
  readonly sessionEpoch: number;
  readonly baseRevision: Revision;
  /** Host/driver-derived read-set; never accepted merely because a model asserted it. */
  readonly readTokens: Readonly<Record<string, string>>;
}
export interface CommandEnvelope {
  readonly operationId: OpId;
  readonly requestDigest: string;
  readonly actor: 'human' | 'agent';
  readonly runId: RunId | null;
  readonly grantId: string;
  readonly target: TargetHandle;
  readonly preconditions: Preconditions;
  readonly toolName: string;
  readonly input: Json;
  readonly historyGroup: string;
}
export type CommandResult = {
  readonly status: 'applied' | 'unchanged';
  readonly operationId: OpId;
  readonly docId: DocId;
  readonly beforeRevision: Revision;
  readonly afterRevision: Revision;
  readonly affected: readonly TargetHandle[];
  readonly persistence: 'recoverable' | 'file-saved';
  readonly summary: string;
} | {
  readonly status: 'conflict' | 'denied' | 'failed' | 'cancelled';
  readonly operationId: OpId;
  readonly code: string;
  readonly message: string;
  readonly applied: false;
};
export interface ResourceDelta {
  readonly retained: readonly BlobId[];
  readonly released: readonly BlobId[];
}
export interface DriverPlan<Model, Patch> {
  readonly model: Model;
  readonly forward: Patch;
  readonly inverse: Patch;
  readonly resources: ResourceDelta;
  readonly affected: readonly TargetHandle[];
}
export interface DocumentDriver<Model, Patch> {
  readonly id: string;
  load(bytes: Uint8Array): Promise<Model>;
  serialize(model: Readonly<Model>): Promise<Uint8Array>;
  describe(model: Readonly<Model>, handle: TargetHandle): ReadSelection;
  plan(model: Readonly<Model>, command: CommandEnvelope): Promise<DriverPlan<Model, Patch>>;
  validate(model: Readonly<Model>, command: CommandEnvelope): readonly string[];
  apply(model: Readonly<Model>, patch: Patch): Model;
}
export interface DocumentSession {
  readonly identity: DocumentIdentity;
  status(): DocumentStatus;
  execute(command: CommandEnvelope): Promise<CommandResult>;
  lookupOperation(operationId: OpId, digest: string): Promise<CommandResult | null>;
  save(): Promise<DocumentStatus>;
  undo(): Promise<CommandResult>;
  redo(): Promise<CommandResult>;
  subscribe(listener: (event: DocumentEvent) => void): () => void;
}
export type DocumentEvent = {
  readonly type: 'document.changed'; readonly docId: DocId;
  readonly operationId: OpId; readonly revision: Revision;
  readonly affected: readonly TargetHandle[];
} | {
  readonly type: 'document.binding'; readonly docId: DocId; readonly binding: DocumentBinding;
} | {
  readonly type: 'document.status'; readonly docId: DocId; readonly status: DocumentStatus;
};

export interface EditDraftIdentity {
  readonly draftId: string;
  readonly docId: DocId;
  readonly runId: RunId;
  readonly target: TargetHandle;
  readonly baseRevision: Revision;
  readonly epoch: number;
}
export type EditStreamEvent = EditDraftIdentity & (
  { readonly type: 'edit.begin'; readonly sequence: number } |
  { readonly type: 'edit.delta'; readonly sequence: number; readonly text: string } |
  { readonly type: 'edit.snapshot'; readonly sequence: number; readonly text: string } |
  { readonly type: 'edit.complete'; readonly sequence: number; readonly finalText: string } |
  { readonly type: 'edit.abort'; readonly sequence: number; readonly reason: string }
);
/** Presentation-only projections do not become durable document patches per token. */
export interface EditDraftPort {
  receive(event: EditStreamEvent): Promise<void>;
  cancel(draftId: string, epoch: number): Promise<void>;
}
export interface Attachment {
  readonly id: string;
  readonly blobId: BlobId;
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  readonly origin: 'picker' | 'clipboard-image' | 'clipboard-file' | 'drop' | 'workspace';
  readonly status: 'preparing' | 'ready' | 'failed';
  readonly representations: readonly {
    readonly id: string;
    readonly kind: 'original' | 'image' | 'text' | 'page-image';
    readonly blobId: BlobId;
    readonly pages?: readonly number[];
  }[];
}
export interface ContextEnvelope {
  readonly instruction: string;
  readonly documentRefs: readonly DocId[];
  readonly selections: readonly ReadSelection[];
  readonly attachments: readonly Attachment[];
  readonly allowedWriteTargets: readonly TargetHandle[];
}

export interface RuntimeCapabilities {
  readonly runtimeVersion: string;
  readonly directTools: 'supported' | 'unsupported' | 'experimental' | 'unknown';
  readonly editStream: 'supported' | 'unsupported' | 'experimental' | 'unknown';
  readonly images: 'supported' | 'unsupported' | 'unknown';
  readonly reasoning: 'summary' | 'provided-text' | 'none' | 'unknown';
  readonly childEvents: 'stream' | 'snapshot' | 'none' | 'unknown';
  readonly cancel: boolean;
  readonly resume: boolean;
}
export type CapabilityState = 'supported' | 'unsupported' | 'experimental' | 'unknown';
export type ModelRole = 'conversation' | 'vision' | 'image-generation' | 'image-editing';
export interface ConnectionProfile {
  readonly id: string;
  readonly provider: string;
  readonly endpoint: string;
  /** Reference into host secure storage, never the credential itself. */
  readonly credentialRef: string;
  readonly authentication: 'api-key' | 'oauth';
  readonly billing: 'metered' | 'token-plan' | 'subscription' | 'prepaid' | 'unknown';
  readonly accountId: string;
  readonly configurationVersion: number;
}
export interface ModelBinding {
  readonly connectionId: string;
  readonly model: string;
  readonly effort?: string;
  readonly serviceTier?: string;
}
export interface ExecutionProfile {
  readonly conversation: ModelBinding;
  readonly vision?: ModelBinding;
  readonly imageGeneration?: ModelBinding;
  readonly imageEditing?: ModelBinding;
  /** Explicitly configured fallbacks only, not inferred from environment variables. */
  readonly permittedFallbacks: readonly ModelBinding[];
}
export interface ModelCapabilities {
  readonly tools: CapabilityState;
  readonly contentStream: CapabilityState;
  readonly vision: CapabilityState;
  readonly imageGeneration: CapabilityState;
  readonly imageEditing: CapabilityState;
  readonly transparentBackground: CapabilityState;
  readonly requestStatusLookup: CapabilityState;
  readonly observedAt?: string;
  readonly evidenceRef?: string;
}
export interface ExecutionRequest {
  readonly runId: RunId;
  /** A task may use both classes; these are tool permissions, not two engines. */
  readonly permittedToolClasses: readonly ('live' | 'build' | 'media')[];
  readonly workspaceId: string;
  readonly context: ContextEnvelope;
  readonly profile: ExecutionProfile;
  readonly limits: { readonly maxModelRequests: number; readonly maxToolCalls: number; readonly deadlineMs: number };
  readonly grant: Grant;
}
export interface ExecutionEngine {
  readonly id: string;
  capabilities(): Promise<RuntimeCapabilities>;
  start(request: ExecutionRequest, tools: ToolGateway): AsyncIterable<RuntimeEvent>;
  stop(runId: RunId): Promise<void>;
  continue(runId: RunId, instruction: string): Promise<void>;
}
export interface ToolGateway {
  describe(names?: readonly string[]): Promise<readonly ToolDefinition[]>;
  execute(runId: RunId, callId: string, call: ModelToolCall): Promise<ToolResult>;
}
export interface JobReference {
  readonly id: string;
  readonly kind: 'build' | 'image';
  readonly runId: RunId;
  readonly state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  readonly outputBlobs: readonly BlobId[];
  readonly providerRequestId?: string;
  readonly appliedOperation?: OpId;
}
export type ToolResult =
  { readonly kind: 'document-operation'; readonly result: CommandResult } |
  { readonly kind: 'read'; readonly data: Json; readonly nextCursor?: string } |
  { readonly kind: 'job'; readonly job: JobReference } |
  { readonly kind: 'error'; readonly code: string; readonly message: string };
/** Host-issued ticket survives transport retries; a JSON-RPC ID is not an operation ID. */
export interface ExternalOperationTicket {
  readonly id: string;
  readonly connectionId: string;
  readonly operationId: OpId;
  readonly target: TargetHandle;
  readonly grantId: string;
  readonly permissionEpoch: number;
  readonly requestDigest: string;
}
/** All bridge instances attach to one host document service, not a private Registry. */
export interface ExternalMcpBridge {
  prepare(connectionId: string, call: ModelToolCall): Promise<ExternalOperationTicket>;
  commit(connectionId: string, ticketId: string): Promise<CommandResult>;
  lookup(connectionId: string, ticketId: string): Promise<CommandResult | null>;
  revoke(connectionId: string): Promise<void>;
}
export interface HandoffPackage {
  readonly instruction: string;
  readonly documentRefs: readonly DocId[];
  readonly completedOperations: readonly OpId[];
  readonly remainingWork: readonly string[];
  readonly attachments: readonly BlobId[];
  /** Receiving client must observe again and obtain a new grant. */
  readonly previousRun: RunId;
}
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: Json;
}
export interface ProviderRequest {
  readonly connection: ConnectionProfile;
  readonly model: string;
  readonly messages: readonly Json[];
  readonly tools: readonly ToolDefinition[];
  readonly abort: AbortSignal;
}
export interface ModelProvider {
  readonly id: string;
  stream(request: ProviderRequest): AsyncIterable<ProviderDelta>;
}
export type ProviderDelta =
  { readonly kind: 'text'; readonly value: string } |
  { readonly kind: 'reasoning'; readonly value: string; readonly visibility: 'summary' | 'provided-text' } |
  { readonly kind: 'tool-fragment'; readonly callId: string; readonly fragment: string } |
  { readonly kind: 'tool-complete'; readonly callId: string; readonly name: string; readonly input: Json } |
  { readonly kind: 'usage'; readonly usage: Json } |
  { readonly kind: 'error'; readonly code: string; readonly requestState: 'not-sent' | 'failed' | 'unknown' } |
  { readonly kind: 'end'; readonly outcome: 'completed' | 'truncated' | 'cancelled' | 'failed' };
/** A streaming decoder may project validated text before full JSON; it never commits. */
export interface EditContentDecoder {
  push(callId: string, fragment: string): readonly EditStreamEvent[];
  finish(callId: string, validatedCall: ModelToolCall): readonly EditStreamEvent[];
  abort(callId: string, reason: string): readonly EditStreamEvent[];
}
export interface MediaProvider {
  generate(binding: ModelBinding, prompt: string, references: readonly BlobId[], abort: AbortSignal): Promise<JobReference>;
  lookup(jobId: string): Promise<JobReference>;
}
export interface ControlledBuildPort {
  create(runId: RunId): Promise<JobReference>;
  /** Concrete implementation enforces scratch-only writes and process restrictions. */
  run(jobId: string, action: Json, abort: AbortSignal): Promise<ToolResult>;
  inspect(jobId: string): Promise<ToolResult>;
}

export interface RuntimeEventBase {
  readonly origin: 'internal' | 'external-mcp';
  readonly eventId: string;
  readonly runId: RunId;
  readonly sequence: number;
  readonly itemId: string;
  readonly parentItemId?: string;
}
export type RuntimeEvent = RuntimeEventBase & (
  { readonly kind: 'text'; readonly operation: 'append' | 'replace'; readonly text: string } |
  { readonly kind: 'reasoning'; readonly operation: 'append' | 'replace'; readonly text: string; readonly visibility: 'summary' | 'provided-text' } |
  { readonly kind: 'tool'; readonly state: 'started' | 'running' | 'completed' | 'failed'; readonly update: Json } |
  { readonly kind: 'question'; readonly requestId: string; readonly body: Json } |
  { readonly kind: 'plan'; readonly steps: readonly Json[] } |
  { readonly kind: 'document-operation'; readonly result: CommandResult } |
  { readonly kind: 'usage'; readonly usage: Json } |
  { readonly kind: 'job'; readonly job: JobReference } |
  { readonly kind: 'end'; readonly outcome: 'completed' | 'failed' | 'cancelled' | 'partial' }
);
