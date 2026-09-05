import {
  AreaChart,
  BarChart3,
  Donut,
  Globe2,
  ImageIcon,
  LineChart,
  MousePointerClick,
  PieChart,
  Shapes,
  Table,
  Type,
  Video,
  SlidersHorizontal,
  Music2,
  Search,
  Sigma,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShapeType } from '../../shared/contracts/native-v1'
import { renderShapeCanvas } from '../../shared/canvasShapeRenderer'
import { createShapeNode } from '../project/nativeNodeFactories'
import { useEditorStore, selectMediaAssets, selectAudioSettings, selectEditingScope } from '../store/editorStore'
import type { EditingScope } from '../store/slices/editorShellSlice'
import { MediaTab } from './MediaTab'

interface ElementsTabProps {
  onAddImage(x?: number, y?: number): void
  onAddVideo?(x?: number, y?: number): void
  onImportImage?(): void
  onImportAudio?(): void
  onImportVideo?(): void
}

type AddCategory =
  | 'common'
  | 'media'
  | 'controls'

type AuthoringSurface = 'slide' | 'flow' | 'spatial'
type AuthoringScope = EditingScope
type SpatialInsertionScope = 'world' | 'surface' | 'global'
type InsertableElementKind = 'text' | 'formula' | 'image' | 'video' | 'shape' | 'table' | 'chart'
type InsertionCarrier =
  | 'free-node'
  | 'document-block'
  | 'page-overlay'
  | 'world-item'
  | 'global-layer-item'
  | 'unavailable'

interface InsertionCapability {
  enabled: boolean
  draggable: boolean
  carrier: InsertionCarrier
}

const SURFACE_INSERTION_HINT: Record<AuthoringSurface, Record<AuthoringScope, string>> = {
  slide: {
    scene: '演示页：单击添加自由节点，也可拖入画布定位。',
    global: '演示页全局层：单击或拖入可添加跨场景自由节点。',
  },
  flow: {
    scene: '流式讲义：单击添加文档块；图形添加为页面浮层。当前不可从面板拖入。',
    global: 'Flow 全局层：图形添加为全局浮层；文字和公式仍添加到当前文档页，图片和视频暂不可用。',
  },
  spatial: {
    scene: '无限画布：单击添加世界元素。当前不可从面板拖入。',
    global: '无限画布全局层：文本、公式、图片、视频和图形当前不可用；请切换到当前画布后添加世界元素。',
  },
}

const GLOBAL_SCOPE_NOTICE: Record<AuthoringSurface, { title: string; body: string }> = {
  slide: {
    title: '母版式全局层',
    body: '这里添加的文字、图片、图形和全局组件会跨场景持续存在，并可设置上下层与场景可见范围。',
  },
  flow: {
    title: 'Flow 全局层',
    body: '在上方快速添加中，当前只有图形会添加为跨页全局浮层；文字和公式仍添加到当前文档页，图片和视频暂不可用。',
  },
  spatial: {
    title: '无限画布全局层',
    body: '当前全局层不能插入文本、公式、图片、视频或图形。切换到当前画布后，可添加世界元素。',
  },
}

function insertionCapability(
  surface: AuthoringSurface,
  scope: AuthoringScope,
  kind: InsertableElementKind,
  spatialScope?: SpatialInsertionScope,
): InsertionCapability {
  if (surface === 'slide') {
    if (kind === 'table' || kind === 'chart') {
      return scope === 'scene'
        ? { enabled: true, draggable: true, carrier: 'free-node' }
        : { enabled: false, draggable: false, carrier: 'unavailable' }
    }
    return {
      enabled: true,
      draggable: true,
      carrier: scope === 'global' ? 'global-layer-item' : 'free-node',
    }
  }
  if (kind === 'table' || kind === 'chart') {
    return { enabled: false, draggable: false, carrier: 'unavailable' }
  }
  if (surface === 'spatial') {
    return spatialScope === 'world'
      ? { enabled: true, draggable: false, carrier: 'world-item' }
      : { enabled: false, draggable: false, carrier: 'unavailable' }
  }
  if (scope === 'global') {
    if (kind === 'shape') {
      return { enabled: true, draggable: false, carrier: 'global-layer-item' }
    }
    if (kind === 'image' || kind === 'video') {
      return { enabled: false, draggable: false, carrier: 'unavailable' }
    }
  }
  return {
    enabled: true,
    draggable: false,
    carrier: kind === 'shape' ? 'page-overlay' : 'document-block',
  }
}

function insertionTitle(
  surface: AuthoringSurface,
  scope: AuthoringScope,
  kind: InsertableElementKind,
  label: string,
  spatialScope?: SpatialInsertionScope,
): string {
  const capability = insertionCapability(surface, scope, kind, spatialScope)
  if (!capability.enabled) {
    if (surface === 'slide' && (kind === 'table' || kind === 'chart')) {
      return `${label}：暂不支持添加到全局层；请切换到当前场景`
    }
    if (kind === 'table' || kind === 'chart') {
      return `${label}：表格和图表只能添加到演示页场景`
    }
    return surface === 'spatial'
      ? spatialScope === 'surface'
        ? `${label}：表面共享层暂不支持插入；请切换到无限画布世界层`
        : `${label}：无限画布全局层暂不支持插入；请切换到无限画布世界层`
      : `${label}：Flow 全局层暂不支持插入；请切换到当前文档页`
  }
  if (surface === 'slide') {
    return scope === 'global'
      ? `${label}：单击添加全局自由节点；也可拖入演示页画布定位`
      : `${label}：单击添加自由节点；也可拖入演示页画布定位`
  }
  if (surface === 'spatial') return `${label}：单击添加世界元素`
  if (scope === 'global' && kind === 'shape') {
    return `${label}：单击添加全局浮层`
  }
  const carrier = kind === 'shape'
    ? '页面浮层'
    : kind === 'text'
      ? '文档段落'
      : kind === 'formula'
        ? '独立公式块'
        : kind === 'image'
          ? '文中图片块'
          : '文中视频块'
  return scope === 'global'
    ? `${label}：单击仍添加${carrier}（不会添加到全局层）`
    : `${label}：单击添加${carrier}`
}

const SIMPLE_ADD_CATEGORIES: Array<{ id: AddCategory; label: string }> = [
  { id: 'common', label: '常用' },
  { id: 'media', label: '媒体' },
]

const PROFESSIONAL_ADD_CATEGORIES: Array<{ id: AddCategory; label: string }> = [
  ...SIMPLE_ADD_CATEGORIES,
  { id: 'controls', label: '控制与全局' },
]

const CHART_ITEMS = [
  { type: 'bar' as const, label: '柱状图', keywords: '柱状图 柱形图 柱图 条形图 bar', Icon: BarChart3 },
  { type: 'line' as const, label: '折线图', keywords: '折线图 线图 趋势图 line', Icon: LineChart },
  { type: 'area' as const, label: '面积图', keywords: '面积图 区域图 area', Icon: AreaChart },
  { type: 'pie' as const, label: '饼图', keywords: '饼图 饼状图 占比图 比例图 pie', Icon: PieChart },
  { type: 'donut' as const, label: '环形图', keywords: '环形图 甜甜圈图 环状图 donut', Icon: Donut },
] as const

function setDragData(
  event: React.DragEvent,
  value: string,
  label: string,
) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-courseware-element', value)
  event.dataTransfer.setData('text/plain', label)
}

function ShapePreview({ type }: { type: ShapeType }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const node = createShapeNode(type, { width: 42, height: 26 })
    node.style.fillColor = '#8dbbff'
    node.style.fillOpacity = node.style.fillOpacity > 0 ? 0.72 : 0
    node.style.borderColor = '#8dbbff'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.save()
    context.scale(2, 2)
    renderShapeCanvas(context, node, 42, 26)
    context.restore()
  }, [type])
  return <canvas ref={canvasRef} className="shape-preview" width={84} height={52} aria-hidden="true" />
}

export function ElementsTab({
  onAddImage,
  onAddVideo,
  onImportImage,
  onImportAudio,
  onImportVideo,
}: ElementsTabProps) {
  const [activeCategory, setActiveCategory] = useState<AddCategory>('common')
  const [searchQuery, setSearchQuery] = useState('')
  const [showChartPicker, setShowChartPicker] = useState(false)

  useEffect(() => {
    if (!showChartPicker) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowChartPicker(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showChartPicker])
  const addTextNode = useEditorStore((state) => state.addTextNode)
  const addFormulaNode = useEditorStore((state) => state.addFormulaNode)
  const addShapeNode = useEditorStore((state) => state.addShapeNode)
  const slideDrawTool = useEditorStore((state) => state.slideDrawTool)
  const setSlideDrawTool = useEditorStore((state) => state.setSlideDrawTool)
  const addTableNode = useEditorStore((state) => state.addTableNode)
  const addInputNode = useEditorStore(state => state.addInputNode)
  const inputAvailable = useEditorStore(state => state.slideBackend?.getSession().scope === 'scene')
  const addChartNode = useEditorStore((state) => state.addChartNode)
  const mediaAssets = useEditorStore(selectMediaAssets)
  const audioSettings = useEditorStore(selectAudioSettings)
  const editorMode = useEditorStore((state) => state.editorMode)
  const editingScope = useEditorStore(selectEditingScope)
  const spatialInsertionScope = useEditorStore<SpatialInsertionScope | null>((state) => (
    state.spatialSession?.scope ?? null
  ))
  const flowSessionActive = useEditorStore((state) => Boolean(state.flowSession))
  const authoringSurface: AuthoringSurface = spatialInsertionScope
    ? 'spatial'
    : flowSessionActive
      ? 'flow'
      : 'slide'
  const surfaceInsertionHint = authoringSurface === 'spatial'
    ? spatialInsertionScope === 'world'
      ? '无限画布：单击添加世界元素。当前不可从面板拖入。'
      : spatialInsertionScope === 'surface'
        ? '表面共享层暂不支持插入元素；请切换到无限画布世界层。'
        : '无限画布全局层暂不支持插入元素；请切换到无限画布世界层。'
    : SURFACE_INSERTION_HINT[authoringSurface][editingScope]
  const globalScopeNotice = GLOBAL_SCOPE_NOTICE[authoringSurface]
  const textInsertion = insertionCapability(authoringSurface, editingScope, 'text', spatialInsertionScope ?? undefined)
  const formulaInsertion = insertionCapability(authoringSurface, editingScope, 'formula', spatialInsertionScope ?? undefined)
  const imageInsertion = insertionCapability(authoringSurface, editingScope, 'image', spatialInsertionScope ?? undefined)
  const videoInsertion = insertionCapability(authoringSurface, editingScope, 'video', spatialInsertionScope ?? undefined)
  const shapeInsertion = insertionCapability(authoringSurface, editingScope, 'shape', spatialInsertionScope ?? undefined)
  const tableInsertion = insertionCapability(authoringSurface, editingScope, 'table', spatialInsertionScope ?? undefined)
  const chartInsertion = insertionCapability(authoringSurface, editingScope, 'chart', spatialInsertionScope ?? undefined)
  const ensureTeacherController = useEditorStore((state) => state.ensureTeacherController)
  const categories = editorMode === 'professional'
    ? PROFESSIONAL_ADD_CATEGORIES
    : SIMPLE_ADD_CATEGORIES
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const searching = normalizedQuery.length > 0
  const matchesSearch = (label: string): boolean =>
    !searching || label.toLocaleLowerCase().includes(normalizedQuery)
  const visibleShapeGroups = useMemo(() => SHAPE_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter(({ label, type }) =>
        matchesSearch(`${label} ${type}`),
      ),
    }))
    .filter((group) => group.items.length > 0), [normalizedQuery])
  const showText = searching
    ? matchesSearch('文本 文字')
    : activeCategory === 'common'
  const showFormula = searching
    ? matchesSearch('公式 数学 formula')
    : activeCategory === 'common'
  const showImage = searching
    ? matchesSearch('图片 图像')
    : activeCategory === 'common'
  const showVideo = searching
    ? matchesSearch('视频')
    : activeCategory === 'common'
  const showTable = searching
    ? matchesSearch('表格 table')
    : activeCategory === 'common'
  const matchingCharts = useMemo(() => {
    if (!searching) return []
    return CHART_ITEMS.filter((item) =>
      matchesSearch(`图表 chart ${item.label} ${item.keywords}`)
    )
  }, [searching, normalizedQuery])
  const showCharts = searching
    ? matchingCharts.length > 0 || matchesSearch('图表 chart')
    : activeCategory === 'common'
  const showAudio = searching
    ? matchesSearch('声音 音频')
    : activeCategory === 'common'
  const showController = editorMode === 'professional' &&
    editingScope === 'global' &&
    (searching
      ? matchesSearch('教师控制器 导航')
      : activeCategory === 'controls')
  const showQuickAdd = showText || showFormula || showImage || showVideo || showAudio || showController || showTable || showCharts
  const showShapes = searching
    ? visibleShapeGroups.length > 0
    : activeCategory === 'common'
  const shapeGroups = visibleShapeGroups
  const assetSearchMatches = searching && (
    Object.values(mediaAssets).some((asset) =>
      matchesSearch(`${asset.filename} ${asset.mimeType} ${asset.kind}`),
    ) ||
    Object.values(audioSettings.sounds).some((sound) =>
      matchesSearch(`${sound.name} 音频 声音`),
    )
  )
  const showAssets = searching ? assetSearchMatches : activeCategory === 'media'
  const showControlsEmpty = editorMode === 'professional' &&
    activeCategory === 'controls' &&
    editingScope !== 'global' &&
    !searching

  useEffect(() => {
    if (
      editorMode === 'simple' &&
      activeCategory === 'controls'
    ) {
      setActiveCategory('common')
    }
  }, [activeCategory, editorMode])

  return (
    <div className="elements-scroll" data-testid="elements-tab">
      {editingScope === 'global' && (
        <div className="global-elements-notice" data-testid="global-elements-notice">
          <Globe2 size={20} />
          <div>
            <strong>{globalScopeNotice.title}</strong>
            <span>{globalScopeNotice.body}</span>
          </div>
        </div>
      )}
      <div className="add-browser" data-testid="add-browser">
        <label className="add-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            placeholder="搜索元素、图形或素材"
            aria-label="搜索元素内容"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </label>
        <div className="add-category-tabs" role="tablist" aria-label="元素内容分类">
          {categories.map((category) => (
            <button
              type="button"
              role="tab"
              key={category.id}
              aria-selected={!searching && activeCategory === category.id}
              className={activeCategory === category.id && !searching ? 'is-active' : ''}
              onClick={() => {
                setSearchQuery('')
                setActiveCategory(category.id)
              }}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>
      <>
        {showQuickAdd && (
          <>
          <div className="section-heading">
            <span>快速添加</span>
            <span title={surfaceInsertionHint}>
              <MousePointerClick size={14} />
            </span>
          </div>
          <p
            data-testid="surface-insertion-hint"
            style={{
              margin: '-4px 0 10px',
              color: 'var(--text-secondary)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {surfaceInsertionHint}
          </p>

          <div className="element-grid element-grid--primary">
            {showText && (
            <button
              type="button"
              aria-label="文本"
              className="element-card element-card--primary"
              title={insertionTitle(authoringSurface, editingScope, 'text', '文本', spatialInsertionScope ?? undefined)}
              disabled={!textInsertion.enabled}
              draggable={textInsertion.draggable}
              data-testid="add-text"
              data-insertion-carrier={textInsertion.carrier}
              style={{ cursor: textInsertion.enabled ? (textInsertion.draggable ? 'grab' : 'pointer') : 'not-allowed' }}
              onDragStart={textInsertion.draggable
                ? (event) => setDragData(event, 'text', '文本')
                : undefined}
              onClick={textInsertion.enabled ? () => addTextNode() : undefined}
            >
              <span className="element-icon">
                <Type size={20} />
              </span>
              文本
            </button>
            )}
            {showFormula && (
            <button
              type="button"
              aria-label="公式"
              className="element-card element-card--primary"
              title={insertionTitle(authoringSurface, editingScope, 'formula', '公式', spatialInsertionScope ?? undefined)}
              disabled={!formulaInsertion.enabled}
              draggable={formulaInsertion.draggable}
              data-testid="add-formula"
              data-insertion-carrier={formulaInsertion.carrier}
              style={{ cursor: formulaInsertion.enabled ? (formulaInsertion.draggable ? 'grab' : 'pointer') : 'not-allowed' }}
              onDragStart={formulaInsertion.draggable
                ? (event) => setDragData(event, 'formula', '公式')
                : undefined}
              onClick={formulaInsertion.enabled ? () => addFormulaNode() : undefined}
            >
              <span className="element-icon">
                <Sigma size={20} />
              </span>
              公式
            </button>
            )}
            {showImage && (
            <button
              type="button"
              aria-label="图片"
              className="element-card element-card--primary"
              title={insertionTitle(authoringSurface, editingScope, 'image', '图片', spatialInsertionScope ?? undefined)}
              disabled={!imageInsertion.enabled}
              draggable={imageInsertion.draggable}
              data-testid="add-image"
              data-insertion-carrier={imageInsertion.carrier}
              style={{ cursor: imageInsertion.enabled ? (imageInsertion.draggable ? 'grab' : 'pointer') : 'not-allowed' }}
              onDragStart={imageInsertion.draggable
                ? (event) => setDragData(event, 'image', '图片')
                : undefined}
              onClick={imageInsertion.enabled ? () => onAddImage() : undefined}
            >
              <span className="element-icon">
                <ImageIcon size={20} />
              </span>
              图片
            </button>
            )}
            {showVideo && (
            <button
              type="button"
              aria-label="视频"
              className="element-card element-card--primary"
              data-testid="add-video"
              title={insertionTitle(authoringSurface, editingScope, 'video', '视频', spatialInsertionScope ?? undefined)}
              disabled={!videoInsertion.enabled}
              draggable={videoInsertion.draggable}
              data-insertion-carrier={videoInsertion.carrier}
              style={{ cursor: videoInsertion.enabled ? (videoInsertion.draggable ? 'grab' : 'pointer') : 'not-allowed' }}
              onDragStart={videoInsertion.draggable
                ? (event) => setDragData(event, 'video', '视频')
                : undefined}
              onClick={videoInsertion.enabled ? () => onAddVideo?.() : undefined}
            >
              <span className="element-icon"><Video size={20} /></span>
              视频
            </button>
            )}
            {showAudio && onImportAudio && (
              <button
                type="button"
                aria-label="声音"
                className="element-card element-card--primary"
                data-testid="import-audio"
                onClick={onImportAudio}
              >
                <span className="element-icon"><Music2 size={20} /></span>
                声音
              </button>
            )}
            {showController && (
              <button
                type="button"
                aria-label="教师控制器"
                className="element-card element-card--primary"
                data-testid="add-teacher-controller"
                onClick={ensureTeacherController}
              >
                <span className="element-icon"><SlidersHorizontal size={20} /></span>
                教师控制器
              </button>
            )}
            {authoringSurface === 'slide' && inputAvailable && (!searchQuery || '填空题输入答案'.includes(searchQuery)) && (
              <button type="button" aria-label="填空题" className="element-card element-card--primary" data-testid="add-input" onClick={addInputNode}>
                <span className="element-icon"><Type size={20} /></span>填空题
              </button>
            )}
            {showTable && (
            <button
              type="button"
              aria-label="表格"
              className="element-card element-card--primary"
              title={insertionTitle(authoringSurface, editingScope, 'table', '表格', spatialInsertionScope ?? undefined)}
              disabled={!tableInsertion.enabled}
              draggable={tableInsertion.draggable}
              data-testid="add-table"
              data-insertion-carrier={tableInsertion.carrier}
              style={{ cursor: tableInsertion.enabled ? (tableInsertion.draggable ? 'grab' : 'pointer') : 'not-allowed' }}
              onDragStart={tableInsertion.draggable
                ? (event) => setDragData(event, 'table', '表格')
                : undefined}
              onClick={tableInsertion.enabled ? () => addTableNode() : undefined}
            >
              <span className="element-icon"><Table size={20} /></span>
              表格
            </button>
            )}
            {showCharts && (
              searching ? (
                chartInsertion.enabled ? (
                  matchingCharts.map(({ type, label, Icon }) => (
                    <button
                      type="button"
                      key={type}
                      aria-label={label}
                      className="element-card element-card--primary"
                      title={insertionTitle(authoringSurface, editingScope, 'chart', label, spatialInsertionScope ?? undefined)}
                      disabled={!chartInsertion.enabled}
                      draggable={chartInsertion.draggable}
                      data-testid={`add-chart-${type}`}
                      data-insertion-carrier={chartInsertion.carrier}
                      style={{ cursor: chartInsertion.draggable ? 'grab' : 'pointer' }}
                      onDragStart={chartInsertion.draggable
                        ? (event) => setDragData(event, `chart:${type}`, label)
                        : undefined}
                      onClick={() => addChartNode(type)}
                    >
                      <span className="element-icon"><Icon size={20} /></span>
                      {label}
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-label="图表（仅支持演示页）"
                    className="element-card element-card--primary"
                    title="图表仅支持演示页场景"
                    data-testid="add-chart-disabled"
                    style={{ cursor: 'not-allowed', opacity: 0.6 }}
                  >
                    <span className="element-icon"><BarChart3 size={20} /></span>
                    图表（仅演示页）
                  </button>
                )
              ) : chartInsertion.enabled ? (
                <>
                  <button
                    type="button"
                    aria-label="图表"
                    className={`element-card element-card--primary ${showChartPicker ? 'is-active' : ''}`}
                    title="图表：点击展开选择图表类型"
                    data-testid="add-chart"
                    aria-haspopup="dialog"
                    aria-expanded={showChartPicker}
                    onClick={() => setShowChartPicker((prev) => !prev)}
                  >
                    <span className="element-icon"><BarChart3 size={20} /></span>
                    图表
                  </button>
                  {showChartPicker && (
                    <div
                      className="chart-picker-popover"
                      data-testid="chart-picker-panel"
                      role="dialog"
                      aria-label="选择图表类型"
                    >
                      <div className="chart-picker-header">
                        <span className="chart-picker-title">选择图表类型</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="关闭图表选择"
                          onClick={() => setShowChartPicker(false)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="chart-picker-grid">
                        {CHART_ITEMS.map(({ type, label, Icon }) => (
                          <button
                            type="button"
                            key={type}
                            aria-label={label}
                            className="chart-picker-item"
                            title={insertionTitle(authoringSurface, editingScope, 'chart', label, spatialInsertionScope ?? undefined)}
                            draggable={chartInsertion.draggable}
                            data-testid={`add-chart-${type}`}
                            data-insertion-carrier={chartInsertion.carrier}
                            style={{ cursor: chartInsertion.draggable ? 'grab' : 'pointer' }}
                            onDragStart={chartInsertion.draggable
                              ? (event) => setDragData(event, `chart:${type}`, label)
                              : undefined}
                            onClick={() => {
                              addChartNode(type)
                              setShowChartPicker(false)
                            }}
                          >
                            <span className="chart-picker-item-icon"><Icon size={18} /></span>
                            <span className="chart-picker-item-label">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-label="图表（仅支持演示页）"
                  className="element-card element-card--primary"
                  title="图表仅支持演示页场景"
                  data-testid="add-chart-disabled"
                  style={{ cursor: 'not-allowed', opacity: 0.6 }}
                >
                  <span className="element-icon"><BarChart3 size={20} /></span>
                  图表
                </button>
              )
            )}
          </div>
          </>
        )}

          {showAssets && onImportAudio && onImportVideo && (
            <MediaTab
              embedded
              onImportImage={onImportImage}
              showAdvancedAudioSettings={editorMode === 'professional'}
              filterQuery={searchQuery}
              onImportAudio={onImportAudio}
              onImportVideo={onImportVideo}
            />
          )}

          {showShapes && (
            <>
          <div className="section-heading section-heading--spaced">
            <span>{searching ? '搜索到的图形' : '图形'}</span>
            <Shapes size={14} />
          </div>
          <div className="shape-palette">
            {shapeGroups.map((group) => (
              <section className="shape-group" key={group.label}>
                <div className="shape-group-label">{group.label}</div>
                <div className="shape-grid">
                  {group.items.map(({ type, label, testId }) => (
                    <button
                      type="button"
                      className="shape-button"
                      key={type}
                      title={insertionTitle(authoringSurface, editingScope, 'shape', label, spatialInsertionScope ?? undefined)}
                      disabled={!shapeInsertion.enabled}
                      aria-label={`添加${label}`}
                      data-testid={testId ?? `add-shape-${type}`}
                      draggable={shapeInsertion.draggable}
                      data-insertion-carrier={shapeInsertion.carrier}
                      style={{ cursor: shapeInsertion.enabled ? (shapeInsertion.draggable ? 'grab' : 'pointer') : 'not-allowed' }}
                      onDragStart={shapeInsertion.draggable
                        ? (event) => setDragData(event, `shape:${type}`, label)
                        : undefined}
                      aria-pressed={
                        (type === 'line' || type === 'elbow-arrow') && authoringSurface === 'slide'
                          ? slideDrawTool === type
                          : undefined
                      }
                      onClick={shapeInsertion.enabled ? () => {
                        if ((type === 'line' || type === 'elbow-arrow') && authoringSurface === 'slide') {
                          setSlideDrawTool(slideDrawTool === type ? null : type)
                          return
                        }
                        if (slideDrawTool !== null) setSlideDrawTool(null)
                        addShapeNode(type)
                      } : undefined}
                    >
                      <ShapePreview type={type} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
            </>
          )}

          {showControlsEmpty && (
            <div className="empty-state add-category-empty">
              教师控制器和全局元素需要在左侧切换到“全局层”后添加。
            </div>
          )}
      </>

      {searching && !showQuickAdd && !showShapes && !showAssets && (
        <div className="empty-state add-category-empty">
          没有找到“{searchQuery.trim()}”
        </div>
      )}
    </div>
  )
}

const SHAPE_GROUPS: Array<{
  label: string
  items: Array<{ type: ShapeType; label: string; testId?: string }>
}> = [
  {
    label: '基本',
    items: [
      { type: 'rectangle', label: '矩形', testId: 'add-rectangle' },
      { type: 'rounded-rectangle', label: '圆角矩形' },
      { type: 'ellipse', label: '圆形/椭圆' },
      { type: 'triangle', label: '三角形' },
      { type: 'diamond', label: '菱形' },
    ],
  },
  {
    label: '线条与箭头',
    items: [
      { type: 'line', label: '直线' },
      { type: 'elbow-arrow', label: '折线箭头' },
      { type: 'arrow-left', label: '左箭头' },
      { type: 'arrow-right', label: '右箭头' },
      { type: 'arrow-up', label: '上箭头' },
      { type: 'arrow-down', label: '下箭头' },
      { type: 'arrow-left-right', label: '双向箭头' },
    ],
  },
  {
    label: '括号与着重',
    items: [
      { type: 'brace-left', label: '左大括号' },
      { type: 'brace-right', label: '右大括号' },
      { type: 'brace-top', label: '上大括号' },
      { type: 'brace-bottom', label: '下大括号' },
      { type: 'brace-pair-horizontal', label: '横向括号对' },
      { type: 'brace-pair-vertical', label: '纵向括号对' },
      { type: 'bracket-left', label: '左方括号' },
      { type: 'bracket-right', label: '右方括号' },
      { type: 'emphasis-dot', label: '着重圆点' },
      { type: 'emphasis-triangle', label: '着重三角' },
    ],
  },
]
