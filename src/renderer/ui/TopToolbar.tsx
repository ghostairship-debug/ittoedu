import {
  Archive,
  Box,
  ChevronDown,
  Eye,
  FileDown,
  FilePlus2,
  FolderOpen,
  FileText,
  Presentation,
  Pencil,
  Redo2,
  History,
  MoreHorizontal,
  Save,
  SaveAll,
  ShieldCheck,
  Undo2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RecentProjectEntry } from '../../shared/ipcTypes'
import type { ProjectHealthSummary } from '../../shared/projectHealth'
import { APP_NAME } from '../../shared/constants'
import type { SingleHtmlExportMode } from '../export/course/buildCoursePackages'
import {
  selectActiveCourseProjectDocument,
  selectHasUnsavedCourseChanges,
  useEditorStore,
} from '../store/editorStore'

interface TopToolbarProps {
  busy: boolean
  onNew(): void
  onNewSpatial?(): void
  onNewFlow?(): void
  onOpen(): void
  recentProjects: RecentProjectEntry[]
  onOpenRecent(path: string): void
  onSave(saveAs?: boolean): void
  healthSummary: ProjectHealthSummary
  onOpenHealth(): void
  onPreview(): void
  onExport(format: ExportFormat, singleHtmlMode?: SingleHtmlExportMode): void
}

export type ExportFormat = 'single-html' | 'web-package' | 'pptx' | 'pdf' | 'docx'

interface ToolButtonProps {
  label: string
  title: string
  disabled?: boolean
  accent?: boolean
  onClick(): void
  children: React.ReactNode
}

function ToolButton({
  label,
  title,
  disabled,
  accent,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button${accent ? ' tool-button--accent' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

export function TopToolbar({
  busy,
  onNew,
  onNewSpatial,
  onNewFlow,
  onOpen,
  recentProjects,
  onOpenRecent,
  onSave,
  healthSummary,
  onOpenHealth,
  onPreview,
  onExport,
}: TopToolbarProps) {
  const project = useEditorStore((state) => state.project)
  const dirty = useEditorStore(selectHasUnsavedCourseChanges)
  const history = useEditorStore((state) => state.history)
  const activeSceneId = useEditorStore((state) => state.activeSceneId)
  const editorMode = useEditorStore((state) => state.editorMode)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setEditorMode = useEditorStore((state) => state.setEditorMode)
  const renameProject = useEditorStore((state) => state.renameProject)
  const courseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const hasFlowSurface = Boolean(courseDocument?.surfaces.some((surface) => surface.type === 'flow'))
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(project.title)
  useEffect(() => setTitleDraft(project.title), [project.title])
  const commitTitle = () => {
    const normalized = titleDraft.trim()
    if (normalized) renameProject(normalized)
    else setTitleDraft(project.title)
    setEditingTitle(false)
  }
  const sceneIndex = project.scenes.findIndex(
    (scene) => scene.id === activeSceneId,
  )

  return (
    <header className="toolbar" data-testid="top-toolbar">
      <div className="toolbar__brand" title={APP_NAME}>
        <span className="toolbar__brand-mark">
          <Box size={18} strokeWidth={2.2} />
        </span>
        <span>{APP_NAME}</span>
      </div>

      <div className="editor-mode-switch" role="group" aria-label="编辑模式">
        <button
          type="button"
          className={editorMode === 'simple' ? 'is-active' : ''}
          aria-pressed={editorMode === 'simple'}
          onClick={() => setEditorMode('simple')}
        >
          简洁
        </button>
        <button
          type="button"
          className={editorMode === 'professional' ? 'is-active' : ''}
          aria-pressed={editorMode === 'professional'}
          onClick={() => setEditorMode('professional')}
        >
          专业
        </button>
      </div>

      <div className="toolbar__group">
        <div className="new-project-split">
          <ToolButton label="新建" title="新建课件（Ctrl+N）" disabled={busy} onClick={onNew}>
            <FilePlus2 size={18} />
          </ToolButton>
          {onNewSpatial || onNewFlow ? (
            <details className="new-project-menu">
              <summary className="tool-button" title="更多新建选项" aria-label="更多新建选项">
                <ChevronDown size={14} />
              </summary>
              <div className="new-project-menu__list" role="menu">
                {onNewSpatial ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-spatial-project"
                    disabled={busy}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onNewSpatial()
                    }}
                  >
                    空白无限画布
                  </button>
                ) : null}
                {onNewFlow ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-flow-project"
                    disabled={busy}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onNewFlow()
                    }}
                  >
                    空白流式讲义
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
        <ToolButton label="打开" title="打开工程（Ctrl+O）" disabled={busy} onClick={onOpen}>
          <FolderOpen size={18} />
        </ToolButton>
        {editorMode === 'professional' && <details className="recent-projects">
          <summary className="tool-button" title="打开最近工程">
            <History size={18} />
            <span>最近</span>
          </summary>
          <div className="recent-projects__menu">
            <div className="recent-projects__title">最近工程</div>
            {recentProjects.length === 0 ? (
              <div className="recent-projects__empty">还没有最近工程</div>
            ) : recentProjects.map((project) => (
              <button
                type="button"
                key={project.path}
                className="recent-projects__item"
                title={project.path}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  onOpenRecent(project.path)
                }}
              >
                <span>{project.name}</span>
                <small>{project.path}</small>
              </button>
            ))}
          </div>
        </details>}
        <ToolButton label="保存" title="保存（Ctrl+S）" disabled={busy} onClick={() => onSave(false)}>
          <Save size={18} />
        </ToolButton>
        {editorMode === 'professional' && <ToolButton label="另存为" title="另存为" disabled={busy} onClick={() => onSave(true)}>
          <SaveAll size={18} />
        </ToolButton>}
      </div>

      <div className="toolbar__separator" />

      <div className="toolbar__group">
        <ToolButton
          label="撤销"
          title="撤销（Ctrl+Z）"
          disabled={busy || history.past.length === 0}
          onClick={undo}
        >
          <Undo2 size={18} />
        </ToolButton>
        <ToolButton
          label="重做"
          title="重做（Ctrl+Y / Ctrl+Shift+Z）"
          disabled={busy || history.future.length === 0}
          onClick={redo}
        >
          <Redo2 size={18} />
        </ToolButton>
      </div>

      <div className="toolbar__separator" />

      {editorMode === 'simple' && (
        <details className="toolbar-more-menu">
          <summary className="tool-button" title="更多工程操作" aria-label="更多工程操作">
            <MoreHorizontal size={18} />
            <span>更多</span>
          </summary>
          <div className="toolbar-more-menu__panel" role="menu" aria-label="更多工程菜单">
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                onSave(true)
              }}
            >
              <SaveAll size={16} />
              <span><strong>另存为</strong><small>保存一份新的工程副本</small></span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label={healthSummary.total === 0
                ? '工程检查：未发现问题'
                : `工程检查：${healthSummary.error} 个错误，${healthSummary.warning} 个提醒`}
              disabled={busy}
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                onOpenHealth()
              }}
            >
              <ShieldCheck size={16} />
              <span>
                <strong>工程检查</strong>
                <small>{healthSummary.total === 0
                  ? '未发现问题'
                  : `${healthSummary.error} 个错误，${healthSummary.warning} 个提醒`}</small>
              </span>
            </button>
            <div className="toolbar-more-menu__recent">
              <strong><History size={14} />最近工程</strong>
              {recentProjects.length === 0 ? (
                <small>还没有最近工程</small>
              ) : recentProjects.map((recent) => (
                <button
                  type="button"
                  key={recent.path}
                  title={recent.path}
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    onOpenRecent(recent.path)
                  }}
                >
                  <span>{recent.name}</span>
                  <small>{recent.path}</small>
                </button>
              ))}
            </div>
          </div>
        </details>
      )}

      <div className="toolbar__spacer" />

      <div className="toolbar__project">
        {editingTitle ? (
          <input
            className="toolbar__project-name-input"
            aria-label="课件名称"
            value={titleDraft}
            maxLength={80}
            autoFocus
            onChange={(event) => setTitleDraft(event.currentTarget.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setTitleDraft(project.title)
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="toolbar__project-name"
            title="重命名课件"
            aria-label="重命名课件"
            onClick={() => setEditingTitle(true)}
          >
            <span>{project.title}{dirty ? ' *' : ''}</span>
            <Pencil size={11} aria-hidden="true" />
          </button>
        )}
        <span className="toolbar__scene-index">
          场景 {sceneIndex + 1} / {project.scenes.length}
        </span>
      </div>

      {editorMode === 'professional' && <ToolButton
        label="工程检查"
        title={healthSummary.total === 0
          ? '工程检查：未发现问题'
          : `工程检查：${healthSummary.error} 个错误，${healthSummary.warning} 个提醒`}
        disabled={busy}
        onClick={onOpenHealth}
      >
        <span className="tool-button__badge-anchor">
          <ShieldCheck size={18} />
          {healthSummary.total > 0 && (
            <small className={healthSummary.error > 0 ? 'is-error' : 'is-warning'}>
              {healthSummary.total > 99 ? '99+' : healthSummary.total}
            </small>
          )}
        </span>
      </ToolButton>}

      <ToolButton
        label="整课预览"
        title="全屏 16:9 整课预览"
        disabled={busy}
        accent
        onClick={onPreview}
      >
        <Eye size={18} />
      </ToolButton>
      <details className="export-menu">
        <summary
          className="tool-button tool-button--accent export-menu__trigger"
          data-testid="export-menu-trigger"
          title="导出课件"
          aria-label="导出课件"
          aria-disabled={busy}
          onClick={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <span className="export-menu__trigger-icon">
            <FileDown size={18} />
            <ChevronDown size={11} />
          </span>
          <span>导出</span>
        </summary>
        <div className="export-menu__panel" role="menu" aria-label="选择导出格式">
          <div className="export-menu__title">选择导出格式</div>
          <button
            type="button"
            role="menuitem"
            data-testid="export-single-html"
            className="export-menu__item"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              onExport('single-html', 'offline-portable')
            }}
          >
            <FileDown size={18} />
            <span><strong>离线便携单 HTML</strong><small>资源全部内嵌，无网络也能使用，文件较大</small></span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="export-single-html-online"
            className="export-menu__item"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              onExport('single-html', 'online-lightweight')
            }}
          >
            <FileDown size={18} />
            <span><strong>在线轻量单 HTML</strong><small>保留已声明的远程素材地址，文件较小但依赖网络</small></span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="export-web-package"
            className="export-menu__item"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              onExport('web-package')
            }}
          >
            <Archive size={18} />
            <span><strong>网页包</strong><small>资源独立存放，推荐大型课件使用</small></span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="export-pptx"
            className="export-menu__item"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              onExport('pptx')
            }}
          >
            <Presentation size={18} />
            <span><strong>PowerPoint（PPTX）</strong><small>文字、图形、图片和组件为独立对象</small></span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="export-pdf"
            className="export-menu__item"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              onExport('pdf')
            }}
          >
            <FileText size={18} />
            <span><strong>PDF</strong><small>静态页面，互动组件将静态化</small></span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="export-docx"
            className="export-menu__item"
            disabled={!hasFlowSurface}
            title={hasFlowSurface ? undefined : '请先新增流式讲义页面'}
            onClick={(event) => {
              if (!hasFlowSurface) return
              event.currentTarget.closest('details')?.removeAttribute('open')
              onExport('docx')
            }}
          >
            <FileText size={18} />
            <span><strong>DOCX 讲义</strong><small>Flow 内容导出为可编辑 Word 文档</small></span>
          </button>
        </div>
      </details>
    </header>
  )
}
