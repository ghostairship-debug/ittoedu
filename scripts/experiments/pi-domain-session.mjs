/**
 * Reversible full Pi AgentSession integration. This module owns no model loop,
 * transcript, retries, credentials, document state, or operation ledger.
 * The caller supplies the installed Pi 1.4.0 SDK and the existing domain port.
 */
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const sameNames = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const schemaHash = schema => digest(JSON.stringify(canonical(schema)));
const bounded = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(message)), timeoutMs);
  Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); },
    error => { clearTimeout(timer); reject(error); });
});

/** Provider-safe names are a transport mapping, never a guessed domain alias. */
export function piToolName(name) {
  if (typeof name !== 'string' || !name) throw Error('A domain tool requires an exact name');
  const stem = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 42);
  return `glx_${stem}_${digest(name).slice(0, 12)}`;
}

export function selectDomainTools(catalog, allowedNames) {
  if (!Array.isArray(catalog) || !Array.isArray(allowedNames) || !allowedNames.length)
    throw Error('An actual domain catalog and nonempty explicit tool selection are required');
  if (new Set(allowedNames).size !== allowedNames.length) throw Error('Duplicate domain tool selection');
  const selected = allowedNames.map(name => {
    const matches = catalog.filter(tool => tool.name === name);
    if (matches.length !== 1) throw Error(`Required domain tool is missing or ambiguous: ${name}`);
    const tool = matches[0];
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || tool.inputSchema.type !== 'object')
      throw Error(`Domain tool lacks its actual object schema: ${name}`);
    return { ...tool, inputSchema: structuredClone(tool.inputSchema), piName: piToolName(name) };
  });
  if (new Set(selected.map(tool => tool.piName)).size !== selected.length) throw Error('Domain tool name collision');
  return selected;
}

export function domainReply(result) {
  if (!result || !Array.isArray(result.content)) throw Error('Domain tool returned no MCP result');
  const content = result.content.map(item => {
    if (item.type === 'text' && typeof item.text === 'string') return { type: 'text', text: item.text };
    if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string')
      return { type: 'image', data: item.data, mimeType: item.mimeType };
    throw Error(`Unsupported domain result content: ${item.type}`);
  });
  // Receipts stay owned by the MCP service. Pi persists their original response
  // in its native tool message; this adapter does not reconstruct model history.
  const details = { domain: result.structuredContent ?? null, isError: result.isError === true };
  if (result.isError) {
    const error = Error(JSON.stringify({ domainError: true, content, receipt: details.domain }));
    error.name = 'GuolingDomainToolError';
    throw error;
  }
  return { content, details };
}

export function createDomainToolDefinitions(selected, { client, sessionId, isStopped,
  onReceipt = () => {}, onTransportFailure = () => {} }) {
  return selected.map(tool => ({
    name: tool.piName,
    label: tool.title ?? tool.name,
    description: `Guoling domain tool ${tool.name}. ${tool.description ?? ''}`,
    parameters: tool.inputSchema,
    executionMode: 'sequential',
    execute: async (toolCallId, input, signal) => {
      if (isStopped() || signal?.aborted) throw Error('Domain session is stopped; no tool was dispatched');
      // The same native tool call always carries the same host replay identity.
      // ExternalMcpService validates payload equality and owns the real receipt.
      const ticket = `pi-${digest(`${sessionId}\n${toolCallId}`).slice(0, 48)}`;
      let result;
      try {
        result = await client.callTool({ name: tool.name, arguments: input,
          _meta: { 'guoling/ticket': ticket } }, undefined, { signal });
      } catch (error) {
        const diagnostic = { code: 'domain-transport-outcome-unknown', domainTool: tool.name,
          nativeToolCallId: toolCallId, requestedTicket: ticket, hostReceiptConfirmed: false,
          message: 'The transport did not establish the operation outcome. Query the host receipt; do not repeat the modification.',
          cause: String(error?.message ?? error),
          recovery: selected.filter(item => ['operation.read', 'operation.recent'].includes(item.name))
            .map(item => ({ tool: item.piName, domainTool: item.name,
              input: item.name === 'operation.read' ? { ticket } : {} })) };
        // This is a transport diagnostic, never a fabricated domain receipt.
        try { onTransportFailure(diagnostic); } catch { /* No tool replay on trace failure. */ }
        const unknown = Error(JSON.stringify(diagnostic));
        unknown.name = 'GuolingDomainTransportError';
        throw unknown;
      }
      let observationError;
      try { onReceipt({ toolCallId, tool: tool.name, ticket, result }); }
      catch (error) { observationError = String(error); }
      const converted = domainReply(result);
      if (observationError) converted.details.observationError = observationError;
      return converted;
    },
  }));
}

/** Observe the actual provider payload without changing it or sending a request. */
export function providerRequestFacts(payload) {
  if (!payload || typeof payload !== 'object') throw Error('Missing native provider request payload');
  const tools = (payload.tools ?? []).map(tool => {
    const definition = tool.function ?? tool;
    const schema = definition.parameters ?? definition.input_schema;
    return { name: definition.name, schemaSha256: schema ? schemaHash(schema) : null };
  });
  return { model: payload.model ?? null, tools,
    messageCount: Array.isArray(payload.messages) ? payload.messages.length
      : Array.isArray(payload.input) ? payload.input.length : null,
    toolResultCount: Array.isArray(payload.messages) ? payload.messages.filter(message => message.role === 'tool'
      || Array.isArray(message.content) && message.content.some(item => item.type === 'tool_result')).length
      : Array.isArray(payload.input) ? payload.input.filter(item => item.type === 'function_call_output').length : null };
}

/**
 * revokeDomain must complete the existing host's stop/revocation operation.
 * Disposing a Pi session or aborting HTTP alone is not document revocation.
 */
export async function createPiDomainSession(options) {
  const { pi, client, revokeDomain, modelRuntime, model, resourceLoader, settingsManager,
    cwd, agentDir, sessionDir, sessionFile, allowedToolNames, thinkingLevel = 'medium',
    onEvent = () => {}, onReceipt = () => {}, onTransportFailure = () => {},
    revokeTimeoutMs = 10000, abortTimeoutMs = 10000 } = options;
  if (!pi?.createAgentSession || !pi?.SessionManager || !modelRuntime || !model || !resourceLoader || !settingsManager)
    throw Error('Explicit full Pi SDK, model, resources, and settings are required');
  if (typeof revokeDomain !== 'function') throw Error('An existing domain revocation port is required');
  const selected = selectDomainTools((await client.listTools()).tools, allowedToolNames);
  const manager = sessionFile ? pi.SessionManager.open(sessionFile) : pi.SessionManager.create(cwd, sessionDir);
  let stopped = false, stopPromise;
  const definitions = createDomainToolDefinitions(selected, { client,
    sessionId: manager.getSessionId(), isStopped: () => stopped, onReceipt, onTransportFailure });
  const created = await pi.createAgentSession({ cwd, agentDir, modelRuntime, model, thinkingLevel,
    resourceLoader, settingsManager, sessionManager: manager,
    noTools: 'builtin', tools: definitions.map(tool => tool.name), customTools: definitions });
  const session = created.session;
  try {
    if (created.modelFallbackMessage || session.model?.id !== model.id || session.model?.provider !== model.provider)
      throw Error('Pi changed the explicitly selected model; the domain task was not sent');
    await session.bindExtensions({});
    if (!sameNames(session.getActiveToolNames(), definitions.map(tool => tool.name)))
      throw Error('Pi active tools differ from the exact domain selection');
  } catch (error) { session.dispose(); throw error; }
  const observationErrors = [];
  const unsubscribe = session.subscribe(event => {
    try { onEvent(event); } catch (error) { observationErrors.push(String(error)); }
  });
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      let revokeError;
      try { await bounded(revokeDomain(), revokeTimeoutMs, 'Domain revocation is unconfirmed: host acknowledgement timed out'); }
      catch (error) { revokeError = error; }
      try { await bounded(session.abort(), abortTimeoutMs, 'Pi abort did not settle within the cleanup deadline'); } catch (error) {
        if (revokeError) throw new AggregateError([revokeError, error], 'Domain revocation and Pi abort failed');
        throw error;
      }
      if (revokeError) throw revokeError;
    })();
    return stopPromise;
  };
  return {
    session, manager, observationErrors,
    tools: selected.map(tool => ({ domainName: tool.name, piName: tool.piName,
      schemaSha256: schemaHash(tool.inputSchema) })),
    // Each call is one user turn. Pi alone drives tools, history and native retries.
    async prompt(text) {
      if (stopped) throw Error('Domain session is stopped');
      await session.prompt(text, { expandPromptTemplates: false });
      // AgentSession can finalize a failed/aborted native assistant message
      // without rejecting prompt(). Keep that primary failure visible instead
      // of letting a later save check misreport it as a no-op model response.
      const assistant = session.messages.findLast(message => message.role === 'assistant');
      if (assistant?.stopReason === 'error' || assistant?.stopReason === 'aborted') {
        const error = Error(`Pi native assistant stopped (${assistant.stopReason}): ${assistant.errorMessage || 'No native error message was provided'}`);
        error.name = 'PiNativeTurnError';
        throw error;
      }
      return { nativeSessionId: manager.getSessionId(), nativeSessionFile: manager.getSessionFile(),
        lastAssistantText: session.getLastAssistantText(), messageCount: session.messages.length };
    },
    stop,
    async close() {
      try { await stop(); } finally { unsubscribe(); session.dispose(); }
    },
    // For an idle native-session reopen with the SAME still-live domain port.
    // This preserves the native JSONL and never creates a second transcript.
    async releaseForReopen() {
      await session.waitForIdle();
      stopped = true;
      unsubscribe();
      session.dispose();
      return manager.getSessionFile();
    },
  };
}
