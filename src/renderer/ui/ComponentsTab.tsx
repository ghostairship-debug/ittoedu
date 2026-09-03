import {
  Box,
  Check,
  ChevronLeft,
  Info,
  Library,
  LocateFixed,
  MoreVertical,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogSnapshot,
} from '../../shared/componentCatalog'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { componentCatalogInstallStatus } from '../components/componentCatalogStatus'
import {
  collectCourseComponentPackageUsage,
  type CourseComponentPackageUsage,
} from '../components/courseComponentPackageTransactions'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import {
  collectComponentLibrarySubjects,
  filterComponentLibraryPackages,
  selectCurrentCatalogPackages,
} from '../components/componentLibraryModel'
import {
  selectActiveCourseProjectDocument,
  selectEditingScope,
  useEditorStore,
} from '../store/editorStore'

interface ComponentsTabProps {
  componentCatalog?: ComponentCatalogSnapshot
  onImportExternalComponents?(): void
  onRefreshComponentCatalog?(): void
  onAddCatalogComponents?(
    entries: AvailableComponentCatalogPackage[],
  ): boolean | Promise<boolean>
  onUpdateCatalogComponent?(entry: AvailableComponentCatalogPackage): void
  onReplaceComponent?(packageId: string): void
}

const EMPTY_CATALOG: ComponentCatalogSnapshot = {
  sources: [],
  packages: [],
  issues: [],
}

const installStatusLabels = {
  available: '可加入工程',
  embedded: '已加入工程',
  'update-available': '有新版本',
  'embedded-newer': '工程版本更新',
  'hash-conflict': '同版本哈希冲突',
  'embedded-unverified': '已加入·历史哈希缺失',
} as const

const qualityLabels = {
  experimental: '试验',
  candidate: '候选',
  stable: '稳定',
  deprecated: '已弃用',
} as const

function ComponentThumbnail({ data }: { data: ComponentPackageData }) {
  if (data.thumbnailUrl) return <img src={data.thumbnailUrl} alt="" />
  return <Box size={20} />
}

function CatalogThumbnail({ entry }: { entry: AvailableComponentCatalogPackage }) {
  if (entry.thumbnailDataUrl) return <img src={entry.thumbnailDataUrl} alt="" />
  return <Box size={20} />
}

function setComponentDragData(
  event: React.DragEvent,
  packageId: string,
  label: string,
  presetId?: string,
) {
  const value = presetId
    ? `component-preset:${encodeURIComponent(packageId)}:${encodeURIComponent(presetId)}`
    : `component:${packageId}`
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-courseware-element', value)
  event.dataTransfer.setData('text/plain', label)
}

function closeContainingMenu(target: HTMLElement) {
  target.closest('details')?.removeAttribute('open')
}

function locateFlowBlockUsage(surfaceId: string, blockId: string) {
  const fail = (message: string) => {
    const state = useEditorStore.getState()
    state.setStatus(null)
    state.setError(message)
  }
  const state = useEditorStore.getState()
  const document = selectActiveCourseProjectDocument(state)
  if (!document) return
  const location = document.locations.find((candidate) => (
    candidate.kind === 'flow-block'
    && candidate.surfaceId === surfaceId
    && candidate.blockId === blockId
  )) ?? document.locations.find((candidate) => (
    candidate.kind === 'flow-block' && candidate.surfaceId === surfaceId
  ))
  if (!location || location.kind !== 'flow-block') {
    fail('该组件所在的流式讲义没有可激活的位置；请从页面列表打开该讲义后手动选择组件。')
    return
  }
  state.activateCourseLocation(location.id)
  const activated = useEditorStore.getState()
  const activeDocument = selectActiveCourseProjectDocument(activated)
  if (
    !activeDocument
    || activated.flowSession?.selection.surfaceId !== surfaceId
    || activated.flowSession.selection.locationId !== location.id
  ) {
    fail('无法切换到该组件所在的流式讲义；请从页面列表打开该讲义后重试。')
    return
  }
  try {
    activated.applyFlowSelection(selectFlowEditorBlock(activeDocument, location.id, blockId))
  } catch {
    fail('无法选中该组件在流式讲义中的内容块；请在讲义中手动选择。')
    return
  }
  const confirmed = useEditorStore.getState().flowSession?.selection
  if (
    confirmed?.surfaceId !== surfaceId
    || confirmed.locationId !== location.id
    || confirmed.selectedBlockId !== blockId
  ) {
    fail('无法选中该组件在流式讲义中的内容块；请在讲义中手动选择。')
    return
  }
  const latest = useEditorStore.getState()
  latest.setError(null)
  latest.setStatus('已定位组件使用位置')
}

interface ComponentDetailsDialogProps {
  data?: ComponentPackageData
  entry?: AvailableComponentCatalogPackage
  usage?: CourseComponentPackageUsage
  onClose(): void
}

function emptyCourseComponentPackageUsage(packageId: string): CourseComponentPackageUsage {
  return {
    packageId,
    packageExists: false,
    references: [],
    sceneInstanceCount: 0,
    globalInstanceCount: 0,
    totalInstanceCount: 0,
  }
}

function ComponentDetailsDialog({ data, entry, usage, onClose }: ComponentDetailsDialogProps) {
  const packageId = data?.manifest.id ?? entry?.packageId ?? ''
  const name = data?.manifest.name ?? entry?.name ?? packageId
  const version = data?.manifest.version ?? entry?.version ?? ''
  const sourceLabel = data?.provenance?.sourceLabel ?? entry?.sourceLabel ?? '来源未登记'
  const sha256 = data?.provenance?.sha256 ?? entry?.sha256
  const scopes = data?.manifest.supportedScopes ?? entry?.supportedScopes ?? []
  const renderMode = data?.manifest.renderMode ?? entry?.renderMode

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" data-testid="component-details-dialog">
      <section className="modal component-details-dialog" role="dialog" aria-modal="true" aria-labelledby="component-details-title">
        <div className="component-details-dialog__header">
          <div>
            <span>组件详情</span>
            <h2 id="component-details-title">{name}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭组件详情" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <dl className="component-details-dialog__list">
          <div><dt>组件 ID</dt><dd>{packageId}</dd></div>
          <div><dt>版本</dt><dd>{version}</dd></div>
          <div><dt>来源</dt><dd>{sourceLabel}</dd></div>
          <div><dt>渲染方式</dt><dd>{renderMode ?? '未知'}</dd></div>
          <div><dt>可用层</dt><dd>{scopes.map((scope) => scope === 'scene' ? '场景' : '全局').join('、')}</dd></div>
          {entry && <div><dt>质量状态</dt><dd>{qualityLabels[entry.quality]}</dd></div>}
          {usage && <div><dt>工程实例</dt><dd>场景 {usage.sceneInstanceCount} · 全局 {usage.globalInstanceCount}</dd></div>}
          {entry?.license && (
            <div><dt>许可证</dt><dd>{entry.license.status === 'declared' ? entry.license.expression : '尚未确认'}</dd></div>
          )}
          {sha256 && <div className="component-details-dialog__wide"><dt>SHA-256</dt><dd>{sha256}</dd></div>}
          {entry?.releaseBlockers && entry.releaseBlockers.length > 0 && (
            <div className="component-details-dialog__wide component-details-dialog__warning">
              <dt>发布阻断</dt><dd>{entry.releaseBlockers.join('、')}</dd>
            </div>
          )}
        </dl>
        {entry?.description && <p className="component-details-dialog__description">{entry.description}</p>}
        <div className="modal__actions">
          <button type="button" className="primary-button" onClick={onClose}>完成</button>
        </div>
      </section>
    </div>
  )
}

interface ComponentLibraryDialogProps {
  catalog: ComponentCatalogSnapshot
  components: Record<string, ComponentPackageData>
  onClose(): void
  onRefresh?(): void
  onAdd?(entries: AvailableComponentCatalogPackage[]): boolean | Promise<boolean>
  onUpdate?(entry: AvailableComponentCatalogPackage): void
}

export function ComponentLibraryDialog({
  catalog,
  components,
  onClose,
  onRefresh,
  onAdd,
  onUpdate,
}: ComponentLibraryDialogProps) {
  const entries = useMemo(
    () => selectCurrentCatalogPackages(
      catalog.packages.filter((entry) => entry.sourceTrust === 'built-in'),
    ),
    [catalog.packages],
  )
  const subjects = useMemo(() => collectComponentLibrarySubjects(entries), [entries])
  const schoolStages = useMemo(() => [...new Set(entries.flatMap((entry) => entry.schoolStage))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')), [entries])
  const categories = useMemo(() => [...new Set(entries.flatMap((entry) => entry.category ? [entry.category] : []))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')), [entries])
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [schoolStage, setSchoolStage] = useState('')
  const [category, setCategory] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [detailsEntry, setDetailsEntry] = useState<AvailableComponentCatalogPackage | null>(null)
  const visibleEntries = useMemo(() => filterComponentLibraryPackages(entries, {
    query,
    subject,
    schoolStage,
    category,
  }), [category, entries, query, schoolStage, subject])
  const selectableVisibleIds = visibleEntries
    .filter((entry) => componentCatalogInstallStatus(entry, components[entry.packageId]) === 'available')
    .map((entry) => entry.packageId)
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.packageId))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !detailsEntry && !adding) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [adding, detailsEntry, onClose])

  const toggleSelection = (packageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(packageId)) next.delete(packageId)
      else next.add(packageId)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const shouldSelect = selectableVisibleIds.some((id) => !next.has(id))
      selectableVisibleIds.forEach((id) => {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  return (
    <div className="component-library" data-testid="component-library" role="dialog" aria-modal="true" aria-labelledby="component-library-title">
      <header className="component-library__header">
        <button type="button" className="secondary-button" disabled={adding} onClick={onClose}>
          <ChevronLeft size={16} />返回编辑器
        </button>
        <div>
          <h2 id="component-library-title">内置组件库</h2>
          <p>多选后只加入工程，不会在画布上自动创建实例。</p>
        </div>
        <button type="button" className="secondary-button" disabled={!onRefresh} onClick={onRefresh}>
          <RefreshCw size={14} />刷新
        </button>
      </header>

      <div className="component-library__tools">
        <label className="component-library__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索内置组件"
            placeholder="搜索名称、用途或标签"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select aria-label="筛选学段" value={schoolStage} onChange={(event) => setSchoolStage(event.currentTarget.value)}>
          <option value="">全部学段</option>
          {schoolStages.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="筛选用途" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
          <option value="">全部用途</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      <div className="component-library__body">
        <nav className="component-library__subjects" aria-label="组件学科分类">
          <button type="button" className={subject === null ? 'is-active' : ''} onClick={() => setSubject(null)}>
            <span>全部组件</span><small>{entries.length}</small>
          </button>
          {subjects.map((value) => (
            <button type="button" key={value} className={subject === value ? 'is-active' : ''} onClick={() => setSubject(value)}>
              <span>{value}</span>
              <small>{entries.filter((entry) =>
                filterComponentLibraryPackages([entry], { query: '', subject: value, schoolStage: '', category: '' }).length > 0,
              ).length}</small>
            </button>
          ))}
        </nav>

        <main className="component-library__results">
          <div className="component-library__results-heading">
            <div><strong>{subject ?? '全部组件'}</strong><span>{visibleEntries.length} 个结果</span></div>
            <button
              type="button"
              className="secondary-button"
              disabled={selectableVisibleIds.length === 0}
              onClick={toggleAllVisible}
            >
              <Check size={13} />全选当前结果
            </button>
          </div>
          {catalog.issues.some((issue) =>
            catalog.sources.some((source) =>
              source.trust === 'built-in' && source.sourceId === issue.sourceId,
            ),
          ) && (
            <div className="component-library__issues" role="status">
              <ShieldAlert size={16} />
              <span>内置组件库有完整性问题；失效包已停止展示。</span>
            </div>
          )}
          {visibleEntries.length === 0 ? (
            <div className="empty-state component-library__empty">
              {entries.length === 0 ? '当前没有可用的内置组件。' : '没有符合筛选条件的组件。'}
            </div>
          ) : (
            <div className="component-library__grid">
              {visibleEntries.map((entry) => {
                const status = componentCatalogInstallStatus(entry, components[entry.packageId])
                const selectable = status === 'available'
                const selected = selectedIds.has(entry.packageId)
                return (
                  <article
                    key={entry.packageId}
                    className={`component-library-card${selected ? ' is-selected' : ''}${status === 'hash-conflict' ? ' has-conflict' : ''}`}
                    data-testid={`catalog-component-${entry.packageId}`}
                  >
                    <label className={`component-library-card__select${selectable ? '' : ' is-disabled'}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selectable}
                        aria-label={`选择${entry.name}`}
                        onChange={() => toggleSelection(entry.packageId)}
                      />
                      <span className="component-library-card__thumbnail"><CatalogThumbnail entry={entry} /></span>
                    </label>
                    <div className="component-library-card__copy">
                      <div className="component-library-card__title">
                        <strong>{entry.name}</strong>
                        <span className={`component-quality component-quality--${entry.quality}`}>{qualityLabels[entry.quality]}</span>
                      </div>
                      <p>{entry.description}</p>
                      <div className="component-library-card__metadata">
                        <span>v{entry.version}</span>
                        <span>{entry.subject.length > 0 ? entry.subject.join(' / ') : '通用'}</span>
                        {entry.schoolStage.length > 0 && <span>{entry.schoolStage.join(' / ')}</span>}
                      </div>
                      <div className="component-library-card__status">
                        <span>{installStatusLabels[status]}</span>
                      </div>
                    </div>
                    <div className="component-library-card__actions">
                      <button type="button" className="secondary-button" onClick={() => setDetailsEntry(entry)}>
                        <Info size={13} />详情
                      </button>
                      {status === 'update-available' && (
                        <button type="button" className="secondary-button" disabled={!onUpdate} onClick={() => onUpdate?.(entry)}>
                          <RefreshCw size={13} />审阅更新
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </main>
      </div>

      <footer className="component-library__footer">
        <span>已选择 {selectedEntries.length} 个组件</span>
        <button
          type="button"
          className="primary-button"
          disabled={selectedEntries.length === 0 || !onAdd || adding}
          onClick={() => {
            if (!onAdd || adding) return
            setAdding(true)
            void Promise.resolve(onAdd(selectedEntries))
              .then((completed) => {
                if (!completed) return
                setSelectedIds(new Set())
                onClose()
              })
              .finally(() => setAdding(false))
          }}
        >
          {adding ? '正在校验…' : `加入工程${selectedEntries.length > 0 ? `（${selectedEntries.length}）` : ''}`}
        </button>
      </footer>
      {detailsEntry && (
        <ComponentDetailsDialog entry={detailsEntry} onClose={() => setDetailsEntry(null)} />
      )}
    </div>
  )
}

export function ComponentsTab({
  componentCatalog = EMPTY_CATALOG,
  onImportExternalComponents,
  onRefreshComponentCatalog,
  onAddCatalogComponents,
  onUpdateCatalogComponent,
  onReplaceComponent,
}: ComponentsTabProps) {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [detailsPackageId, setDetailsPackageId] = useState<string | null>(null)
  const components = useEditorStore((state) => state.componentPackages)
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const editingScope = useEditorStore(selectEditingScope)
  const spatialScope = useEditorStore((state) => state.spatialSession?.scope ?? null)
  const addExternalComponentNode = useEditorStore((state) => state.addExternalComponentNode)
  const deleteComponentPackage = useEditorStore((state) => state.deleteComponentPackage)
  const packages = useMemo(() => Object.values(components).sort((left, right) =>
    left.manifest.name.localeCompare(right.manifest.name, 'zh-CN'),
  ), [components])
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const visiblePackages = packages.filter((data) => [
    data.manifest.name,
    data.manifest.id,
    data.manifest.version,
    data.provenance?.sourceLabel ?? '',
    ...(data.manifest.presets?.map((preset) => preset.label) ?? []),
  ].join(' ').toLocaleLowerCase().includes(normalizedQuery))
  const currentCatalogEntries = useMemo(
    () => selectCurrentCatalogPackages(componentCatalog.packages),
    [componentCatalog.packages],
  )
  const detailsData = detailsPackageId ? components[detailsPackageId] : undefined
  const detailsEntry = detailsPackageId
    ? currentCatalogEntries.find((entry) => entry.packageId === detailsPackageId)
    : undefined
  const detailsUsage = detailsPackageId
    ? project
      ? collectCourseComponentPackageUsage(project, detailsPackageId)
      : emptyCourseComponentPackageUsage(detailsPackageId)
    : undefined

  const locateFirstUsage = (packageId: string) => {
    const state = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(state)
    if (!document) return
    const usage = collectCourseComponentPackageUsage(document, packageId)
    const reference = usage.references[0]
    if (!reference) return
    if (reference.carrier === 'flow-block' && reference.surfaceId) {
      locateFlowBlockUsage(reference.surfaceId, reference.instanceId)
      return
    }
    if (reference.scope === 'global') {
      state.setEditingScope('global')
    } else if (reference.sceneId) {
      state.setActiveScene(reference.sceneId)
    } else if (reference.surfaceId) {
      const location = document.locations.find((candidate) => (
        candidate.surfaceId === reference.surfaceId
      ))
      if (location) state.activateCourseLocation(location.id)
    }
    useEditorStore.getState().selectNode(reference.instanceId)
    useEditorStore.getState().setStatus('已定位组件使用位置')
  }

  return (
    <div className="components-tab" data-testid="components-tab">
      <div className="component-entry-actions">
        <button type="button" className="component-entry-action" data-testid="open-component-library" onClick={() => setLibraryOpen(true)}>
          <Library size={20} />
          <span><strong>打开内置组件库</strong><small>按通用和学科浏览，可多选加入工程</small></span>
        </button>
        <button type="button" className="component-entry-action" data-testid="import-external-components" disabled={!onImportExternalComponents} onClick={onImportExternalComponents}>
          <Upload size={20} />
          <span><strong>导入外部组件</strong><small>校验后直接加入；仅选择可信来源</small></span>
        </button>
      </div>

      <div className="section-heading section-heading--spaced">
        <span>工程组件</span><span>{packages.length}</span>
      </div>
      <label className="component-project-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索工程组件"
          placeholder="搜索工程组件"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </label>
      {visiblePackages.length === 0 ? (
        <div className="empty-state">
          {packages.length === 0
            ? '工程中还没有组件。请从内置组件库加入，或导入外部组件。'
            : `没有找到“${searchQuery.trim()}”。`}
        </div>
      ) : (
        <div className="project-component-list">
          {visiblePackages.map((data) => {
            const packageId = data.manifest.id
            const usage = project
              ? collectCourseComponentPackageUsage(project, packageId)
              : emptyCourseComponentPackageUsage(packageId)
            const isSpatial = spatialScope !== null
            const manifestScopeSupported = componentSupportsScope(
              data.manifest,
              isSpatial ? 'scene' : editingScope,
            )
            const scopeSupported = isSpatial
              ? spatialScope === 'world' && manifestScopeSupported
              : manifestScopeSupported
            const draggable = isSpatial ? false : scopeSupported
            const insertionDisabledReason = spatialScope === 'surface'
              ? '表面共享层暂不支持插入组件；请切换到无限画布世界层。'
              : spatialScope === 'global'
                ? '无限画布全局层暂不支持插入组件；请切换到无限画布世界层。'
                : spatialScope === 'world' && !manifestScopeSupported
                  ? '该组件未声明支持场景层，不能插入无限画布世界层。'
                  : editingScope === 'global'
                    ? '该组件不支持全局层；仍可从右侧菜单管理。'
                    : '该组件不支持场景层；仍可从右侧菜单管理。'
            const catalogEntry = currentCatalogEntries.find((entry) => entry.packageId === packageId)
            const catalogStatus = catalogEntry
              ? componentCatalogInstallStatus(catalogEntry, data)
              : null
            const canUpdate = catalogStatus === 'update-available'
            return (
              <article className="project-component-card" key={packageId} data-testid={`component-package-${packageId}`}>
                <div className="project-component-card__main">
                  <button
                    type="button"
                    className="component-card"
                    data-testid={`component-${packageId}`}
                    draggable={draggable}
                    disabled={!scopeSupported}
                    title={scopeSupported
                      ? `插入“${data.manifest.name}”`
                      : insertionDisabledReason}
                    onDragStart={draggable
                      ? (event) => setComponentDragData(event, packageId, data.manifest.name)
                      : undefined}
                    onClick={scopeSupported ? () => addExternalComponentNode(packageId) : undefined}
                  >
                    <span className="component-thumb"><ComponentThumbnail data={data} /></span>
                    <span>
                      <span className="component-name">{data.manifest.name}</span>
                      <span className="component-version">v{data.manifest.version} · {data.provenance?.sourceLabel ?? '工程组件'}</span>
                      <span className="component-version">场景 {usage.sceneInstanceCount} · 全局 {usage.globalInstanceCount}{canUpdate ? ' · 有更新' : ''}</span>
                    </span>
                    <Box size={15} />
                  </button>
                  <details className="project-component-menu">
                    <summary aria-label={`管理${data.manifest.name}`} title="组件管理"><MoreVertical size={17} /></summary>
                    <div className="project-component-menu__panel" role="menu">
                      <button type="button" role="menuitem" onClick={(event) => {
                        closeContainingMenu(event.currentTarget)
                        setDetailsPackageId(packageId)
                      }}><Info size={14} />查看详情</button>
                      <button type="button" role="menuitem" disabled={!canUpdate || !onUpdateCatalogComponent} onClick={(event) => {
                        closeContainingMenu(event.currentTarget)
                        if (catalogEntry) onUpdateCatalogComponent?.(catalogEntry)
                      }}><RefreshCw size={14} />更新组件</button>
                      <button type="button" role="menuitem" disabled={!onReplaceComponent} onClick={(event) => {
                        closeContainingMenu(event.currentTarget)
                        onReplaceComponent?.(packageId)
                      }}><Upload size={14} />替换组件包</button>
                      <button type="button" role="menuitem" disabled={usage.totalInstanceCount === 0} onClick={(event) => {
                        closeContainingMenu(event.currentTarget)
                        locateFirstUsage(packageId)
                      }}><LocateFixed size={14} />定位使用位置</button>
                      <button type="button" role="menuitem" className="is-danger" disabled={usage.totalInstanceCount > 0} title={usage.totalInstanceCount > 0 ? '仍有实例引用，需先删除实例。' : '从工程移除未使用的组件包。'} onClick={(event) => {
                        closeContainingMenu(event.currentTarget)
                        deleteComponentPackage(packageId)
                      }}><Trash2 size={14} />从工程移除</button>
                    </div>
                  </details>
                </div>
                {data.manifest.presets && data.manifest.presets.length > 0 && (
                  <div className="project-component-presets" aria-label={`${data.manifest.name}预设`}>
                    {data.manifest.presets.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        disabled={!scopeSupported}
                        draggable={draggable}
                        title={scopeSupported ? preset.description : insertionDisabledReason}
                        onDragStart={draggable
                          ? (event) => setComponentDragData(event, packageId, `${data.manifest.name} · ${preset.label}`, preset.id)
                          : undefined}
                        onClick={scopeSupported
                          ? () => addExternalComponentNode(packageId, undefined, undefined, preset.id)
                          : undefined}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
                {!scopeSupported && (
                  <div className="project-component-card__hint">
                    {insertionDisabledReason}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {libraryOpen && (
        <ComponentLibraryDialog
          catalog={componentCatalog}
          components={components}
          onClose={() => setLibraryOpen(false)}
          onRefresh={onRefreshComponentCatalog}
          onAdd={onAddCatalogComponents}
          onUpdate={onUpdateCatalogComponent}
        />
      )}
      {detailsPackageId && detailsData && (
        <ComponentDetailsDialog
          data={detailsData}
          entry={detailsEntry}
          usage={detailsUsage}
          onClose={() => setDetailsPackageId(null)}
        />
      )}
    </div>
  )
}
