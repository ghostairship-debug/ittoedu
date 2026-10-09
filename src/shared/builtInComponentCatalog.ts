import type { ComponentCatalogTrust } from './componentCatalog'

/** Same app-root-relative resource path in source checkouts and packaged app.asar. */
export const BUILT_IN_COMPONENT_CATALOG_DIRECTORY = 'resources/built-in-components'

/** SHA-256 of the reviewed official catalog shipped with this editor build. */
export const BUILT_IN_COMPONENT_CATALOG_SHA256 =
  '81fd91ee4253aa711a674feb52c71765cd617ae506425df9bac06352e8339198'

export function trustForManagedCatalogDigest(digest: string): ComponentCatalogTrust {
  return digest.toLocaleLowerCase('en-US') === BUILT_IN_COMPONENT_CATALOG_SHA256
    ? 'built-in'
    : 'prompt'
}
