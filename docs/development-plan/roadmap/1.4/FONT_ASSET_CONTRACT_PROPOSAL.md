# 1.4 工程字体资产窄合同变更提案

状态：Owner 于 2026-09-06 明确批准；先提交合同与解析用例，再接通消费者。

## 需要解决的验收缺口

`r14-011-dynamic-asset-closure` 要求 Component 与 Runtime 直接引用工程图片、字体和媒体，Published / 单 HTML 包含相同 bytes 并可离线读取。当前 `courseProjectAssetMetaSchema` 与 `AssetMeta.kind` 仅接受 `image | audio | video`；`designTokens.fonts` 只有字体名称，没有 bytes 引用。现有 bundled-font embedding 是内置字体交付能力，不能证明任意工程字体的直接引用闭包。

## 提议的唯一合同增量

1. V9 资产元数据的 `kind` 增加 `font`，继续使用既有 `id / filename / mimeType / path / byteLength` 与资产 bytes sidecar；不增加第二字体文件库，不把字体伪装为图片。落实时核对到 Published V2 的资产分支仅有 `mimeType / url`，本来就能承载字体，不额外增加无消费者的 kind 字段；通过该现有严格分支交付字体 bytes。
2. 字体文件经专用导入识别为 WOFF2、WOFF、TTF 或 OTF；不进入图片、视频或音频插入分支。既有媒体消费者必须按明确 kind 分支处理，不能把所有非图片默认为音频或视频。
3. Runtime / Component 用现有 `projectAssetUrl(assetId)` / `assets.projectUrl(assetId)` 读取字体 bytes URL，通过浏览器 `FontFace` 使用。不新增宿主 API，不改变 Native 字体选择、内置字体安装或字体名称解析。
4. 静态直接引用沿现有统一资产图进入 Published 与 HTML；缺元数据或 bytes 按源代码 origin 报错。未引用字体不会被静态直接引用闭包带入。
5. V9 和 Published V2 版本号保持不变，Schema 保持 strict。旧 V9 继续可读；旧 reader 遇到 `kind: font` 明确失败，不剥离字段或降级。此增量须先形成独立合同提交，再提交消费者实现。

## 验收

- Schema 正负例：旧三种资产可读，font 有效，未知 kind 明确失败。
- 图片、音频、视频导入和导出保持正确类型；字体不会生成媒体节点。
- 固定 Component 与 Runtime 分别以字面 asset ID 创建 FontFace；真实浏览器中字体成功加载，图片和媒体同时可读。
- 保存重开与 Published 保留字体元数据及 bytes；断网打开单 HTML，字体加载成功；未引用字体缺席。
- 缺字体 bytes / 缺资产元数据使 preflight 失败，诊断定位唯一载体和源代码位置；失败工具调用不修改工程、资源或历史。

## 若不批准

不伪造字体闭包成功，也不开放依赖该硬门的动态源码工具。Owner 可明确将任意工程字体改为后续合同任务，但这同时变更 `r14-011` 的验收范围；不可由实现自行删减硬门。
