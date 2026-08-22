# 术语表

| 术语 | 含义 |
|---|---|
| Canonical Document | 当前唯一可写的 `CourseProjectDocument` |
| Projection | 从 canonical document 派生的只读形状 |
| ActiveEditor | 当前 Surface、location、scope 和 selection 的联合状态 |
| Feature | 纵向产品能力，如 Components、Media、Diagnostics |
| Surface | Slide、Flow、Spatial 编辑与展示表面 |
| Facade | Feature 对外的窄公共入口，不是复杂服务层 |
| Sidecar | 工程 JSON 之外的素材或组件二进制 |
| Binary Delta | history 中二进制 add/remove/replace 变化 |
| Catalog | 可发现的组件清单 |
| Installed Package | 已进入当前工程的组件包 |
| Component Instance | Surface 上具体组件图层 |
| Component Authoring | 修改组件 Manifest/Runtime/Schema |
| Runtime | 自定义动态运行实现 |
| Interaction Rule | 触发器、条件和动作组成的声明式规则 |
| Published Producer | 从作者工程生成 Published Course V2 的唯一转换链 |
| Context Pack | 针对一个开发任务生成的小型 AI 阅读包 |
| Semantic Index | 人工维护的 Feature/模块/不变量元数据 |
| Generated Graph | 从源码自动生成的文件、符号、依赖和测试图 |
| Legacy Read Adapter | 迁移期保留的只读旧形状适配器 |
| File Firewall | 一张任务卡允许、只读和禁止修改的文件范围 |
| Phase Validation | 每个阶段结束执行的一次集成验证 |
