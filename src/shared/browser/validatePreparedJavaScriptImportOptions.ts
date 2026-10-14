export const compiledPreparedImportOptionsProperty = '__guoling_compiled_prepared_import_options__'
export const compiledScopeActiveProperty = '__guoling_compiled_scope_active__'
export const preparedJavaScriptNativeImportBody = 'return import(url, options)'
type NativePreparedImport = (url: string, options: unknown) => Promise<unknown>

/** Root already prepares software factories with Function; child parsers use the same fixed body directly. */
export function createPreparedJavaScriptNativeImport(NativeFunction: typeof Function): NativePreparedImport {
  let invoke: NativePreparedImport | undefined
  return (url, options) => {
    invoke ??= new NativeFunction('url', 'options', preparedJavaScriptNativeImportBody) as NativePreparedImport
    return invoke(url, options)
  }
}

/** The original document graph owns the private operation, including recovery inputs. */
export function preparedJavaScriptImportOptionsOperation(sources: readonly string[]): string {
  let index = 0
  while (sources.some(source => source.includes(`guoling:validate-prepared-js-options:${index}`))) index++
  return `guoling:validate-prepared-js-options:${index}`
}

/** Self-contained: native child prefixes serialize this function in their own realm. */
export function createPreparedJavaScriptImportOptionsValidator(
  browser: Pick<typeof globalThis, 'Blob' | 'URL' | 'TypeError'>, isActive: () => boolean, nativeImport: NativePreparedImport,
) {
  const BlobConstructor = browser.Blob, Cancelled = browser.TypeError
  const createUrl = browser.URL.createObjectURL.bind(browser.URL)
  const revokeUrl = browser.URL.revokeObjectURL.bind(browser.URL)
  const urls = new Set<string>()
  let disposed = false
  const assertActive = (): void => {
    if (disposed || !isActive()) throw new Cancelled('已结束的组件实例不再启动准备模块')
  }
  const validate = async (options: unknown): Promise<void> => {
    assertActive()
    const url = createUrl(new BlobConstructor(['export {};'], { type: 'text/javascript' }))
    urls.add(url)
    try {
      await nativeImport(url, options)
      assertActive()
    } finally { urls.delete(url); revokeUrl(url) }
  }
  return { validate, assertActive, dispose(): void {
    if (disposed) return
    disposed = true
    for (const url of urls) revokeUrl(url)
    urls.clear()
  } }
}
