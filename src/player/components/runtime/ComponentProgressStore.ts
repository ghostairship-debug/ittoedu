import type { ComponentProgressPort, ComponentProgressSnapshot, JsonValue } from '../../../shared/contracts/component-platform'

type ProgressRecord = { revision: string; schemaVersion: number; value?: JsonValue }
const databaseName = 'guoling-learning-progress-v1'
const storeName = 'snapshots'

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}
function storageFailure(error: unknown): Error {
  if (error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string') return error
  const name = error instanceof Error ? error.name : '', message = error instanceof Error ? error.message : String(error)
  return Object.assign(failure(name === 'QuotaExceededError' ? 'progress-quota' : 'progress-unavailable', `本设备进度存储失败：${name ? name + '：' : ''}${message}`), { cause: error })
}
function namespaceKey(namespace: string, schemaVersion: number): void {
  if (!namespace.trim() || namespace.length > 128 || /[\u0000-\u001f]/.test(namespace))
    throw failure('progress-invalid', '进度命名空间须为 1–128 个非控制字符')
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
    throw failure('progress-invalid', '进度数据版本须为正整数')
}
/** Validate actual JSON, instead of silently discarding undefined or serializing DOM/class objects. */
function snapshot(value: JsonValue): JsonValue {
  const ancestors = new Set<object>()
  const check = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object' || !item || ancestors.has(item)) throw failure('progress-invalid', '学习进度必须是有限、无循环的 JSON 数据')
    const prototype = Object.getPrototypeOf(item)
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
      throw failure('progress-invalid', '学习进度只接受普通 JSON 对象')
    ancestors.add(item)
    if (Array.isArray(item)) { for (let index = 0; index < item.length; index++) check(item[index]) }
    else for (const child of Object.values(item)) check(child)
    ancestors.delete(item)
  }
  check(value)
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw failure('progress-too-large', '单份学习进度不能超过 1 MiB；请只保存继续点和必要结果')
  return JSON.parse(text) as JsonValue
}

/** The top-level carrier owns persistence. No content origin or runtime Map is used as storage. */
export class ComponentProgressStore {
  private database?: Promise<IDBDatabase>
  private closed = false
  constructor(private readonly options: { indexedDB?: IDBFactory; databaseName?: string; location?: string } = {}) {}

  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(failure('progress-cancelled', '进度宿主已关闭'))
    return this.database ??= new Promise((resolve, reject) => {
      let factory: IDBFactory | undefined
      try { factory = this.options.indexedDB ?? globalThis.indexedDB } catch (error) { reject(storageFailure(error)); return }
      if (!factory) { reject(failure('progress-unavailable', '当前宿主不支持本设备进度存储')); return }
      let request: IDBOpenDBRequest
      try { request = factory.open(this.options.databaseName ?? databaseName, 1) } catch (error) { reject(storageFailure(error)); return }
      let settled = false
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName) }
      request.onerror = () => { settled = true; reject(storageFailure(request.error ?? failure('progress-unavailable', '无法打开进度存储'))) }
      request.onblocked = () => { settled = true; reject(failure('progress-blocked', '进度存储被另一个旧窗口占用，请关闭该窗口后重试')) }
      request.onsuccess = () => {
        if (settled || this.closed) { request.result.close(); reject(failure('progress-cancelled', '进度宿主已关闭')); return }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    })
  }

  /** One mounted caller must restore first and carry its exact acknowledged revision to every write. */
  port(workId: string, signal: AbortSignal, active: () => boolean): ComponentProgressPort {
    const seen = new Map<string, { schemaVersion: number; revision: string | null; compatible: boolean }>()
    const checkActive = () => {
      if (this.closed || signal.aborted || !active()) throw failure('progress-cancelled', '当前作品或运行代次已结束')
    }
    let location = this.options.location
    if (location === undefined) {
      try { const url = new URL(globalThis.location.href); url.hash = ''; url.search = ''; location = url.href }
      catch { location = 'host' }
    }
    const transact = async <T>(namespace: string, mode: IDBTransactionMode,
      apply: (current: ProgressRecord | undefined, store: IDBObjectStore, key: string) => T): Promise<T> => {
      checkActive()
      const database = await this.open()
      checkActive()
      return new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, mode), store = transaction.objectStore(storeName)
        const key = JSON.stringify([location, workId, namespace])
        let value: T, error: unknown
        const abort = () => { try { transaction.abort() } catch {} }
        signal.addEventListener('abort', abort, { once: true })
        const cleanup = () => signal.removeEventListener('abort', abort)
        transaction.onabort = () => { cleanup(); reject(storageFailure(error ?? transaction.error ?? failure('progress-cancelled', '进度提交已取消'))) }
        transaction.onerror = () => { error ??= transaction.error }
        transaction.oncomplete = () => {
          cleanup()
          try { checkActive(); resolve(value!) } catch (reason) { reject(reason) }
        }
        const request = store.get(key)
        request.onsuccess = () => {
          try {
            checkActive()
            const current = request.result as ProgressRecord | undefined
            if (current && (typeof current.revision !== 'string' || !Number.isSafeInteger(current.schemaVersion) || current.schemaVersion < 1))
              throw failure('progress-corrupt', '现有进度格式损坏，未覆盖原记录')
            value = apply(current, store, key)
          } catch (reason) { error = reason; abort() }
        }
        if (signal.aborted) abort()
      })
    }
    const save = async (namespace: string, schemaVersion: number, expectedRevision: string | null, value?: JsonValue) => {
      namespaceKey(namespace, schemaVersion)
      checkActive()
      const loaded = seen.get(namespace)
      if (!loaded || loaded.schemaVersion !== schemaVersion || loaded.revision !== expectedRevision)
        throw failure('progress-not-restored', '请先完成本版本进度恢复，再使用已确认版本提交')
      if (value !== undefined && !loaded.compatible)
        throw failure('progress-incompatible', '现有进度版本不兼容；需明确重新开始，不能覆盖为默认状态')
      const stored = value === undefined ? undefined : snapshot(value)
      const revision = await transact(namespace, 'readwrite', (current, store, key) => {
        if ((current?.revision ?? null) !== expectedRevision) throw failure('progress-conflict', '另一个窗口已更新学习进度；请重新读取后决定如何继续')
        const revision = crypto.randomUUID()
        // A reset is a versioned tombstone, so an old window cannot resurrect its prior game.
        store.put({ revision, schemaVersion, ...(stored === undefined ? {} : { value: stored }) } satisfies ProgressRecord, key)
        return revision
      })
      seen.set(namespace, { schemaVersion, revision, compatible: true })
      return { revision }
    }
    return {
      read: async (namespace, schemaVersion) => {
        namespaceKey(namespace, schemaVersion)
        const result = await transact<ComponentProgressSnapshot>(namespace, 'readonly', current => {
          if (!current || !Object.hasOwn(current, 'value')) return { status: 'empty', revision: current?.revision ?? null }
          if (current.schemaVersion !== schemaVersion) return { status: 'incompatible', revision: current.revision, schemaVersion: current.schemaVersion }
          return { status: 'ready', revision: current.revision, schemaVersion, value: snapshot(current.value!) }
        })
        seen.set(namespace, { schemaVersion, revision: result.revision, compatible: result.status !== 'incompatible' })
        return result
      },
      write: (namespace, schemaVersion, value, expectedRevision) => {
        // JavaScript/compiled callers also use this port directly. Missing data is
        // invalid JSON, never the explicit clear intent reserved for clear().
        if (value === undefined) return Promise.reject(failure('progress-invalid', '学习进度写入必须提供 JSON 数据；清档请使用明确的 clear 操作'))
        return save(namespace, schemaVersion, expectedRevision, value)
      },
      clear: (namespace, schemaVersion, expectedRevision) => save(namespace, schemaVersion, expectedRevision),
    }
  }

  dispose(): void {
    this.closed = true
    void this.database?.then(database => database.close(), () => {})
  }
}
