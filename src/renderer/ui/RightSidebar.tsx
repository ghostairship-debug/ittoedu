import { useEffect, useRef, useState } from 'react'
import {
  Boxes, Code2, FolderTree, Layers3, MessagesSquare, MousePointer2,
  Settings2, Sparkles, Workflow, X,
} from 'lucide-react'
import { ElementsTab } from './ElementsTab'
import { NodesTab } from './NodesTab'
import { PropertiesTab } from './PropertiesTab'
import { AutomationTab } from './AutomationTab'
import { DeveloperTab } from './DeveloperTab'
import { ComponentsTab } from './ComponentsTab'
import { useEditorStore } from '../store/editorStore'
import type { SidebarTab } from '../store/slices/editorShellSlice'
import {
  isProEditorTool, proEditorRailController, useProEditorRailState,
  type ProEditorPanel,
} from './proEditorRailController'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogSnapshot,
} from '../../shared/componentCatalog'
import './proEditorRail.css'

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

const sidebarTabs = [
  { id: 'elements', label: '元素', icon: MousePointer2 },
  { id: 'components', label: '组件', icon: Boxes },
  { id: 'layers', label: '图层', icon: Layers3 },
  { id: 'properties', label: '属性', icon: Settings2 },
  { id: 'automation', label: '互动与动画', icon: Workflow },
  { id: 'developer', label: '开发', icon: Code2 },
] as const satisfies ReadonlyArray<{ id: SidebarTab; label: string; icon: typeof MousePointer2 }>

const workspaceButtons = [
  { id: 'ai', label: 'AI 助手', icon: Sparkles },
  { id: 'resources', label: '资源管理器', icon: FolderTree },
  { id: 'conversations', label: '会话列表', icon: MessagesSquare },
] as const

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
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const { activePanel } = useProEditorRailState()
  const expanded = isProEditorTool(activePanel)
  const [visited, setVisited] = useState<ReadonlySet<SidebarTab>>(() => new Set())
  const railButtons = useRef<Partial<Record<ProEditorPanel & string, HTMLButtonElement>>>({})

  // Domain commands may select another tool while a panel is open. Follow that
  // selection without forcing a closed panel open after a canvas click.
  useEffect(() => {
    if (expanded && activePanel !== activeTab) proEditorRailController.open(activeTab)
  }, [activePanel, activeTab, expanded])
  useEffect(() => {
    if (!expanded) return
    setVisited((current) => current.has(activeTab) ? current : new Set([...current, activeTab]))
  }, [activeTab, expanded])

  const activateTool = (tab: SidebarTab) => {
    if (activePanel === tab) {
      proEditorRailController.close(tab)
    } else {
      setActiveTab(tab)
      proEditorRailController.open(tab)
    }
  }
  const closePanel = () => {
    const previous = activePanel
    proEditorRailController.close()
    if (previous) railButtons.current[previous]?.focus()
  }

  return (
    <aside
      className={`panel right-sidebar${expanded ? ' right-sidebar--expanded' : ''}${
        activeTab === 'developer' ? ' right-sidebar--developer' : ''
      }`}
      aria-label="编辑面板"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !activePanel) return
        event.preventDefault()
        event.stopPropagation()
        closePanel()
      }}
    >
      <div className="sidebar-tabs" role="tablist" aria-label="专业编辑工具" aria-orientation="vertical">
        {sidebarTabs.map((tab) => {
          const Icon = tab.icon
          return <button
            key={tab.id}
            ref={(node) => { railButtons.current[tab.id] = node ?? undefined }}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-expanded={activePanel === tab.id}
            aria-controls="pro-editor-tool-panel"
            className={`sidebar-tab${activePanel === tab.id ? ' sidebar-tab--active' : ''}`}
            onClick={() => activateTool(tab.id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        })}
      </div>
      <div className="sidebar-utility-tabs" aria-label="工作空间与助手">
        {workspaceButtons.map((item) => {
          const Icon = item.icon
          return <button
            key={item.id}
            ref={(node) => { railButtons.current[item.id] = node ?? undefined }}
            type="button"
            className={`sidebar-tab${activePanel === item.id ? ' sidebar-tab--active' : ''}`}
            aria-pressed={activePanel === item.id}
            title={item.label}
            onClick={() => proEditorRailController.toggle(item.id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        })}
      </div>
      <div className="sidebar-content" id="pro-editor-tool-panel" hidden={!expanded}>
        <header className="sidebar-content__header">
          <strong>{sidebarTabs.find((tab) => tab.id === activeTab)?.label}</strong>
          <button type="button" aria-label="收起编辑面板" onClick={closePanel}><X size={16} /></button>
        </header>
        {visited.has('elements') && <div className="sidebar-section" hidden={activeTab !== 'elements'}>
          <ElementsTab onAddImage={onAddImage} onAddVideo={onAddVideo}
            onImportImage={onImportImage} onImportAudio={onImportAudio} onImportVideo={onImportVideo} />
        </div>}
        {visited.has('components') && <div className="sidebar-section" hidden={activeTab !== 'components'}>
          <ComponentsTab componentCatalog={componentCatalog}
            onImportExternalComponents={onImportExternalComponents}
            onRefreshComponentCatalog={onRefreshComponentCatalog}
            onAddCatalogComponents={onAddCatalogComponents}
            onUpdateCatalogComponent={onUpdateCatalogComponent}
            onReplaceComponent={onReplaceComponent} />
        </div>}
        {visited.has('layers') && <div className="sidebar-section" hidden={activeTab !== 'layers'}><NodesTab /></div>}
        {visited.has('properties') && <div className="sidebar-section" hidden={activeTab !== 'properties'}>
          <PropertiesTab onReplaceImage={onReplaceImage} />
        </div>}
        {visited.has('automation') && <div className="sidebar-section" hidden={activeTab !== 'automation'}><AutomationTab /></div>}
        {visited.has('developer') && <div className="sidebar-section" hidden={activeTab !== 'developer'}><DeveloperTab /></div>}
      </div>
    </aside>
  )
}
