import type { ComponentCatalogTrust } from './componentCatalog'

/** Same app-root-relative resource path in source checkouts and packaged app.asar. */
export const BUILT_IN_COMPONENT_CATALOG_DIRECTORY = 'resources/built-in-components'

/** SHA-256 of the reviewed official catalog shipped with this editor build. */
export const BUILT_IN_COMPONENT_CATALOG_SHA256 =
  'fedf8315a8a1cc636771760be95931b31dba7f6625b62adc8247d7eebf044573'

export function trustForManagedCatalogDigest(digest: string): ComponentCatalogTrust {
  return digest.toLocaleLowerCase('en-US') === BUILT_IN_COMPONENT_CATALOG_SHA256
    ? 'built-in'
    : 'prompt'
}
