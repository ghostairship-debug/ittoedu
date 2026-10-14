import type { AvailableComponentCatalogPackage } from '@/shared/componentCatalog'
import type { ComponentPackageData } from '@/shared/componentTypes'

export type ComponentCatalogInstallStatus =
  | 'available'
  | 'embedded'
  | 'update-available'
  | 'embedded-newer'
  | 'hash-conflict'
  | 'embedded-unverified'

interface ParsedSemanticVersion {
  core: [bigint, bigint, bigint]
  prerelease: string[]
}

function parseSemanticVersion(version: string): ParsedSemanticVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version)
  if (!match) return null
  return {
    core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)],
    prerelease: match[4]?.split('.') ?? [],
  }
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const leftValue = BigInt(left)
    const rightValue = BigInt(right)
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareSemanticVersions(left: string, right: string): number {
  const a = parseSemanticVersion(left)
  const b = parseSemanticVersion(right)
  if (!a || !b) return left.localeCompare(right, 'en-US')
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a.core[index]!
    const rightPart = b.core[index]!
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const comparison = comparePrereleaseIdentifier(leftPart, rightPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

export function componentCatalogInstallStatus(
  entry: AvailableComponentCatalogPackage,
  embedded: ComponentPackageData | undefined,
): ComponentCatalogInstallStatus {
  if (!embedded) return 'available'
  const versionComparison = compareSemanticVersions(entry.version, embedded.manifest.version)
  if (versionComparison > 0) return 'update-available'
  if (versionComparison < 0) return 'embedded-newer'
  if (!embedded.provenance) return 'embedded-unverified'
  if (embedded.provenance.sha256 !== entry.sha256) return 'hash-conflict'
  return 'embedded'
}
