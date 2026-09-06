import type { LayerItem } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { getComponentPropValue, mergeComponentProps, resolveComponentEditorProperties } from '../../shared/componentProps'

export type LayerTextField = { readonly kind: 'table-cell'; readonly cellId: string } | {
  readonly kind: 'component-prop'
  readonly packageId: string
  readonly version: string
  readonly key: string
}

export interface LayerTextDraft { readonly text: string }

export function readLayerTextField(
  item: LayerItem,
  field: LayerTextField,
  packages: Readonly<Record<string, ComponentPackageData>>,
): string | undefined {
  if (field.kind === 'table-cell') {
    if (item.kind !== 'native' || item.content.nativeType !== 'table') return undefined
    return item.content.data.rows.flatMap(row => row.cells).find(cell => cell.id === field.cellId)?.text
  }
  if (item.kind !== 'component' || item.component.packageId !== field.packageId || item.component.version !== field.version) return undefined
  const pkg = Object.values(packages).find(pkg => pkg.manifest.id === field.packageId && pkg.manifest.version === field.version)
  if (!pkg) return undefined
  const property = resolveComponentEditorProperties(pkg.manifest, item.props).find(property => property.key === field.key && (property.type === 'text' || property.type === 'textarea'))
  if (!property) return undefined
  const text = getComponentPropValue(mergeComponentProps(pkg.manifest, item.props), field.key)
  return typeof text === 'string' ? text : undefined
}
