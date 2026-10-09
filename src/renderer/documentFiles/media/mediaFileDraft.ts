import type { FileArtifactBinding, MediaFileDraftInput, MediaFileEditorPort, MediaFileOperation, MediaFileSnapshot } from '../../../shared/workbench/mediaFiles'

export interface MediaFileDraftState {
  base: MediaFileSnapshot
  preview: MediaFileSnapshot
  operations: readonly MediaFileOperation[]
  redo: readonly MediaFileOperation[]
  busy: 'preview' | 'save' | 'reload' | null
  error: string | null
  previewReady: boolean
}

/** Only unsaved gestures live here. Published bytes and binding remain owned by Main. */
export class MediaFileDraft {
  private state: MediaFileDraftState
  private listeners = new Set<() => void>()
  private generation = 0
  private disposed = false
  constructor(snapshot: MediaFileSnapshot, private readonly port: MediaFileEditorPort) {
    this.state = { base: snapshot, preview: snapshot, operations: [], redo: [], busy: null, error: null, previewReady: true }
  }
  read = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  rebind(binding: FileArtifactBinding) {
    if (binding.fileVersion !== this.state.base.binding.fileVersion) return
    if (binding.path === this.state.base.binding.path && binding.bindingVersion === this.state.base.binding.bindingVersion) return
    this.update({ base: { ...this.state.base, binding }, preview: { ...this.state.preview, binding } })
  }
  /** Operations are recorded synchronously; a pending preview is not a pending input. */
  captureCopyDraft(): MediaFileDraftInput {
    if (this.disposed || this.state.busy === 'save' || this.state.busy === 'reload') throw new Error('媒体文件正在保存或重新读取，请完成后再复制当前稿')
    return { binding: { ...this.state.base.binding }, operations: structuredClone(this.state.operations) }
  }
  private update(patch: Partial<MediaFileDraftState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  private async render(operations: readonly MediaFileOperation[], redo: readonly MediaFileOperation[]) {
    const generation = ++this.generation
    this.update({ operations, redo, busy: operations.length ? 'preview' : null, error: null, previewReady: false })
    if (!operations.length) { this.update({ preview: this.state.base, previewReady: true }); return }
    try {
      const preview = await this.port.preview(this.state.base.binding, operations)
      if (generation === this.generation) this.update({ preview, busy: null, previewReady: true })
    } catch (error) {
      if (generation === this.generation) this.update({ busy: null, error: error instanceof Error ? error.message : String(error), previewReady: false })
    }
  }
  async apply(operation: MediaFileOperation) {
    if (this.state.busy || !this.state.previewReady) return
    await this.render([...this.state.operations, operation], [])
  }
  async undo() {
    if (!this.state.operations.length || this.state.busy === 'save' || this.state.busy === 'reload') return
    await this.render(this.state.operations.slice(0, -1), [...this.state.redo, this.state.operations.at(-1)!])
  }
  async redo() {
    if (!this.state.redo.length || this.state.busy) return
    await this.render([...this.state.operations, this.state.redo.at(-1)!], this.state.redo.slice(0, -1))
  }
  async save(): Promise<MediaFileSnapshot | null> {
    if (this.state.busy || !this.state.previewReady || !this.state.operations.length) return null
    const generation = ++this.generation
    this.update({ busy: 'save', error: null })
    try {
      const saved = await this.port.save(this.state.base.binding, this.state.operations)
      if (generation === this.generation) this.update({ base: saved, preview: saved, operations: [], redo: [], busy: null, previewReady: true })
      return saved
    } catch (error) {
      if (generation === this.generation) this.update({ busy: null, error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }
  async reload(): Promise<MediaFileSnapshot | null> {
    if (this.state.busy === 'save') return null
    const generation = ++this.generation
    this.update({ busy: 'reload', error: null })
    try {
      const snapshot = await this.port.reload(this.state.base.binding)
      if (generation === this.generation) this.update({ base: snapshot, preview: snapshot, operations: [], redo: [], busy: null, previewReady: true })
      return snapshot
    } catch (error) {
      if (generation === this.generation) this.update({ busy: null, error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }
  dispose() { this.disposed = true; ++this.generation; this.listeners.clear() }
}
