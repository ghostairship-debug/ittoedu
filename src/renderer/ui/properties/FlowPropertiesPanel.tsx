import { useRef, type ChangeEvent } from 'react'
import {
  Bold,
  ImageIcon,
  Italic,
  Trash2,
  Type,
} from 'lucide-react'
import type {
  FormulaAstNode,
  FormulaNode,
  ImageNode,
  ShapeNode,
  TextNode,
  TextRunStyle,
  VideoNode,
} from '../../../shared/contracts/native-v1'
import { formulaAstToAccessibleText } from '../../../shared/formulaLinear'
import { resolveEffectiveBackground } from '../../../shared/effectiveBackground'
import { applyTextRunStyle } from '../../../shared/textRuns'
import type {
  FlowBlock,
  FlowMediaBlock,
  LayerItem,
} from '../../../shared/courseProjectTypes'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type {
  CourseBackgroundFields,
  FlowSurfaceBackgroundFields,
} from '../../../shared/effectiveBackground'
import type { FlowEditorView } from '../../course/flowEditorView'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import {
  deriveFlowSelectionFormat,
  FLOW_PAPER_TEXT_COLOR,
  type FlowFormulaDraft,
  type FlowSelectionFormatField,
  type FlowTextEditSession,
} from '../../authoring/flowTextEdit'
import { ColorInput } from '../ColorInput'
import {
  FormulaAuthoringEditor,
  type FormulaAuthoringDraftChange,
} from '../FormulaAuthoringEditor'
import { SharedBackgroundProperties } from './SharedBackgroundProperties'
import { SharedShapeProperties } from './SharedShapeProperties'
import {
  CommonNodeProperties,
  ImageProperties,
  TextProperties,
  VideoProperties,
  type PropertiesPatch,
  type SlideNativeTextCommands,
} from './SlideNativePropertiesPanel'
import {
  normalizePropertiesPatch,
  propertiesViewFromLayerItem,
} from './propertiesItemView'
import {
  BufferedInput,
  FontFamilyPicker,
  PropertyDraftBoundary,
  SelectField,
  ToggleRow,
} from './PropertyControls'

const FLOW_MEDIA_KIND_LABEL: Record<FlowMediaBlock['mediaKind'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

export type FlowPropertiesKind = 'flow-page' | 'flow-block' | 'flow-overlay'

export type FlowBlockFormatCommand =
  | { readonly kind: 'convert-paragraph' }
  | { readonly kind: 'convert-quote' }
  | { readonly kind: 'convert-heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly kind: 'list-ordered'; readonly ordered: boolean }

export interface FlowImportedMediaBytes {
  readonly name: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface FlowPropertiesCommands {
  readonly renamePage: (surfaceId: string, title: string) => void
  readonly setPaperBackground: (surfaceId: string, backgroundColor: string) => void
  readonly updateSurfaceBackground: (patch: FlowSurfaceBackgroundFields) => void
  readonly importSurfaceBackgroundAsset: (file: FlowImportedMediaBytes) => void
  readonly patchSelectedBlock: (patch: Record<string, unknown>) => void
  readonly patchOverlayProperties: (patch: Record<string, unknown>) => void
  readonly replaceMediaAsset: (assetId: string) => void
  readonly importReplacementMedia: (imported: FlowImportedMediaBytes) => Promise<void> | void
  readonly moveSelectedBlock: (direction: 'up' | 'down') => void
  readonly convertSelectedToOverlay: () => void
  readonly convertOverlayToDocument: () => void
  readonly deleteSelectedBlocks: () => void
  readonly formatBlock: (spec: FlowBlockFormatCommand) => void
  readonly formatTextStyle: (style: TextRunStyle) => void
  readonly patchOverlayPaperSpace: (paperSpace: 'viewport' | 'paper') => void
  readonly commitOverlayFormula: (ast: FormulaAstNode, accessibleText: string) => void
  readonly beginBlockFormulaEdit: () => void
  readonly updateBlockFormulaDraft: (draft: FormulaAuthoringDraftChange) => void
  readonly setBlockFormulaComposing: (composing: boolean) => void
  readonly cancelBlockFormulaEdit: () => void
  readonly commitBlockFormula: (ast: FormulaAstNode, accessibleText: string) => void
  readonly reportError: (message: string) => void
}

export interface FlowPropertiesContext {
  readonly kind: FlowPropertiesKind
  readonly view: FlowEditorView
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly selection: FlowEditorSelection
  readonly textEdit: FlowTextEditSession | null
  readonly draftBindingKey: string
  /** Course-wide background fields, needed only to resolve the Flow surface's effective preview. */
  readonly course: CourseBackgroundFields
  readonly commands: FlowPropertiesCommands
}

function selectedFlowBlock(context: FlowPropertiesContext): FlowBlock | null {
  const blockId = context.selection.selectedBlockId
  if (!blockId) return null
  return context.view.blocks.find((entry) => entry.blockId === blockId)?.block as FlowBlock ?? null
}

function uniformFlowFormatValue<T>(field: FlowSelectionFormatField<T>): T | undefined {
  return field.state === 'uniform' ? field.value : undefined
}

function flowFormatFieldDescription<T>(
  label: string,
  field: FlowSelectionFormatField<T>,
): string {
  if (field.state === 'mixed') return `${label}：混合`
  if (field.state === 'unset') return `${label}：默认`
  return `${label}：${String(field.value)}`
}

function FlowPageProperties({ context }: { context: FlowPropertiesContext }) {
  const { view, commands } = context
  const effective = resolveEffectiveBackground({
    owner: 'flow-surface',
    course: context.course,
    surface: {
      backgroundMode: view.backgroundMode,
      backgroundColor: view.backgroundColor,
      backgroundAssetId: view.backgroundAssetId,
    },
  })
  return (
    <section className="property-section" data-testid="flow-page-properties">
      <h3 className="property-title"><Type size={14} />流式页面</h3>
      <BufferedInput
        label="页面标题"
        value={view.surfaceTitle}
        onCommit={(title) => commands.renamePage(view.surfaceId, title)}
      />
      <p className="property-hint">
        标题和段落在稿纸里编辑。这里只改页面名称与稿纸底色/背景图，不会出现 1280×720 场景背景。
      </p>
      <SharedBackgroundProperties
        key={`flow-surface-background:${view.surfaceId}`}
        ownerLabel="流式讲义页"
        color={view.backgroundColor}
        assetId={view.backgroundAssetId}
        assets={context.assets}
        effective={effective}
        mode={{
          value: view.backgroundMode,
          onChange: (backgroundMode) => commands.updateSurfaceBackground({ backgroundMode }),
        }}
        onColorChange={(backgroundColor) => commands.updateSurfaceBackground({ backgroundColor })}
        onAssetChange={(backgroundAssetId) => commands.updateSurfaceBackground({ backgroundAssetId })}
        onImportAsset={(file) => commands.importSurfaceBackgroundAsset(file)}
        testId="flow-surface-background-properties"
      />
    </section>
  )
}

function FlowMediaBlockProperties({
  context,
  block,
}: {
  context: FlowPropertiesContext
  block: FlowMediaBlock
}) {
  const { assets, commands } = context
  const fileInputRef = useRef<HTMLInputElement>(null)
  const asset = assets[block.assetId]
  const sameKindAssets = Object.values(assets).filter(
    (candidate) => candidate.kind === block.mediaKind,
  )
  const patchMedia = (patch: Partial<Pick<FlowMediaBlock, 'altText' | 'caption' | 'layout' | 'wrap'>>) => {
    commands.patchSelectedBlock(patch)
  }
  return (
    <section className="property-section" data-testid="flow-media-properties">
      <h3 className="property-title"><ImageIcon size={14} />媒体块</h3>
      <p className="property-hint">
        {FLOW_MEDIA_KIND_LABEL[block.mediaKind]}
        {asset?.filename ? ` · ${asset.filename}` : ''}
      </p>
      {block.mediaKind === 'image' || block.mediaKind === 'video' ? (
        <BufferedInput
          label="替代文本"
          value={block.altText ?? ''}
          onCommit={(altText) => patchMedia({ altText })}
        />
      ) : null}
      <BufferedInput
        label="题注"
        value={block.caption ?? ''}
        onCommit={(caption) => patchMedia({ caption })}
      />
      <SelectField<FlowMediaBlock['layout']>
        label="版式"
        value={block.layout}
        options={[
          { value: 'content-width', label: '正文宽' },
          { value: 'wide', label: '较宽' },
          { value: 'full-width', label: '全宽' },
        ]}
        onChange={(layout) => patchMedia({ layout })}
      />
      <div data-testid="flow-media-wrap">
        <SelectField<'none' | 'left' | 'right'>
          label="文字环绕"
          value={block.wrap ?? 'none'}
          options={[
            { value: 'none', label: '不环绕（独占一行）' },
            { value: 'left', label: '居左环绕' },
            { value: 'right', label: '居右环绕' },
          ]}
          onChange={(wrap) => patchMedia({ wrap })}
        />
      </div>
      <div data-testid="flow-replace-media">
        <SelectField
          label="替换素材"
          value={block.assetId}
          options={sameKindAssets.map((candidate) => ({
            value: candidate.id,
            label: candidate.filename || candidate.id,
          }))}
          onChange={(assetId) => commands.replaceMediaAsset(assetId)}
        />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        data-testid="flow-replace-media-file"
        accept={block.mediaKind === 'image' ? 'image/*' : block.mediaKind === 'video' ? 'video/*' : 'audio/*'}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            await commands.importReplacementMedia({
              name: file.name,
              mimeType: file.type,
              bytes,
            })
          } catch (error) {
            commands.reportError(error instanceof Error ? error.message : '无法替换素材')
          }
        }}
      />
      <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
        从文件替换…
      </button>
      <div className="property-button-row">
        <button
          type="button"
          className="secondary-button"
          data-testid="flow-block-move-up"
          onClick={() => commands.moveSelectedBlock('up')}
        >
          上移
        </button>
        <button
          type="button"
          className="secondary-button"
          data-testid="flow-block-move-down"
          onClick={() => commands.moveSelectedBlock('down')}
        >
          下移
        </button>
      </div>
      <button
        type="button"
        className="secondary-button"
        data-testid="flow-block-to-overlay"
        onClick={() => commands.convertSelectedToOverlay()}
      >
        转为浮层
      </button>
      <button
        type="button"
        className="secondary-button"
        data-testid="flow-delete-media-block"
        onClick={() => commands.deleteSelectedBlocks()}
      >
        <Trash2 size={14} />删除此块
      </button>
    </section>
  )
}

function FlowFormulaBlockProperties({ context, block }: {
  context: FlowPropertiesContext
  block: Extract<FlowBlock, { type: 'formula' }>
}) {
  const formulaEdit = context.textEdit?.kind === 'formula'
    && context.textEdit.blockId === block.id
    ? context.textEdit.draft as FlowFormulaDraft
    : null
  const node = {
    id: block.id,
    name: '公式',
    type: 'formula' as const,
    x: 0,
    y: 0,
    width: 420,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit' as const,
    formulaId: block.formulaId,
    accessibleText: block.accessibleText,
    ast: block.ast,
    style: { fontSize: 24, color: FLOW_PAPER_TEXT_COLOR, align: 'left' as const },
  }
  return (
    <section className="property-section" data-testid="flow-formula-properties">
      <h3 className="property-title">公式</h3>
      <FormulaAuthoringEditor
        key={`flow-block-formula:${context.draftBindingKey}`}
        node={node}
        {...(formulaEdit ? { draftSource: formulaEdit.source } : {})}
        onBeginEdit={() => context.commands.beginBlockFormulaEdit()}
        onDraftChange={(draft) => context.commands.updateBlockFormulaDraft(draft)}
        onCompositionChange={(composing) => context.commands.setBlockFormulaComposing(composing)}
        onCancel={() => context.commands.cancelBlockFormulaEdit()}
        onCommit={(ast, accessibleText) => {
          context.commands.commitBlockFormula(ast, accessibleText)
        }}
      />
    </section>
  )
}

function FlowBlockProperties({ context }: { context: FlowPropertiesContext }) {
  const block = selectedFlowBlock(context)
  const { commands, textEdit } = context
  if (!block) {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <FlowPageProperties context={context} />
      </div>
    )
  }

  const selectionFormat = deriveFlowSelectionFormat({
    block,
    edit: textEdit?.blockId === block.id ? textEdit : null,
  })
  const formatDisabled = !selectionFormat.canApplyInlineStyle
  const formatScopeTitle = selectionFormat.mode === 'caret'
    ? '插入点格式'
    : selectionFormat.mode === 'range'
      ? '选区格式'
      : '整块格式'
  const formatScopeHint = selectionFormat.mode === 'caret'
    ? selectionFormat.hasPendingStyle
      ? '当前已设置待输入格式；它只应用于随后输入的文字。'
      : '当前显示插入点格式；修改会成为待输入格式，只应用于随后输入的文字。'
    : selectionFormat.mode === 'range'
      ? selectionFormat.hasMixedValue
        ? '选区包含混合格式；修改会统一所选文字。'
        : '修改只应用到当前选中的文字。'
      : '未进入文字选区；修改会应用到整个文字块。'
  const fontFamilyField = selectionFormat.fields.fontFamily
  const fontSizeField = selectionFormat.fields.fontSize
  const colorField = selectionFormat.fields.color
  const boldField = selectionFormat.fields.bold
  const italicField = selectionFormat.fields.italic
  const boldActive = uniformFlowFormatValue(boldField) === true
  const italicActive = uniformFlowFormatValue(italicField) === true

  const patchBlockLayout = (patch: { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number }) => {
    commands.patchSelectedBlock(patch)
  }

  return (
    <div className="properties-scroll" data-testid="properties-tab">
      <section className="property-section" data-testid="flow-block-properties">
        <h3 className="property-title"><Type size={14} />块结构</h3>
        {block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote' ? (
          <>
          <div data-testid="flow-block-type">
            <SelectField
              label="块类型"
              value={block.type === 'heading' ? `${block.level}` : block.type === 'paragraph' ? 'paragraph' : 'quote'}
              options={[
                { value: 'paragraph', label: '段落' },
                { value: 'quote', label: '引用' },
                { value: '1', label: '一级标题' },
                { value: '2', label: '二级标题' },
                { value: '3', label: '三级标题' },
                { value: '4', label: '四级标题' },
                { value: '5', label: '五级标题' },
                { value: '6', label: '六级标题' },
              ]}
              onChange={(value) => {
                if (value === 'paragraph') {
                  commands.formatBlock({ kind: 'convert-paragraph' })
                } else if (value === 'quote') {
                  commands.formatBlock({ kind: 'convert-quote' })
                } else if (value === '1' || value === '2' || value === '3' || value === '4' || value === '5' || value === '6') {
                  commands.formatBlock({
                    kind: 'convert-heading',
                    level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6,
                  })
                }
              }}
            />
          </div>
            <div data-testid="flow-block-align">
              <SelectField<'left' | 'center' | 'right'>
                label="对齐方式"
                value={('textAlign' in block && block.textAlign) ? block.textAlign : 'left'}
                options={[
                  { value: 'left', label: '左对齐' },
                  { value: 'center', label: '居中' },
                  { value: 'right', label: '右对齐' },
                ]}
                onChange={(textAlign) => patchBlockLayout({ textAlign })}
              />
            </div>
            <div data-testid="flow-block-line-spacing">
              <BufferedInput
                label="行距"
                type="number"
                min={0}
                max={200}
                value={('lineSpacing' in block && typeof block.lineSpacing === 'number') ? block.lineSpacing : ''}
                onCommit={(value) => {
                  const lineSpacing = value === '' ? undefined : Number(value)
                  patchBlockLayout({ lineSpacing })
                }}
              />
            </div>
          </>
        ) : null}
        {block.type === 'component' ? (
          <>
            <div className="property-button-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="secondary-button"
                data-testid="flow-block-move-up"
                onClick={() => commands.moveSelectedBlock('up')}
              >
                上移
              </button>
              <button
                type="button"
                className="secondary-button"
                data-testid="flow-block-move-down"
                onClick={() => commands.moveSelectedBlock('down')}
              >
                下移
              </button>
              <button
                type="button"
                className="secondary-button"
                data-testid="flow-block-to-overlay"
                onClick={() => commands.convertSelectedToOverlay()}
              >
                转为浮层
              </button>
            </div>
            <div data-testid="flow-component-wrap">
              <SelectField<'none' | 'left' | 'right'>
                label="文字环绕"
                value={block.wrap ?? 'none'}
                options={[
                  { value: 'none', label: '不环绕（独占一行）' },
                  { value: 'left', label: '居左环绕' },
                  { value: 'right', label: '居右环绕' },
                ]}
                onChange={(wrap) => commands.patchSelectedBlock({ wrap })}
              />
            </div>
          </>
        ) : null}
        {block.type === 'list' ? (
          <ToggleRow
            label="有序列表"
            checked={block.ordered}
            onChange={(ordered) => commands.formatBlock({ kind: 'list-ordered', ordered })}
          />
        ) : null}
        {block.type === 'media' || block.type === 'formula' ? null : (
          <p className="property-hint">改正文请在稿纸里双击就地编辑，不要在这里整段替换。</p>
        )}
      </section>
      {block.type === 'media' ? (
        <FlowMediaBlockProperties context={context} block={block} />
      ) : null}
      {block.type === 'formula' ? (
        <FlowFormulaBlockProperties context={context} block={block} />
      ) : null}
      {selectionFormat.richText ? (
        <section
          className="property-section"
          data-testid="flow-selection-format-properties"
          data-flow-selection-preserving-target="true"
          data-flow-format-mode={selectionFormat.mode}
          data-format-state={selectionFormat.hasMixedValue ? 'mixed' : 'resolved'}
        >
          <h3 className="property-title" data-testid="flow-selection-format-title">
            <Type size={14} />{formatScopeTitle}
          </h3>
          <p className="property-hint" data-testid="flow-selection-format-hint">
            {formatScopeHint}
          </p>
          <fieldset
            disabled={formatDisabled}
            title={formatDisabled ? '选择文字后应用' : undefined}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div
              data-testid="flow-font-family-state"
              data-format-state={fontFamilyField.state}
              aria-label={flowFormatFieldDescription('字体', fontFamilyField)}
            >
              <FontFamilyPicker
                key={`flow-font-family:${context.draftBindingKey}`}
                value={uniformFlowFormatValue(fontFamilyField) ?? ''}
                placeholder={fontFamilyField.state === 'mixed' ? '混合字体' : '默认字体'}
                onCommit={(fontFamily) => commands.formatTextStyle({ fontFamily })}
              />
            </div>
            <div
              data-testid="flow-font-size"
              data-format-state={fontSizeField.state}
              aria-label={flowFormatFieldDescription('字号', fontSizeField)}
            >
              <BufferedInput
                label="字号"
                type="number"
                min={8}
                max={400}
                value={uniformFlowFormatValue(fontSizeField) ?? ''}
                placeholder={fontSizeField.state === 'mixed' ? '混合' : '默认'}
                onCommit={(value) => {
                  const fontSize = value === '' ? undefined : Number(value)
                  commands.formatTextStyle({ fontSize })
                }}
              />
            </div>
            <div className="property-button-row">
              <button
                type="button"
                className={`secondary-button${boldActive ? ' secondary-button--active' : ''}`}
                data-testid="flow-format-bold"
                data-format-state={boldField.state}
                aria-pressed={boldField.state === 'mixed' ? 'mixed' : boldActive}
                title={flowFormatFieldDescription('粗体', boldField)}
                onClick={() => commands.formatTextStyle({ bold: !boldActive })}
              >
                <Bold size={14} />粗体
              </button>
              <button
                type="button"
                className={`secondary-button${italicActive ? ' secondary-button--active' : ''}`}
                data-testid="flow-format-italic"
                data-format-state={italicField.state}
                aria-pressed={italicField.state === 'mixed' ? 'mixed' : italicActive}
                title={flowFormatFieldDescription('斜体', italicField)}
                onClick={() => commands.formatTextStyle({ italic: !italicActive })}
              >
                <Italic size={14} />斜体
              </button>
            </div>
            <div
              data-testid="flow-text-color-state"
              data-format-state={colorField.state}
              aria-label={flowFormatFieldDescription('文字颜色', colorField)}
            >
              <ColorInput
                key={`flow-text-color:${context.draftBindingKey}`}
                id="flow-text-color"
                label="文字颜色"
                value={uniformFlowFormatValue(colorField) ?? FLOW_PAPER_TEXT_COLOR}
                onChange={(color) => commands.formatTextStyle({ color })}
              />
            </div>
          </fieldset>
        </section>
      ) : null}
    </div>
  )
}

function FlowOverlayProperties({ context }: { context: FlowPropertiesContext }) {
  const { view, selection, commands } = context
  const fileInputRef = useRef<HTMLInputElement>(null)
  const overlayId = selection.selectedOverlayIds.at(-1)
  if (!overlayId) return null
  const layer = view.overlayLayers.find((entry) => entry.selectionId === overlayId)
  if (!layer) return null
  const item = layer.item as LayerItem
  const node = propertiesViewFromLayerItem(item)

  const update = (patch: PropertiesPatch) => {
    const normalized = normalizePropertiesPatch(node, patch)
    commands.patchOverlayProperties(normalized)
  }

  const paperSpaceField = item.kind === 'native' && item.content.nativeType === 'teacher-controller'
    ? null
    : (
      <div data-testid="flow-overlay-paper-space">
        <SelectField<'viewport' | 'paper'>
          label="定位空间"
          value={item.paperSpace === 'paper' ? 'paper' : 'viewport'}
          options={[
            { value: 'viewport', label: '钉在视口' },
            { value: 'paper', label: '跟随稿纸滚动' },
          ]}
          onChange={(paperSpace) => commands.patchOverlayPaperSpace(paperSpace)}
        />
      </div>
    )

  const textDraftRef = useRef<string | null>(null)
  const textCommands: SlideNativeTextCommands = {
    beginEdit: () => {},
    commitEdit: () => {
      if (textDraftRef.current !== null && textDraftRef.current !== (node as TextNode).text) {
        update({ text: textDraftRef.current })
        textDraftRef.current = null
      }
    },
    cancelEdit: () => {
      textDraftRef.current = null
    },
    setComposing: () => {},
    updateDraft: (text: string) => {
      textDraftRef.current = text
    },
    toggleStyle: (key, range) => {
      const textNode = node as TextNode
      if (range.start !== range.end) {
        const runs = applyTextRunStyle(
          textNode.text,
          textNode.runs ?? [],
          range.start,
          range.end,
          { [key]: !textNode.style[key] },
        )
        update({ runs })
      } else {
        update({ style: { [key]: !textNode.style[key] } })
      }
    },
  }

  const onFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await commands.importReplacementMedia({
      name: file.name,
      mimeType: file.type || 'image/png',
      bytes,
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="properties-scroll" data-testid="properties-tab">
      <CommonNodeProperties
        node={node}
        editorMode="simple"
        update={update}
      />
      {paperSpaceField && (
        <section className="property-section" data-testid="flow-overlay-space-section">
          <h3 className="property-title">排版定位</h3>
          {paperSpaceField}
        </section>
      )}
      {node.type === 'shape' && (
        <SharedShapeProperties
          node={node as ShapeNode}
          update={update}
        />
      )}
      {node.type === 'text' && (
        <TextProperties
          node={node as TextNode}
          update={update}
          contentEditingEnabled
          textCommands={textCommands}
        />
      )}
      {node.type === 'image' && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFileInputChange}
          />
          <ImageProperties
            node={node as ImageNode}
            update={update}
            onReplaceImage={() => fileInputRef.current?.click()}
          />
          <section className="property-section" data-testid="flow-overlay-media-properties">
            <button
              type="button"
              className="secondary-button"
              data-testid="flow-overlay-to-document"
              style={{ width: '100%' }}
              onClick={() => commands.convertOverlayToDocument()}
            >
              转回正文
            </button>
          </section>
        </>
      )}
      {node.type === 'video' && (
        <>
          <VideoProperties
            node={node as VideoNode}
            update={update}
          />
          <section className="property-section" data-testid="flow-overlay-media-properties">
            <button
              type="button"
              className="secondary-button"
              data-testid="flow-overlay-to-document"
              style={{ width: '100%' }}
              onClick={() => commands.convertOverlayToDocument()}
            >
              转回正文
            </button>
          </section>
        </>
      )}
      {node.type === 'formula' && (
        <section className="property-section" data-testid="flow-formula-properties">
          <h3 className="property-title">公式</h3>
          <FormulaAuthoringEditor
            key={`flow-overlay-formula:${context.draftBindingKey}`}
            node={node as FormulaNode}
            onCommit={(committedAst, committedAccessibleText) => {
              commands.commitOverlayFormula(committedAst, committedAccessibleText)
            }}
          />
        </section>
      )}
      {item.kind === 'component' && (
        <section className="property-section" data-testid="flow-overlay-component-properties">
          <h3 className="property-title">浮层组件</h3>
          <button
            type="button"
            className="secondary-button"
            data-testid="flow-overlay-to-document"
            onClick={() => commands.convertOverlayToDocument()}
          >
            转回正文
          </button>
        </section>
      )}
    </div>
  )
}

export function FlowPropertiesPanel({ context }: { context: FlowPropertiesContext }) {
  const panel = context.kind === 'flow-overlay'
    ? <FlowOverlayProperties context={context} />
    : context.kind === 'flow-page'
      ? (
          <div className="properties-scroll" data-testid="properties-tab">
            <FlowPageProperties context={context} />
          </div>
        )
      : <FlowBlockProperties context={context} />
  return (
    <PropertyDraftBoundary
      bindingKey={context.draftBindingKey}
      onStale={() => context.commands.reportError(
        '属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。',
      )}
    >
      {panel}
    </PropertyDraftBoundary>
  )
}
