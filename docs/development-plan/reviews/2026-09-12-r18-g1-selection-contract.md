# 1.8 G1 选区动作窄合同

GenerationRequest V1 增加可选 strict `selectionActions`，旧请求缺字段保持可读；不修改 Course Project V9。该字段只由宿主根据原指令与真实选区捕获，不由 candidate 提供，也不把选区提升为整页权限。

- `reorder`：绑定当前请求已有的精确 LayerItem update target。`layer.edit` 仅移动该对象在同 owner/plane 内的次序，保留其身份和内容；Slide scene 命名态沿正式状态顺序命令。
- `duplicate`：绑定相同 update target，只沿正式复制命令生成一个同 owner/plane 的副本，保留源对象；命名态复制沿现有 Slide 命令，不修改基础态或其他状态的呈现。
- `insert-image-after`：仅明确“在选中说明后插图”且有唯一正文/文字锚点时提供。新增 destination 原样加入当前 request，绑定锚点同 owner/parent 的 after insertion；只准一张图片及其被消费的素材，不准任意对象、页面、owner 或额外未消费新增。

候选使用既有工具、资源准备、canonical transaction 和唯一 History。新的动作不放松旧替换、stale、Stop、资源闭包、跨 owner/plane 和失败零写入规则。Main 初始提示/暂存完整请求保持该字段；公开发现与执行来自同一工具定义。

本合同提交仅定义输入和兼容反例，不表示 consumer 或真实用户验收完成。
