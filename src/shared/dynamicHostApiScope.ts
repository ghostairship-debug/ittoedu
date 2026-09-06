/** Revoke host calls held by a failed or destroyed trusted dynamic instance. */
export function scopeDynamicHostApi<T extends object>(api: T, isActive: () => boolean): T {
  // Proxy a separate view: frozen API objects have nonconfigurable methods
  // whose identity a Proxy over the original is forbidden to replace.
  return new Proxy({} as T, {
    get(_target, key) {
      const value: unknown = Reflect.get(api, key, api)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => isActive() ? Reflect.apply(value, api, args) : undefined
    },
    has: (_target, key) => Reflect.has(api, key),
    ownKeys: () => Reflect.ownKeys(api),
    getOwnPropertyDescriptor: (_target, key) => Reflect.has(api, key)
      ? { enumerable: true, configurable: true }
      : undefined,
    set: () => false,
  })
}
