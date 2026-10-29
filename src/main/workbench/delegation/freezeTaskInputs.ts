import path from 'node:path'
import { componentProjectFiles } from '../../../core/projectFiles/componentPlatform'
import { prepareComponentProjectFileSource, type ComponentProjectFile } from '../../../core/projectFiles/componentPlatform/projection'
import { isSourceDocumentModel, type DocumentSnapshot } from '../../../shared/workbench/document'
import type { PreparedTaskSource } from '../../../shared/workbench/toolPorts'
import { sourceResourceFiles } from '../documentSourceResources'

export interface TaskInputFreezeOptions { signal?: AbortSignal; sourceVersion?: 'current' | 'disk'; modelRepresentation?: boolean }
export interface TaskInputFreezePorts {
  assertActive(): void
  isMaterial(source: string): boolean
  material(source: string, signal?: AbortSignal, modelRepresentation?: boolean): Promise<{ name: string; mimeType: string; bytes: Uint8Array; version: string; representation?: string }>
  /** Read authority is checked before asking the current document owner; no disk read prerequisite. */
  authorize(source: string): Promise<string>
  opened(filename: string): Promise<DocumentSnapshot | undefined>
  disk(source: string): Promise<{ name: string; bytes: Uint8Array; version: string }>
}
const encoder = new TextEncoder()
const textExtension = /\.(?:html?|css|[cm]?js|[jt]sx?|json|md|markdown|txt|svg)$/i
const modelView = (source: string, version: string, text: string) => ({ mimeType: 'text/plain',
  text: text.length <= 64_000 ? text : text.slice(0, 64_000) + `\n[模型表示省略 ${text.length - 64_000} 字符；完整来源已冻结，可沿 read 继续读取]`,
  read: { source, version, ...(text.length > 64_000 ? { offset: 64_000 } : {}) } })
const resourceView = (source: string, name: string, version: string, bytes: Uint8Array) => {
  if (!textExtension.test(name)) return undefined
  try { return modelView(source, version, new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { return undefined }
}

/** Logical aggregate addresses can also name directories in the same projection.
 * Resolve that distinction once for this capture; source references keep their
 * original project addresses and concrete content/dependency paths stay intact. */
function materializedProjectPaths(files: readonly ComponentProjectFile[]): Map<ComponentProjectFile, string> {
  const key = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name
  const directories = new Set<string>()
  for (const file of files) {
    const parts = file.path.split('/')
    for (let length = 1; length < parts.length; length++) directories.add(key(parts.slice(0, length).join('/')))
  }
  const occupied = new Set([...files.map(file => key(file.path)), ...directories])
  return new Map(files.map(file => {
    let name = file.path
    if (file.kind === 'framework' && !file.binding && directories.has(key(name))) {
      for (let index = 1; ; index++) {
        const candidate = `${name}/index${index === 1 ? '' : `-${index}`}.json`
        if (occupied.has(key(candidate))) continue
        occupied.add(key(candidate)); name = candidate; break
      }
    }
    return [file, name] as const
  }))
}

/** Full source capture and model representation share one existing source owner. */
export async function freezeTaskInputs(sources: readonly string[], ports: TaskInputFreezePorts,
  options: TaskInputFreezeOptions = {}): Promise<readonly PreparedTaskSource[]> {
  const inputs: PreparedTaskSource[] = []
  const active = () => { options.signal?.throwIfAborted(); ports.assertActive() }
  for (const source of sources) {
    active()
    if (ports.isMaterial(source)) {
      const material = await ports.material(source, options.signal, options.modelRepresentation !== false)
      active()
      inputs.push({ source, name: path.basename(material.name), mimeType: material.mimeType, bytes: new Uint8Array(material.bytes),
        version: material.version, ...(material.representation !== undefined ? { modelRepresentation: { mimeType: 'application/json', text: material.representation,
          read: { source, version: material.version } } } : {}) })
      continue
    }
    const filename = await ports.authorize(source)
    active()
    const current = options.sourceVersion === 'disk' ? undefined : await ports.opened(filename)
    active()
    if (current && isSourceDocumentModel(current.model)) {
      const version = `document:${current.documentId}:${current.epoch}:${current.revision}`
      const resources = sourceResourceFiles(current.model.resources)
      const prefix = resources.size ? `${path.basename(filename)}.current/` : ''
      inputs.push({ source, name: prefix + path.basename(filename), mimeType: 'text/plain', bytes: encoder.encode(current.model.source), version,
        ...(options.modelRepresentation !== false ? { modelRepresentation: modelView(source, version, current.model.source) } : {}) })
      for (const [name, bytes] of resources) {
        const reference = `${source}#resource:${name}`, modelRepresentation = options.modelRepresentation === false ? undefined : resourceView(reference, name, version, bytes)
        inputs.push({ source: reference, name: prefix + name, mimeType: modelRepresentation ? 'text/plain' : 'application/octet-stream',
          bytes: new Uint8Array(bytes), version, ...(modelRepresentation ? { modelRepresentation } : {}) })
      }
    } else if (current?.model.kind === 'course-v10') {
      const version = `document:${current.documentId}:${current.epoch}:${current.revision}`
      // This is the same formal file projection consumed by project.read/apply,
      // including current Source dependencies and resource bytes, never the saved GLX.
      const files = componentProjectFiles(current.model.project, current.model.resources)
      const materializedPaths = materializedProjectPaths(files)
      for (const file of files) {
        active()
        // Directory captures intentionally leave builtin author sources lazy.
        // A complete task copy must prepare those same sources before reading
        // their bytes, even when no earlier project.read has warmed the loader.
        await prepareComponentProjectFileSource(file)
        active()
        const bytes = file.bytes ?? (file.content === undefined ? undefined : encoder.encode(file.content))
        if (!bytes) continue
        const reference = `${source}#project:${file.path}`
        inputs.push({ source: reference, name: `${path.basename(filename)}.current/${materializedPaths.get(file)!}`, mimeType: file.mimeType ?? 'text/plain',
          bytes: new Uint8Array(bytes), version,
          ...(options.modelRepresentation !== false && file.content !== undefined ? { modelRepresentation: modelView(reference, version, file.content) } : {}) })
      }
    } else {
      const file = await ports.disk(source)
      active()
      let text: string | undefined
      if (textExtension.test(file.name)) try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes) } catch { /* Original bytes remain available. */ }
      inputs.push({ source, name: file.name, mimeType: text === undefined ? 'application/octet-stream' : 'text/plain',
        bytes: new Uint8Array(file.bytes), version: file.version,
        ...(options.modelRepresentation !== false && text !== undefined ? { modelRepresentation: modelView(source, file.version, text) } : {}) })
    }
    active()
  }
  return inputs
}

/** Computation consumes the same complete source capture, with no text-extraction work. */
export async function freezeComputeInputs(sources: readonly string[], freeze: (sources: readonly string[], options: TaskInputFreezeOptions) => Promise<readonly PreparedTaskSource[]>,
  signal?: AbortSignal): Promise<readonly { name: string; bytes: Uint8Array }[]> {
  const inputs = await freeze(sources, { signal, sourceVersion: 'current', modelRepresentation: false })
  signal?.throwIfAborted()
  if (new Set(inputs.map(input => input.name)).size !== inputs.length) throw new Error('计算输入文件重名；请先选择不同文件名')
  return inputs.map(({ name, bytes }) => ({ name, bytes }))
}
