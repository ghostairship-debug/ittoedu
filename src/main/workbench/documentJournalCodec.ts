import { Deserializer, Serializer, deserialize, serialize } from 'node:v8'
import type { DocumentAcceptedChange, DocumentHistoryEntry, DocumentModel, DocumentResources, DocumentStateTransition,
  DurableDocumentState } from '../../shared/workbench/document'

interface EncodedJournalValue {
  journalVersion: 3
  type: 'checkpoint' | 'transition'
  buffers: Array<{ id: number; bytes: Uint8Array }>
  value: Uint8Array
}

// V8 returns Node-realm views even when its caller runs in a UI/test realm.
const isUint8Array = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value)
  && Object.prototype.toString.call(value) === '[object Uint8Array]'

function mapJournalResources(type: 'checkpoint', input: DurableDocumentState, resources: (value: DocumentResources) => DocumentResources, shareSavedText?: boolean, retainInvalidHistory?: boolean): DurableDocumentState
function mapJournalResources(type: 'transition', input: DocumentStateTransition, resources: (value: DocumentResources) => DocumentResources, shareSavedText?: boolean, retainInvalidHistory?: boolean): DocumentStateTransition
function mapJournalResources(type: 'checkpoint' | 'transition', input: DurableDocumentState | DocumentStateTransition,
  resources: (value: DocumentResources) => DocumentResources, shareSavedText?: boolean, retainInvalidHistory?: boolean): DurableDocumentState | DocumentStateTransition
function mapJournalResources(type: 'checkpoint' | 'transition', input: DurableDocumentState | DocumentStateTransition,
  resources: (value: DocumentResources) => DocumentResources, shareSavedText = false, retainInvalidHistory = false): DurableDocumentState | DocumentStateTransition {
  const optional = <T>(value: T, map: (value: T) => T): T => {
    try { return map(value) } catch (error) { if (!retainInvalidHistory) throw error; return value }
  }
  const models = new WeakMap<DocumentModel, DocumentModel>()
  const model = (value: DocumentModel): DocumentModel => {
    let result = models.get(value)
    if (!result) { result = { ...value, resources: resources(value.resources) }; models.set(value, result) }
    return result
  }
  const mapEffect = (value: DocumentAcceptedChange): DocumentAcceptedChange => value.kind === 'replace'
    ? { ...value, before: model(value.before), after: model(value.after) }
    : { ...value, beforeResources: resources(value.beforeResources), afterResources: resources(value.afterResources) }
  const effect = (value: DocumentAcceptedChange): DocumentAcceptedChange => optional(value, mapEffect)
  const entry = (value: DocumentHistoryEntry): DocumentHistoryEntry => optional(value, value => ({ ...value,
    ...(value.before ? { before: model(value.before) } : {}), ...(value.after ? { after: model(value.after) } : {}),
    ...(value.effects ? { effects: value.effects.map(effect) } : {}) }))
  const operation = (value: DurableDocumentState['operations'][number]): DurableDocumentState['operations'][number] => optional(value, value => ({ ...value,
    ...(value.before ? { before: model(value.before) } : {}), ...(value.after ? { after: model(value.after) } : {}),
    ...(value.effect ? { effect: effect(value.effect) } : {}),
    ...(value.sourceChange?.kind === 'edits' ? { sourceChange: { ...value.sourceChange,
      beforeResources: resources(value.sourceChange.beforeResources), afterResources: resources(value.sourceChange.afterResources) } } : {}) }))
  let value: DurableDocumentState | DocumentStateTransition
  if (type === 'checkpoint') {
    const state = input as DurableDocumentState
    const current = model(state.model), saved = state.savedModel
    // These are the complete text/markdown model facts. Share only this encoding wrapper;
    // the Session's current and saved roles and their original objects remain untouched.
    if (shareSavedText && (state.model.kind === 'text' || state.model.kind === 'markdown')
      && saved?.kind === state.model.kind && saved.source === state.model.source && saved.resources === state.model.resources) {
      models.set(saved, current)
    }
    value = { ...state, model: current, ...(saved ? { savedModel: optional(saved, model) } : {}),
      past: state.past.map(entry), future: state.future.map(entry), operations: state.operations.map(operation) }
  } else {
    const transition = input as DocumentStateTransition
    const history = transition.history
    value = { ...transition,
      ...(transition.modelChange ? { modelChange: mapEffect(transition.modelChange) } : {}),
      ...(transition.savedModel && 'model' in transition.savedModel ? { savedModel: { model: optional(transition.savedModel.model, model) } } : {}),
      ...(transition.operation ? { operation: operation(transition.operation) } : {}),
      ...(history?.type === 'push' ? { history: { ...history, entry: entry(history.entry) } }
        : history?.type === 'amend' ? { history: { ...history, effects: history.effects.map(effect) } }
        : history?.type === 'replace' ? { history: { ...history, past: history.past.map(entry), future: history.future.map(entry) } } : {}) }
  }
  return value
}

/** Resource views can come from fs pools or legacy deserialization. Normalize each exact view once;
 * never register its unrelated backing bytes, detach it, or alter a Session-owned resource. */
export class DocumentJournalCodec {
  private readonly resourceViews = new WeakMap<Uint8Array, Uint8Array>()
  private readonly resourceMaps = new WeakMap<DocumentResources, DocumentResources>()
  private buffers = new WeakMap<ArrayBuffer, number>()
  private nextBuffer = 1

  constructor(known: Iterable<readonly [number, ArrayBuffer]> = []) {
    for (const [id, buffer] of known) { this.buffers.set(buffer, id); this.nextBuffer = Math.max(this.nextBuffer, id + 1) }
  }

  private resourceBytes(input: Uint8Array): Uint8Array {
    const known = this.resourceViews.get(input)
    if (known) return known
    const result = input.buffer instanceof ArrayBuffer && input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
      ? input : Uint8Array.from(input)
    this.resourceViews.set(input, result)
    return result
  }

  private resources(input: DocumentResources, register: (bytes: Uint8Array) => void): DocumentResources {
    let result = this.resourceMaps.get(input)
    if (!result) {
      result = { assets: Object.fromEntries(Object.entries(input.assets).map(([id, bytes]) => [id, this.resourceBytes(bytes)])),
        components: Object.fromEntries(Object.entries(input.components).map(([id, files]) => [id,
          Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, this.resourceBytes(bytes)]))])) }
      this.resourceMaps.set(input, result)
    }
    for (const bytes of Object.values(result.assets)) register(bytes)
    for (const files of Object.values(result.components)) for (const bytes of Object.values(files)) register(bytes)
    return result
  }

  prepare(type: 'checkpoint', input: DurableDocumentState): { payload: Buffer; commit(): void }
  prepare(type: 'transition', input: DocumentStateTransition): { payload: Buffer; commit(): void }
  prepare(type: 'checkpoint' | 'transition', input: DurableDocumentState | DocumentStateTransition): { payload: Buffer; commit(): void } {
    const prepared = this.prepareValue(type, input)
    prepared.serializer.writeHeader(); prepared.serializer.writeValue(prepared.value)
    const payload = serialize({ journalVersion: 3, type, buffers: prepared.buffers, value: prepared.serializer.releaseBuffer() } satisfies EncodedJournalValue)
    return { payload, commit: prepared.commit }
  }

  /** A checkpoint encoded by the worker uses this exact registration traversal.
   * Register the original owned buffers after publication without encoding them again. */
  adoptCheckpoint(input: DurableDocumentState): void { this.prepareValue('checkpoint', input).commit() }

  private prepareValue(type: 'checkpoint' | 'transition', input: DurableDocumentState | DocumentStateTransition) {
    const serializer = new Serializer()
    const pending = new Map<ArrayBuffer, number>()
    const registered = new Set<ArrayBuffer>()
    let nextBuffer = type === 'checkpoint' ? 1 : this.nextBuffer
    const buffers: EncodedJournalValue['buffers'] = []
    const register = (bytes: Uint8Array) => {
      const buffer = bytes.buffer as ArrayBuffer
      if (registered.has(buffer)) return
      registered.add(buffer)
      let id = pending.get(buffer) ?? (type === 'checkpoint' ? undefined : this.buffers.get(buffer))
      if (id === undefined) { id = nextBuffer++; pending.set(buffer, id); buffers.push({ id, bytes }) }
      serializer.transferArrayBuffer(id, buffer)
    }
    const value = mapJournalResources(type, input, value => this.resources(value, register), type === 'checkpoint')
    return { serializer, value, buffers, commit: () => {
      if (type === 'checkpoint') this.buffers = new WeakMap()
      for (const [buffer, id] of pending) this.buffers.set(buffer, id)
      this.nextBuffer = nextBuffer
    } }
  }
}

/** One scan owns its dictionary. The returned writer uses only weak buffer identities. */
export class DocumentJournalDecoder {
  private readonly buffers = new Map<number, ArrayBuffer>()
  private resourceViews = new WeakMap<ArrayBufferLike, Map<string, Uint8Array>>()
  private resourceMaps = new WeakMap<DocumentResources, DocumentResources>()

  private resources(input: DocumentResources): DocumentResources {
    const known = this.resourceMaps.get(input)
    if (known) return known
    const bytes = (value: Uint8Array): Uint8Array => {
      let views = this.resourceViews.get(value.buffer)
      if (!views) { views = new Map(); this.resourceViews.set(value.buffer, views) }
      const key = `${value.byteOffset}:${value.byteLength}`
      let view = views.get(key)
      if (!view) { view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength); views.set(key, view) }
      return view
    }
    const result: DocumentResources = { assets: Object.fromEntries(Object.entries(input.assets).map(([id, value]) => [id, bytes(value)])),
      components: Object.fromEntries(Object.entries(input.components).map(([id, files]) => [id,
        Object.fromEntries(Object.entries(files).map(([name, value]) => [name, bytes(value)]))])) }
    this.resourceMaps.set(input, result)
    return result
  }

  decode(payload: Uint8Array): { type: 'checkpoint'; value: DurableDocumentState } | { type: 'transition'; value: DocumentStateTransition } {
    const outer = deserialize(payload) as EncodedJournalValue | DurableDocumentState
    if (!('journalVersion' in outer)) {
      this.buffers.clear(); this.resourceViews = new WeakMap(); this.resourceMaps = new WeakMap()
      return { type: 'checkpoint', value: outer }
    }
    if (outer.journalVersion !== 3 || !['checkpoint', 'transition'].includes(outer.type) || !Array.isArray(outer.buffers)
      || !isUint8Array(outer.value)) throw new Error('恢复日志codec无效')
    if (outer.type === 'checkpoint') {
      this.buffers.clear(); this.resourceViews = new WeakMap(); this.resourceMaps = new WeakMap()
    }
    for (const { id, bytes } of outer.buffers) {
      if (!Number.isSafeInteger(id) || id < 1 || this.buffers.has(id) || !isUint8Array(bytes)) throw new Error('恢复日志资源编号无效')
      // V8's outer view may point into the whole payload; retain only these resource bytes.
      this.buffers.set(id, Uint8Array.from(bytes).buffer)
    }
    const decoder = new Deserializer(outer.value)
    for (const [id, buffer] of this.buffers) decoder.transferArrayBuffer(id, buffer)
    decoder.readHeader()
    const value = decoder.readValue()
    return outer.type === 'checkpoint'
      ? { type: 'checkpoint', value: mapJournalResources('checkpoint', value, resources => this.resources(resources), false, true) }
      : { type: 'transition', value: mapJournalResources('transition', value, resources => this.resources(resources), false, true) }
  }

  writer(): DocumentJournalCodec { return new DocumentJournalCodec(this.buffers) }
}
