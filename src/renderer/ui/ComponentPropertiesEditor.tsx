import type {
  ComponentEditorProperty,
  ComponentManifest,
  ConfigurableComponentManifest,
} from '../../shared/componentTypes'
import {
  applyComponentVariant,
  getComponentPropValue,
  mergeComponentProps,
  resolveComponentEditorProperties,
  resolveComponentEditorState,
  resolveComponentPresetProps,
  setComponentPropValue,
} from '../../shared/componentProps'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import { SlidersHorizontal } from 'lucide-react'

export interface ComponentPropertiesTarget {
  readonly id: string
  readonly props: Record<string, unknown>
}

export interface ComponentPropertiesEditorProps {
  manifest: ComponentManifest
  node: ComponentPropertiesTarget
  assets: Readonly<Record<string, AssetMeta>>
  onChange(nextProps: Record<string, unknown>): void
}

function inputId(nodeId: string, key: string): string {
  return `component-prop-${nodeId}-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function FieldDescription({ value }: { value?: string }) {
  return value ? <small className="component-property-description">{value}</small> : null
}

interface PropertyFieldProps {
  field: ComponentEditorProperty
  node: ComponentPropertiesTarget
  effectiveProps: Readonly<Record<string, unknown>>
  assets: Readonly<Record<string, AssetMeta>>
  onChange(nextProps: Record<string, unknown>): void
}

function PropertyField({
  field,
  node,
  effectiveProps,
  assets,
  onChange,
}: PropertyFieldProps) {
  const id = inputId(node.id, field.key)
  const value = getComponentPropValue(effectiveProps, field.key)
  const update = (nextValue: unknown) => {
    onChange(setComponentPropValue(node.props, field.key, nextValue))
  }

  if (field.type === 'boolean') {
    return (
      <label className="property-row property-row--checkbox" htmlFor={id}>
        <input
          id={id}
          aria-label={field.label}
          type="checkbox"
          checked={value === true}
          onChange={(event) => update(event.currentTarget.checked)}
        />
        <span>{field.label}</span>
        <FieldDescription value={field.description} />
      </label>
    )
  }

  let control: React.ReactNode
  switch (field.type) {
    case 'text':
      control = (
        <input
          id={id}
          aria-label={field.label}
          type="text"
          value={stringValue(value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          required={field.required}
          onChange={(event) => update(event.currentTarget.value)}
        />
      )
      break
    case 'textarea':
      control = (
        <textarea
          id={id}
          aria-label={field.label}
          value={stringValue(value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          required={field.required}
          onChange={(event) => update(event.currentTarget.value)}
        />
      )
      break
    case 'number':
      control = (
        <span className="component-property-number">
          <input
            id={id}
            aria-label={field.label}
            type="number"
            value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
            min={field.min}
            max={field.max}
            step={field.step}
            required={field.required}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber
              update(Number.isFinite(next) ? next : undefined)
            }}
          />
          {field.unit ? <span>{field.unit}</span> : null}
        </span>
      )
      break
    case 'color':
      control = (
        <input
          id={id}
          aria-label={field.label}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(stringValue(value)) ? stringValue(value) : '#000000'}
          required={field.required}
          onChange={(event) => update(event.currentTarget.value)}
        />
      )
      break
    case 'select':
      control = (
        <select
          id={id}
          aria-label={field.label}
          value={stringValue(value)}
          required={field.required}
          onChange={(event) => update(event.currentTarget.value)}
        >
          {!field.required ? <option value="">未选择</option> : null}
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )
      break
    case 'image': {
      const imageAssets = Object.values(assets)
        .filter((asset) => asset.mimeType.startsWith('image/'))
        .sort((left, right) => left.filename.localeCompare(right.filename, 'zh-CN'))
      control = (
        <select
          id={id}
          aria-label={field.label}
          value={stringValue(value)}
          required={field.required}
          onChange={(event) => update(event.currentTarget.value || undefined)}
        >
          <option value="">未选择工程图片</option>
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>{asset.filename}</option>
          ))}
        </select>
      )
      break
    }
  }

  return (
    <label className="property-row" htmlFor={id}>
      <span>{field.label}</span>
      {control}
      <FieldDescription value={field.description} />
    </label>
  )
}

function visibleProperties(
  manifest: ConfigurableComponentManifest,
  properties: ComponentEditorProperty[],
  activePageId: string | undefined,
): ComponentEditorProperty[] {
  const editor = manifest.editor
  if (!editor?.pages || !activePageId) return properties

  const pageBoundKeys = new Set(
    editor.pages.flatMap((page) => page.propertyKeys),
  )
  const activeKeys = new Set(
    editor.pages.find((page) => page.id === activePageId)?.propertyKeys ?? [],
  )
  return properties.filter(
    (property) => !pageBoundKeys.has(property.key) || activeKeys.has(property.key),
  )
}

/**
 * Schema-driven component inspector. It is intentionally store-agnostic so the
 * properties panel can commit node.props through its normal undo transaction.
 */
export function ComponentPropertiesEditor({
  manifest,
  node,
  assets,
  onChange,
}: ComponentPropertiesEditorProps) {
  const effectiveProps = mergeComponentProps(manifest, node.props)
  const editorState = resolveComponentEditorState(manifest, effectiveProps)
  const discoveredProperties = resolveComponentEditorProperties(manifest, node.props)
  const properties = visibleProperties(
    manifest,
    discoveredProperties,
    editorState.pageId,
  )
  if (!manifest.editor && properties.length === 0) return null

  return (
    <section className="property-section component-properties-editor" data-testid="component-properties-editor">
      <h3 className="property-title"><SlidersHorizontal size={14} />组件内容</h3>
      {manifest.presets && manifest.presets.length > 0 ? (
        <label className="property-row">
          <span>应用预设</span>
          <select
            aria-label="应用组件预设"
            value=""
            onChange={(event) => {
              const presetId = event.currentTarget.value
              if (presetId) onChange(resolveComponentPresetProps(manifest, presetId))
            }}
          >
            <option value="">选择预设…</option>
            {manifest.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
      ) : null}

      {manifest.variants && manifest.variants.length > 0 ? (
        <label className="property-row">
          <span>组件变体</span>
          <select
            aria-label="组件变体"
            value={editorState.variantId ?? ''}
            onChange={(event) => {
              const variant = manifest.variants?.find(
                (item) => item.id === event.currentTarget.value,
              )
              if (variant) onChange(applyComponentVariant(node.props, variant, manifest))
            }}
          >
            <option value="">自定义</option>
            {manifest.variants.map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.label}</option>
            ))}
          </select>
        </label>
      ) : null}

      {manifest.editor?.pages && manifest.editor.previewPageProp ? (
        <label className="property-row">
          <span>编辑预览页面</span>
          <select
            aria-label="编辑预览页面"
            value={editorState.pageId ?? ''}
            onChange={(event) => {
              onChange(setComponentPropValue(
                node.props,
                manifest.editor!.previewPageProp!,
                event.currentTarget.value,
              ))
            }}
          >
            {manifest.editor.pages.map((page) => (
              <option key={page.id} value={page.id}>{page.label}</option>
            ))}
          </select>
        </label>
      ) : null}

      {properties.map((field) => (
        <PropertyField
          key={field.key}
          field={field}
          node={node}
          effectiveProps={effectiveProps}
          assets={assets}
          onChange={onChange}
        />
      ))}
      {properties.length === 0 ? (
        <p className="property-hint">当前页面没有公开的可编辑字段。</p>
      ) : null}
    </section>
  )
}
