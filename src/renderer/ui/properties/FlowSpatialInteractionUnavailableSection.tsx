export function FlowSpatialInteractionUnavailableSection({
  editingScopeGlobal,
  onOpenAutomation,
}: {
  editingScopeGlobal: boolean
  onOpenAutomation(): void
}) {
  return (
    <section
      className="property-section"
      data-testid="interaction-properties-unavailable"
      role="status"
    >
      <h3 className="property-title">交互</h3>
      <p className="property-hint">
        {editingScopeGlobal
          ? '当前 Flow 或 Spatial 页面不在元素属性中提供全局点击规则写入；请在“互动与动画”中使用可写的全局模板与专业字段。'
          : '当前 Flow 或 Spatial 页面没有元素级局部 Interaction carrier；这里不会创建无法保存的点击规则。'}
      </p>
      <button type="button" className="secondary-button" onClick={onOpenAutomation}>
        打开互动与动画
      </button>
    </section>
  )
}
