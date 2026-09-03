import { ElementsTab } from './ElementsTab'
import { NodesTab } from './NodesTab'
import { PropertiesTab } from './PropertiesTab'
import { AutomationTab } from './AutomationTab'
import { DeveloperTab } from './DeveloperTab'
import { ComponentsTab } from './ComponentsTab'
import { useEditorStore } from '../store/editorStore'
import type { SidebarTab } from '../store/slices/editorShellSlice'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogSnapshot,
} from '../../shared/componentCatalog'

interface RightSidebarProps {
  onAddImage(x?: number, y?: number): void
  onReplaceImage(): void
  onAddVideo(x?: number, y?: number): void
  onImportImage?(): void
  onImportAudio(): void
  onImportVideo(): void
  onImportExternalComponents?(): void
  onReplaceComponent?(packageId: string): void
  componentCatalog?: ComponentCatalogSnapshot
  onRefreshComponentCatalog?(): void
  onAddCatalogComponents?(
    entries: AvailableComponentCatalogPackage[],
  ): boolean | Promise<boolean>
  onUpdateCatalogComponent?(entry: AvailableComponentCatalogPackage): void
}

const simpleTabs: Array<{ id: SidebarTab; label: string }> = [
  { id: 'elements', label: '元素' },
  { id: 'layers', label: '图层' },
  { id: 'properties', label: '属性' },
]

const professionalTabs: Array<{ id: SidebarTab; label: string }> = [
  { id: 'elements', label: '元素' },
  { id: 'components', label: '组件' },
  { id: 'layers', label: '图层' },
  { id: 'properties', label: '属性' },
  { id: 'automation', label: '互动与动画' },
  { id: 'developer', label: '开发' },
]

export function RightSidebar({
  onAddImage,
  onReplaceImage,
  onAddVideo,
  onImportImage,
  onImportAudio,
  onImportVideo,
  onImportExternalComponents,
  onReplaceComponent,
  componentCatalog,
  onRefreshComponentCatalog,
  onAddCatalogComponents,
  onUpdateCatalogComponent,
}: RightSidebarProps) {
  const activeTab = useEditorStore((state) => state.activeTab)
  const editorMode = useEditorStore((state) => state.editorMode)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const tabs = editorMode === 'professional' ? professionalTabs : simpleTabs

  return (
    <aside
      className={`panel right-sidebar${
        editorMode === 'professional' && activeTab === 'developer'
          ? ' right-sidebar--developer'
          : ''
      }`}
      aria-label="编辑面板"
    >
      <div
        className="sidebar-tabs"
        role="tablist"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`sidebar-tab${
              activeTab === tab.id ? ' sidebar-tab--active' : ''
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {activeTab === 'elements' && (
          <ElementsTab
            onAddImage={onAddImage}
            onAddVideo={onAddVideo}
            onImportImage={onImportImage}
            onImportAudio={onImportAudio}
            onImportVideo={onImportVideo}
          />
        )}
        {activeTab === 'components' && editorMode === 'professional' && (
          <ComponentsTab
            componentCatalog={componentCatalog}
            onImportExternalComponents={onImportExternalComponents}
            onRefreshComponentCatalog={onRefreshComponentCatalog}
            onAddCatalogComponents={onAddCatalogComponents}
            onUpdateCatalogComponent={onUpdateCatalogComponent}
            onReplaceComponent={onReplaceComponent}
          />
        )}
        {activeTab === 'layers' && <NodesTab />}
        {activeTab === 'properties' && (
          <PropertiesTab onReplaceImage={onReplaceImage} />
        )}
        {activeTab === 'automation' && editorMode === 'professional' && (
          <AutomationTab />
        )}
        {activeTab === 'developer' && editorMode === 'professional' && (
          <DeveloperTab />
        )}
      </div>
    </aside>
  )
}
