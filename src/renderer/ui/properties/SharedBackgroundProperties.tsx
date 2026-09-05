import { ImageIcon, Palette } from 'lucide-react'
import { useRef, type ChangeEvent } from 'react'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { BackgroundMode } from '../../../shared/courseProjectTypes'
import type {
  EffectiveBackground,
  EffectiveBackgroundOwner,
} from '../../../shared/effectiveBackground'
import { ColorInput } from '../ColorInput'
import { SelectField } from './PropertyControls'

export const EFFECTIVE_BACKGROUND_SOURCE_LABEL: Record<EffectiveBackgroundOwner, string> = {
  course: '课程',
  'slide-surface': '演示页容器',
  'slide-scene': '场景',
  'slide-state': '当前状态',
  'flow-surface': '流式讲义页',
  'spatial-surface': '无限画布',
}

export interface SharedBackgroundImportFile {
  readonly name: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface SharedBackgroundModeControl {
  readonly value: BackgroundMode
  readonly onChange: (mode: BackgroundMode) => void
}

export interface SharedBackgroundInheritToggle {
  readonly inherited: boolean
  readonly onToggle: () => void
}

/** Only Named state (no `backgroundMode`) uses this: independent per-field inherit. */
export interface SharedBackgroundInheritControl {
  readonly color: SharedBackgroundInheritToggle
  readonly asset: SharedBackgroundInheritToggle
}

export interface SharedBackgroundProps {
  /** Human label for the owner currently being edited, e.g. "场景" or "流式讲义页". */
  readonly ownerLabel: string
  /** This owner's own color. `undefined` only arises for Named state (no override yet). */
  readonly color: string | undefined
  /** This owner's own asset. `undefined` = untouched/no override; `null` = explicitly cleared. */
  readonly assetId: string | null | undefined
  readonly assets: Readonly<Record<string, AssetMeta>>
  /** What `resolveEffectiveBackground` resolves for this owner right now. */
  readonly effective: EffectiveBackground
  /** Present for Slide surface / Scene / Flow / Spatial; absent for Course / Named state. */
  readonly mode?: SharedBackgroundModeControl
  /** Present only for Named state. */
  readonly inherit?: SharedBackgroundInheritControl
  readonly onColorChange: (color: string) => void
  readonly onPreviewColorChange?: (color: string | null) => void
  readonly onAssetChange: (assetId: string | null) => void
  /** Omit to hide the upload affordance for owners with no import pathway wired yet. */
  readonly onImportAsset?: (file: SharedBackgroundImportFile) => void
  readonly testId?: string
}

/**
 * No-Store-dependent Background owner/control view, matching the
 * SharedShapeProperties architecture (r12-005): narrow values and typed
 * callbacks in, no store or resolver-authority access. Each Properties
 * adapter supplies its own owner's own values, the resolved effective
 * preview, and typed callbacks that call that owner's typed command.
 */
export function SharedBackgroundProperties({
  ownerLabel,
  color,
  assetId,
  assets,
  effective,
  mode,
  inherit,
  onColorChange,
  onPreviewColorChange,
  onAssetChange,
  onImportAsset,
  testId = 'shared-background-properties',
}: SharedBackgroundProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageAssets = Object.values(assets).filter((asset) => asset.kind === 'image')
  const isInheritMode = mode?.value === 'inherit'
  const colorInherited = inherit?.color.inherited ?? false
  const assetInherited = inherit?.asset.inherited ?? false

  const onFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !onImportAsset) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    onImportAsset({ name: file.name, mimeType: file.type || 'image/png', bytes })
  }

  return (
    <section className="property-section" data-testid={testId}>
      <h3 className="property-title"><Palette size={14} />{ownerLabel}背景</h3>
      <p className="property-hint" data-testid={`${testId}-effective`}>
        当前显示：{effective.color}
        {effective.assetId ? `，含图片（${assets[effective.assetId]?.filename ?? effective.assetId}）` : '，无图片'}
        {' '}· 来自{EFFECTIVE_BACKGROUND_SOURCE_LABEL[effective.sourceOwner]}
      </p>
      {mode && (
        <div data-testid={`${testId}-mode`}>
          <SelectField<BackgroundMode>
            label="背景来源"
            value={mode.value}
            options={[
              { value: 'inherit', label: '继承上级背景' },
              { value: 'own', label: '本级自有背景' },
            ]}
            onChange={mode.onChange}
          />
        </div>
      )}
      {isInheritMode && (
        <p className="property-hint" role="status" data-testid={`${testId}-dormant-hint`}>
          当前继承上级背景；下面的颜色/图片暂不生效，可先设置好，切回“本级自有背景”后立即应用。
        </p>
      )}
      <div data-testid={`${testId}-color-field`}>
        <ColorInput
          id={`${testId}-color-input`}
          data-testid={`${testId}-color`}
          label="背景颜色"
          value={color ?? effective.color}
          onChange={onColorChange}
          onPreviewChange={onPreviewColorChange}
        />
        {inherit && (
          <p className="property-hint" data-testid={`${testId}-color-inherit-status`}>
            {colorInherited ? (
              '颜色跟随场景；修改上方颜色即改为本状态独立设置。'
            ) : (
              <>
                颜色已独立设置。
                <button
                  type="button"
                  className="link-button"
                  aria-label="颜色恢复跟随场景"
                  onClick={inherit.color.onToggle}
                >
                  恢复跟随场景
                </button>
              </>
            )}
          </p>
        )}
      </div>
      <div data-testid={`${testId}-asset-field`}>
        <SelectField
          label="背景图片"
          value={assetId ?? effective.assetId ?? ''}
          options={[
            { value: '', label: '无图片' },
            ...imageAssets.map((asset) => ({
              value: asset.id,
              label: asset.filename || asset.id,
            })),
          ]}
          onChange={(value) => onAssetChange(value === '' ? null : value)}
        />
        {onImportAsset && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept="image/*"
              data-testid={`${testId}-asset-file-input`}
              onChange={onFileInputChange}
            />
            <button
              type="button"
              className="secondary-button"
              data-testid={`${testId}-asset-upload`}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={14} />从文件上传…
            </button>
          </>
        )}
        {inherit && (
          <p className="property-hint" data-testid={`${testId}-asset-inherit-status`}>
            {assetInherited ? (
              '图片跟随场景；选择或上传图片即改为本状态独立设置。'
            ) : (
              <>
                图片已独立设置。
                <button
                  type="button"
                  className="link-button"
                  aria-label="图片恢复跟随场景"
                  onClick={inherit.asset.onToggle}
                >
                  恢复跟随场景
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}
