import type {} from '@/shared/contracts/course-project-v9/types'
import { fixtureValue, type FixtureIdentifier } from './barrel'
import { type FixtureShape } from './types'

/**
 * Primary fixture symbol.
 * It proves that the first JSDoc paragraph is retained.
 *
 * @remarks Later tags are intentionally omitted from the index summary.
 */
export const indexedValue = fixtureValue

export type IndexedShape = FixtureShape & { id: FixtureIdentifier }

export class IndexedClass {
  readonly value = indexedValue
}

export async function loadDynamicFixture() {
  return import('./dynamic')
}

const localOnly = true

export { localOnly as renamedLocal }
