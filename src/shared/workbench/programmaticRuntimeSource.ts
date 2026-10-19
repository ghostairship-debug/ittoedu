/** Static source only: model code is passed to the dedicated Worker as data. */
export const PROGRAMMATIC_WORKER_SOURCE = String.raw`
(() => {
  const send = globalThis.postMessage.bind(globalThis);
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const pending = new Map();
  let sequence = 0;
  let started = false;
  const message = error => {
    try { return error instanceof Error ? String(error.message) : String(error); }
    catch { return 'Programmatic execution failed'; }
  };
  const json = value => {
    const result = stringify(value);
    if (result === undefined) throw new Error('Tool input must be JSON serializable');
    return result;
  };
  globalThis.addEventListener('message', async event => {
    const input = event.data;
    if (input?.type === 'tool-result') {
      const callback = pending.get(input.callId);
      if (!callback) return;
      pending.delete(input.callId);
      if (input.ok) {
        try { callback.resolve(parse(input.resultJSON)); }
        catch (error) { callback.reject(error); }
      } else callback.reject(new Error(input.error));
      return;
    }
    if (input?.type !== 'execute' || started) return;
    started = true;
    try {
      const definitionsJSON = stringify(input.definitions);
      const tools = Object.freeze({
        call(name, value = {}) {
          if (typeof name !== 'string' || !name) return Promise.reject(new Error('Tool name is required'));
          let inputJSON;
          try { inputJSON = json(value); }
          catch (error) { return Promise.reject(error); }
          const callId = ++sequence;
          return new Promise((resolve, reject) => {
            pending.set(callId, { resolve, reject });
            send({ type: 'call', callId, name, inputJSON });
          });
        },
        async describe(names) {
          const definitions = parse(definitionsJSON);
          if (names === undefined) return definitions;
          if (!Array.isArray(names) || names.some(name => typeof name !== 'string'))
            throw new Error('tools.describe expects an array of tool names');
          const selected = new Set(names);
          return definitions.filter(definition => selected.has(definition.name));
        },
      });
      const execute = new AsyncFunction('tools', '"use strict";' + input.code);
      const value = await execute(tools);
      const valueJSON = value === undefined ? 'null' : stringify(value);
      if (valueJSON === undefined) throw new Error('Programmatic result is not JSON serializable');
      send({ type: 'result', status: 'completed', valueJSON });
    } catch (error) {
      send({ type: 'result', status: 'failed', error: message(error) });
    }
  });
})();
`

/** The sandbox page never evaluates model code; only its disposable Worker does. */
export const PROGRAMMATIC_BOOTSTRAP_HTML = `<!doctype html><meta charset="utf-8"><title>Programmatic tools</title>
<script>
globalThis.programmaticRuntimeAPI.run((input, bridge) => new Promise(resolve => {
  const url = URL.createObjectURL(new Blob([${JSON.stringify(PROGRAMMATIC_WORKER_SOURCE)}], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: 'programmatic-tools' });
  URL.revokeObjectURL(url);
  let settled = false;
  const finish = reply => {
    if (settled) return;
    settled = true;
    worker.terminate();
    resolve(reply);
  };
  worker.addEventListener('error', event => {
    event.preventDefault();
    finish({ status: 'failed', error: event.message || 'Programmatic Worker failed' });
  });
  worker.addEventListener('messageerror', () => finish({ status: 'failed', error: 'Programmatic Worker message could not be read' }));
  worker.addEventListener('message', event => {
    if (settled) return;
    const request = event.data;
    if (request?.type === 'result') {
      finish(request);
    } else if (request?.type === 'call') {
      bridge.call(request.name, request.inputJSON).then(
        resultJSON => { if (!settled) worker.postMessage({ type: 'tool-result', callId: request.callId, ok: true, resultJSON }); },
        error => { if (!settled) worker.postMessage({ type: 'tool-result', callId: request.callId, ok: false, error: error instanceof Error ? error.message : String(error) }); },
      );
    }
  });
  worker.postMessage({ type: 'execute', code: input.code, definitions: input.definitions });
}));
</script>`
