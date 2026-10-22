import { ImageIcon, Palette } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { BackgroundMode } from '../../../shared/courseProjectTypes'
import type {
  EffectiveBackground,
  EffectiveBackgroundOwner,
} from '../../../shared/effectiveBackground'
import { ColorInput } from '../ColorInput'
import { SelectField, usePropertyDraftBindingKey, usePropertyDraftFlush, type PropertyDraftResume } from './PropertyControls'

export const EFFECTIVE_BACKGROUND_SOURCE_LABEL: Record<EffectiveBackgroundOwner, string> = {
  course: '课程',
  'slide-surface': '演示页容器',
  'slide-scene': '场景',
  'slide-state': '当前状态',
  'flow-surface': '流式布局页',
  'spatial-surface': '无限画布',
}

export interface SharedBackgroundImportFile {
  readonly name: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}
export interface SharedBackgroundImportHandler {
  (file: SharedBackgroundImportFile): void | Promise<void>
  capture?(): (file: SharedBackgroundImportFile) => void | Promise<void>
}
/** Freeze the existing canonical target before asynchronous file IO. */
export function backgroundImportHandler<T>(capture: () => T, commit: (target: T, file: SharedBackgroundImportFile) => void | Promise<void>): SharedBackgroundImportHandler {
  const prepare = () => { const target = capture(); return (file: SharedBackgroundImportFile) => commit(target, file) }
  return Object.assign((file: SharedBackgroundImportFile) => prepare()(file), { capture: prepare })
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
  /** Human label for the owner currently being edited, e.g. "场景" or "流式布局页". */
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
  readonly onTransparent?: () => void
  readonly onColorChange: (color: string) => void
  readonly onPreviewColorChange?: (color: string | null) => void
  readonly onAssetChange: (assetId: string | null) => void
  /** Omit to hide the upload affordance for owners with no import pathway wired yet. */
  readonly onImportAsset?: SharedBackgroundImportHandler
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
  onTransparent,
  onColorChange,
  onPreviewColorChange,
  onAssetChange,
  onImportAsset,
  testId = 'shared-background-properties',
}: SharedBackgroundProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bindingKey = usePropertyDraftBindingKey(), baseline = JSON.stringify({ color, assetId, mode: mode?.value })
  const [, refresh] = useState(0)
  const upload = useRef<{ bindingKey: string; baseline: string; name: string; mimeType: string; bytes?: Uint8Array;
    read?: () => Promise<Uint8Array>; commit?: SharedBackgroundImportHandler; resume?: PropertyDraftResume; pending?: Promise<boolean>; error?: string } | null>(null)
  const imageAssets = Object.values(assets).filter((asset) => asset.kind === 'image')
  const isInheritMode = mode?.value === 'inherit'
  const colorInherited = inherit?.color.inherited ?? false
  const assetInherited = inherit?.asset.inherited ?? false

  const applyUpload = (): Promise<boolean> => {
    const draft = upload.current
    if (!draft) return Promise.resolve(true)
    if (draft.pending) return draft.pending
    draft.pending = Promise.resolve().then(async () => {
      try {
        if (draft.resume) {
          const complete = await (draft.resume.pending ?? draft.resume.flush())
          if (!complete) {
            const raw = draft.resume.readDraft()?.raw
            const saved = raw ? JSON.parse(raw) : null
            if (Array.isArray(saved?.bytes)) draft.bytes = new Uint8Array(saved.bytes)
            draft.resume = { ...draft.resume, pending: undefined }
            throw new Error('原上传未完成；图片输入已保留，可重试上传。')
          }
          if (upload.current === draft) { upload.current = null; if (fileInputRef.current) fileInputRef.current.value = '' }
          return true
        }
        draft.bytes ??= await draft.read?.()
        if (!draft.bytes) throw new Error('原图片尚未读取完成，请重新选择文件。')
        if (!draft.commit) {
          if (draft.bindingKey !== bindingKey || draft.baseline !== baseline) throw new Error('原背景已变化；图片输入已保留，请返回原目标后处理。')
          draft.commit = onImportAsset?.capture?.() ?? onImportAsset
        }
        if (!draft.commit) throw new Error('当前背景暂不能上传；图片输入已保留。')
        await draft.commit({ name: draft.name, mimeType: draft.mimeType, bytes: draft.bytes })
        if (upload.current === draft) { upload.current = null; if (fileInputRef.current) fileInputRef.current.value = '' }
        return true
      } catch (error) { draft.error = error instanceof Error ? error.message : String(error); return false }
    }).finally(() => { draft.pending = undefined; refresh(value => value + 1) })
    return draft.pending
  }
  usePropertyDraftFlush(applyUpload, {
    hasDirty: () => Boolean(upload.current),
    inFlight: () => upload.current?.pending,
    readDraft: () => ({ bindingKey: upload.current?.bindingKey ?? bindingKey, label: `${testId}:图片上传`, kind: 'structured',
      raw: JSON.stringify(upload.current ? { name: upload.current.name, mimeType: upload.current.mimeType, bytes: upload.current.bytes ? Array.from(upload.current.bytes) : null } : null),
      baseline: upload.current?.baseline ?? baseline, composing: false }),
    restoreDraft: (record, resume) => {
      try {
        const value = JSON.parse(record.raw)
        if (!value || typeof value.name !== 'string') return false
        if (resume?.pending || !Array.isArray(value.bytes)) {
          if (!resume) return false
          upload.current = { bindingKey: record.bindingKey, baseline: record.baseline ?? baseline, name: value.name, mimeType: value.mimeType,
            bytes: Array.isArray(value.bytes) ? new Uint8Array(value.bytes) : undefined, resume, error: resume.pending ? undefined : '图片输入已保留，点击重试上传。' }
          // This is the original user-started IO, not a replay of a recovered command.
          if (resume.pending) void applyUpload()
          refresh(value => value + 1)
          return true
        }
        upload.current = { bindingKey: record.bindingKey, baseline: record.baseline ?? baseline, name: value.name, mimeType: value.mimeType,
          bytes: new Uint8Array(value.bytes), error: '图片输入已恢复，点击重试上传。' }
        refresh(value => value + 1)
        return true
      } catch { return false }
    },
  })
  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file || !onImportAsset) return
    try {
      const commit = onImportAsset.capture?.() ?? onImportAsset
      upload.current = { bindingKey, baseline, name: file.name, mimeType: file.type || 'image/png', commit,
        read: async () => new Uint8Array(await file.arrayBuffer()) }
      void applyUpload()
    } catch (error) {
      upload.current = { bindingKey, baseline, name: file.name, mimeType: file.type || 'image/png', read: async () => new Uint8Array(await file.arrayBuffer()),
        error: error instanceof Error ? error.message : String(error) }
      refresh(value => value + 1)
    }
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
      {onTransparent && <button type="button" className="secondary-button" data-testid={testId + '-transparent'} onClick={onTransparent}>透明背景（不绘制）</button>}
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
            {upload.current && <p className="property-hint" role="status">{upload.current.name}：{upload.current.error ?? '正在读取并上传…'}
              {upload.current.error && <button type="button" className="link-button" onClick={() => { void applyUpload() }}>重试上传</button>}
            </p>}
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
