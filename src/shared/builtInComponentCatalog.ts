import type { ComponentCatalogTrust } from './componentCatalog'

/** Same app-root-relative resource path in source checkouts and packaged app.asar. */
export const BUILT_IN_COMPONENT_CATALOG_DIRECTORY = 'resources/built-in-components'

/** SHA-256 of the reviewed official catalog shipped with this editor build. */
export const BUILT_IN_COMPONENT_CATALOG_SHA256 =
  '4740e19e7b38a0b8b35abd2039a2fda54e91b323ca03faf9f47bc0289165757d'

export function trustForManagedCatalogDigest(digest: string): ComponentCatalogTrust {
  return digest.toLocaleLowerCase('en-US') === BUILT_IN_COMPONENT_CATALOG_SHA256
    ? 'built-in'
    : 'prompt'
}
