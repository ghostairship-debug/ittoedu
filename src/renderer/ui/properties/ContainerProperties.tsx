import type { ComponentContainerAuthoring, ComponentFlowAuthoring, ComponentSpatialPose } from '../../../shared/contracts/component-platform/project'
import type { PropertiesItemBase, PropertiesPatch } from './SlideNativePropertiesPanel'
import { BufferedInput, SelectField, ToggleRow } from './PropertyControls'

export type PropertiesContainerView = PropertiesItemBase & {
  type: 'container'
  container: ComponentContainerAuthoring
}

/** These controls edit existing business configuration, independently of the outer frame. */
export interface ContainerPropertiesPatch {
  designSize?: { width?: number; height?: number }
  flow?: { layout: Partial<ComponentFlowAuthoring['layout']> }
  spatial?: { home?: Partial<ComponentSpatialPose>; defaultPathId?: string | null }
}

export function ContainerProperties({ node, update }: {
  node: PropertiesContainerView
  update(patch: PropertiesPatch): void | Promise<void>
}) {
  const container = node.container
  const layout = container.flow?.layout ?? { readingWidth: 860, wideContentWidth: 1100 }
  const home = container.spatial?.home ?? { x: 0, y: 0, zoom: 1 }
  const titles = { slide: '演示容器', flow: '阅读容器', spatial: '空间容器' }
  return <section className="property-section" data-testid="container-properties">
    <h3 className="property-title">{titles[container.kind]}</h3>
    {container.kind === 'slide' && <>
      {container.designSize ? <div className="coordinate-grid">
        <BufferedInput label="设计画幅宽" type="number" min={1} value={container.designSize.width}
          onCommit={value => update({ container: { designSize: { width: Number(value) } } })} />
        <BufferedInput label="设计画幅高" type="number" min={1} value={container.designSize.height}
          onCommit={value => update({ container: { designSize: { height: Number(value) } } })} />
      </div> : <button type="button" className="secondary-button"
        onClick={() => update({ container: { designSize: { width: 1280, height: 720 } } })}>设置设计画幅（1280 × 720）</button>}
      <p className="property-hint">设计画幅决定内部内容的坐标与比例；外框宽高决定它在父级中的显示区域。</p>
    </>}
    {container.kind === 'flow' && <>
      <SelectField label="阅读宽度模式" value={layout.widthMode ?? 'reading'}
        options={[{ value: 'reading', label: '阅读模式' }, { value: 'fluid', label: '填满可用宽度' }]}
        onChange={widthMode => update({ container: { flow: { layout: { widthMode } } } })} />
      <BufferedInput label="阅读宽度" type="number" min={1} value={layout.readingWidth}
        onCommit={value => update({ container: { flow: { layout: { readingWidth: Number(value) } } } })} />
      <BufferedInput label="宽幅内容宽度" type="number" min={1} value={layout.wideContentWidth}
        onCommit={value => update({ container: { flow: { layout: { wideContentWidth: Number(value) } } } })} />
      <SelectField label="标题目录" value={layout.toc ?? 'auto'}
        options={[{ value: 'auto', label: '显示独立目录' }, { value: 'hidden', label: '隐藏（使用作品自带目录）' }]}
        onChange={toc => update({ container: { flow: { layout: { toc } } } })} />
      <ToggleRow label="内容铺满边缘" checked={layout.edgeToEdge === true}
        onChange={edgeToEdge => update({ container: { flow: { layout: { edgeToEdge } } } })} />
      <p className="property-hint">正文在父级分配的宽度内重排。阅读配置不改变外框尺寸，也不改变内部内容顺序。</p>
    </>}
    {container.kind === 'spatial' && <>
      <div className="coordinate-grid">
        <BufferedInput label="初始镜头 X" type="number" value={home.x}
          onCommit={value => update({ container: { spatial: { home: { x: Number(value) } } } })} />
        <BufferedInput label="初始镜头 Y" type="number" value={home.y}
          onCommit={value => update({ container: { spatial: { home: { y: Number(value) } } } })} />
      </div>
      <BufferedInput label="初始镜头缩放" type="number" min={0.01} step={0.1} value={home.zoom}
        onCommit={value => update({ container: { spatial: { home: { zoom: Number(value) } } } })} />
      <BufferedInput label="初始镜头旋转" type="number" step={1} value={home.rotation ?? 0}
        onCommit={value => update({ container: { spatial: { home: { rotation: Number(value) } } } })} />
      {Boolean(container.spatial?.paths?.length) && <SelectField label="默认播放路线" value={container.spatial?.defaultPathId ?? ''}
        options={[{ value: '', label: '按镜头顺序' }, ...container.spatial!.paths!.map(path => ({ value: path.id, label: path.title ?? path.id }))]}
        onChange={defaultPathId => update({ container: { spatial: { defaultPathId: defaultPathId || null } } })} />}
      <p className="property-hint">初始镜头使用世界坐标；镜头、路线和空间内容可进入容器继续编辑。</p>
    </>}
  </section>
}
