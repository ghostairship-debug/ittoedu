import { Layers3, Palette, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { BackgroundMode } from '../../../shared/courseProjectTypes'
import type { EffectiveBackground } from '../../../shared/effectiveBackground'
import { BufferedInput, PropertyDraftBoundary } from './PropertyControls'
import { RuntimePropertiesPanel, type RuntimePropertiesContext } from './RuntimePropertiesPanel'
import {
  SharedBackgroundProperties,
  type SharedBackgroundImportFile,
} from './SharedBackgroundProperties'

export type EmptySceneBackgroundOwnerTab = 'slide-surface' | 'scene' | 'state'

/** Shared write shape for the Slide surface and Scene owner tabs (mode/color/asset, all optional). */
export interface EmptySceneBackgroundPatch {
  readonly backgroundMode?: BackgroundMode
  readonly backgroundColor?: string
  readonly backgroundAssetId?: string | null
}

export interface EmptySceneSlideSurfaceView {
  readonly id: string
  readonly backgroundMode: BackgroundMode
  readonly backgroundColor: string | undefined
  readonly backgroundAssetId: string | null | undefined
  readonly effective: EffectiveBackground
}

export interface EmptySceneSceneView {
  readonly id: string
  readonly name: string
  readonly backgroundMode: BackgroundMode
  readonly backgroundColor: string
  readonly backgroundAssetId: string | null | undefined
  readonly effective: EffectiveBackground
  readonly interactionCount: number
  readonly stateName: string | null
}

export interface EmptySceneStateView {
  readonly id: string
  readonly name: string
  readonly backgroundColor: string | undefined
  readonly backgroundAssetId: string | null | undefined
  readonly effective: EffectiveBackground
}

export interface EmptyScenePropertiesContext {
  readonly kind: 'empty-scene'
  readonly draftBindingKey: string
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly slideSurface: EmptySceneSlideSurfaceView | null
  readonly scene: EmptySceneSceneView | null
  readonly state: EmptySceneStateView | null
  readonly editorMode: 'simple' | 'professional'
  readonly runtime: RuntimePropertiesContext | null
  readonly commands: {
    readonly updateName: (name: string) => void
    readonly updateSlideSurfaceBackground: (patch: EmptySceneBackgroundPatch) => void
    readonly importSlideSurfaceBackgroundAsset: (file: SharedBackgroundImportFile) => void
    readonly updateSceneBackground: (patch: EmptySceneBackgroundPatch) => void
    readonly importSceneBackgroundAsset: (file: SharedBackgroundImportFile) => void
    readonly updateStateBackground: (patch: { backgroundColor?: string; backgroundAssetId?: string | null }) => void
    readonly inheritStateColor: () => void
    readonly inheritStateAsset: () => void
    readonly openAutomation: () => void
    readonly openProfessionalAutomation: () => void
  }
  readonly onStale: () => void
}

const OWNER_TAB_LABEL: Record<EmptySceneBackgroundOwnerTab, string> = {
  'slide-surface': '演示页容器',
  scene: '场景',
  state: '当前状态',
}

export function EmptyScenePropertiesPanel({
  context,
}: {
  context: EmptyScenePropertiesContext
}) {
  const { scene, slideSurface, state } = context
  const availableTabs: EmptySceneBackgroundOwnerTab[] = [
    'slide-surface',
    'scene',
    ...(state ? (['state'] as const) : []),
  ]
  const [ownerTab, setOwnerTab] = useState<EmptySceneBackgroundOwnerTab>('scene')
  useEffect(() => {
    if (!availableTabs.includes(ownerTab)) setOwnerTab('scene')
    // Switching which tab is selected never writes to the project; it is
    // pure client-local view state, reset only when the previous selection
    // (e.g. "state") stops existing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.draftBindingKey, state])
  const activeTab = availableTabs.includes(ownerTab) ? ownerTab : 'scene'

  return (
    <PropertyDraftBoundary bindingKey={context.draftBindingKey} onStale={context.onStale}>
      <div className="properties-scroll" data-testid="properties-tab">
        <section className={`state-editing-notice${scene?.stateName ? ' state-editing-notice--override' : ''}`}>
          <Layers3 size={15} />
          <div>
            <strong>{scene?.stateName ? `当前预览：状态“${scene.stateName}”` : '当前预览：基础场景'}</strong>
            <span>下方“背景编辑对象”决定颜色/图片写入哪一层，与当前预览的状态无关。</span>
          </div>
        </section>
        <section className="property-section">
          <h3 className="property-title"><Palette size={14} />场景</h3>
          <BufferedInput label="场景名称" value={scene?.name ?? ''} onCommit={context.commands.updateName} />
        </section>
        <div
          className="property-owner-tabs"
          role="tablist"
          aria-label="背景编辑对象"
          data-testid="background-owner-tabs"
        >
          {availableTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={`secondary-button${activeTab === tab ? ' secondary-button--active' : ''}`}
              aria-selected={activeTab === tab}
              data-testid={`background-owner-tab-${tab}`}
              onClick={() => setOwnerTab(tab)}
            >
              {OWNER_TAB_LABEL[tab]}
            </button>
          ))}
        </div>
        {activeTab === 'slide-surface' && slideSurface && (
          <SharedBackgroundProperties
            key={`slide-surface-background:${slideSurface.id}`}
            ownerLabel="演示页容器"
            color={slideSurface.backgroundColor}
            assetId={slideSurface.backgroundAssetId}
            assets={context.assets}
            effective={slideSurface.effective}
            mode={{
              value: slideSurface.backgroundMode,
              onChange: (backgroundMode) => context.commands.updateSlideSurfaceBackground({ backgroundMode }),
            }}
            onColorChange={(backgroundColor) => context.commands.updateSlideSurfaceBackground({ backgroundColor })}
            onAssetChange={(backgroundAssetId) => context.commands.updateSlideSurfaceBackground({ backgroundAssetId })}
            onImportAsset={context.commands.importSlideSurfaceBackgroundAsset}
            testId="slide-surface-background-properties"
          />
        )}
        {activeTab === 'scene' && scene && (
          <SharedBackgroundProperties
            key={`scene-background:${scene.id}`}
            ownerLabel="场景"
            color={scene.backgroundColor}
            assetId={scene.backgroundAssetId}
            assets={context.assets}
            effective={scene.effective}
            mode={{
              value: scene.backgroundMode,
              onChange: (backgroundMode) => context.commands.updateSceneBackground({ backgroundMode }),
            }}
            onColorChange={(backgroundColor) => context.commands.updateSceneBackground({ backgroundColor })}
            onAssetChange={(backgroundAssetId) => context.commands.updateSceneBackground({ backgroundAssetId })}
            onImportAsset={context.commands.importSceneBackgroundAsset}
            testId="scene-background-properties"
          />
        )}
        {activeTab === 'state' && state && (
          <SharedBackgroundProperties
            key={`state-background:${state.id}`}
            ownerLabel="当前状态"
            color={state.backgroundColor}
            assetId={state.backgroundAssetId}
            assets={context.assets}
            effective={state.effective}
            inherit={{
              color: {
                inherited: state.backgroundColor === undefined,
                onToggle: context.commands.inheritStateColor,
              },
              asset: {
                inherited: state.backgroundAssetId === undefined,
                onToggle: context.commands.inheritStateAsset,
              },
            }}
            onColorChange={(backgroundColor) => context.commands.updateStateBackground({ backgroundColor })}
            onAssetChange={(backgroundAssetId) => context.commands.updateStateBackground({ backgroundAssetId })}
            testId="state-background-properties"
          />
        )}
        {context.editorMode === 'professional' ? (
          <>
            <section className="property-section">
              <h3 className="property-title"><Workflow size={14} />场景规则</h3>
              <p className="property-hint">当前场景有 {scene?.interactionCount ?? 0} 条规则。规则按“何时发生 → 是否满足条件 → 做什么”组织。</p>
              <button type="button" className="secondary-button" onClick={context.commands.openAutomation}><Workflow size={14} />打开规则面板</button>
            </section>
            {context.runtime && <RuntimePropertiesPanel context={context.runtime} />}
          </>
        ) : (scene?.interactionCount ?? 0) > 0 ? (
          <section className="property-section simple-rule-summary">
            <h3 className="property-title"><Workflow size={14} />专业互动</h3>
            <p className="property-hint">此场景已有 {scene?.interactionCount} 条专业规则，播放时会继续生效。</p>
            <button type="button" className="secondary-button" onClick={context.commands.openProfessionalAutomation}>切换专业模式查看</button>
          </section>
        ) : null}
      </div>
    </PropertyDraftBoundary>
  )
}
