/** Transient editor focus. References and discovery never grant file write access. */
export interface OfficeFocusLocation {
  page?: number
  part?: string
  shapeIds?: string[]
  sheet?: string
  range?: string
  paragraphId?: string
  paragraph?: number
}

export interface OpenWorkbenchFile {
  path: string
  name?: string
  format: string
  fileVersion?: string
  bindingVersion?: number
  documentId?: string
  epoch?: string
  revision?: number
}

export type FocusedWorkbenchFile = OpenWorkbenchFile & { active: boolean; focus?: OfficeFocusLocation }

export const focusPathKey = (path: string) => /^[a-z]:[\\/]/i.test(path)
  ? path.replace(/\\/g, '/').toLocaleLowerCase() : path.replace(/\\/g, '/')

export class OfficeFocusController {
  private files: OpenWorkbenchFile[] = []
  private activePath: string | null = null
  private locations = new Map<string, OfficeFocusLocation>()
  private listeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readVersion = () => this.version
  private changed() { ++this.version; for (const listener of this.listeners) listener() }

  setOpenFiles = (files: readonly OpenWorkbenchFile[], activePath: string | null) => {
    const next = files.map(file => {
      const previous = this.files.find(value => focusPathKey(value.path) === focusPathKey(file.path))
      // A delayed React projection must not roll back a binding published by a completed save.
      return previous?.bindingVersion !== undefined && (file.bindingVersion === undefined || previous.bindingVersion >= file.bindingVersion)
        ? { ...file, fileVersion: previous.fileVersion, bindingVersion: previous.bindingVersion } : { ...file }
    })
    const active = activePath && next.some(file => focusPathKey(file.path) === focusPathKey(activePath)) ? activePath : null
    if (JSON.stringify(this.files) === JSON.stringify(next) && this.activePath === active) return
    this.files = next; this.activePath = active
    const open = new Set(next.map(file => focusPathKey(file.path)))
    for (const key of this.locations.keys()) if (!open.has(key)) this.locations.delete(key)
    this.changed()
  }

  /** Publish a successful save synchronously before its flush promise resolves.
   * Only bytes/version change here; page/object focus and active file stay fixed. */
  updateBinding = (path: string, binding: { path: string; fileVersion: string; bindingVersion: number }): boolean => {
    const key = focusPathKey(path)
    if (focusPathKey(binding.path) !== key || !binding.fileVersion
      || !Number.isSafeInteger(binding.bindingVersion) || binding.bindingVersion <= 0) return false
    const index = this.files.findIndex(file => focusPathKey(file.path) === key)
    const current = this.files[index]
    if (!current || current.bindingVersion !== undefined && current.bindingVersion > binding.bindingVersion) return false
    if (current.bindingVersion === binding.bindingVersion) return current.fileVersion === binding.fileVersion
    this.files[index] = { ...current, fileVersion: binding.fileVersion, bindingVersion: binding.bindingVersion }
    this.changed()
    return true
  }

  updateLocation = (path: string, location: OfficeFocusLocation) => {
    const key = focusPathKey(path)
    if (!this.files.some(file => focusPathKey(file.path) === key)) return
    const next = structuredClone(location)
    if (JSON.stringify(this.locations.get(key)) === JSON.stringify(next)) return
    this.locations.set(key, next); this.changed()
  }

  capture = (): FocusedWorkbenchFile[] => this.files.map(file => {
    const focus = this.locations.get(focusPathKey(file.path))
    return { ...file, active: this.activePath !== null && focusPathKey(this.activePath) === focusPathKey(file.path),
      ...(focus ? { focus: structuredClone(focus) } : {}) }
  })

  current = (): FocusedWorkbenchFile | undefined => this.capture().find(file => file.active)
}

export const officeFocus = new OfficeFocusController()
