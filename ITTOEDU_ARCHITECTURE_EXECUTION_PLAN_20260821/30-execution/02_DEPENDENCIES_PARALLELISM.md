# 依赖、并行与文件防火墙

本项目单人维护，但可能同时调用多个 AI。并行只用于文件与数据边界真正独立的工作。

---

## 1. 核心依赖图

```text
BSL/MAP
  └── IDX
       └── FAC/BOUND
            ├── APP/DIAG/COMP-UI
            └── CORE
                 ├── MODES/COMP/RUNTIME/INTERACTIONS
                 ├── SLIDE
                 ├── FLOW
                 └── SPATIAL
                      └── PLAYER/EXPORT
                           └── CLEAN/FINAL
```

---

## 2. 可以并行

### P0

- IDX 生成器；
- Feature Matrix；
- 活跃文档清理草稿。

但最终 semantic 路径校验在三者完成后统一运行。

### P1

不同 Feature facade 可以并行，只要不同时修改同一旧文件。

### P2

- App lifecycle；
- Diagnostics 分类；
- Components UI 拆分；
- 模式配置。

需要避免都改 `App.tsx`、`TopToolbar.tsx`、`RightSidebar.tsx`。

### P5

Slide、Flow、Spatial 可以并行，但：

- 不同时改 Editor Core；
- 不同时改 Workspace；
- 每个 Surface 先在自己模块中完成；
- Workspace 最后由一个整合任务接入。

---

## 3. 必须串行

- canonical document 形状；
- history；
- sidecar delta；
- Store 主入口；
- Workspace 最终路由；
- Properties 最终路由；
- Published producer；
- 清理旧 project/session。

---

## 4. 热点文件

同一时间只允许一张任务卡修改：

```text
src/renderer/store/editorStore.ts
src/renderer/App.tsx
src/renderer/ui/Workspace.tsx
src/renderer/ui/PropertiesTab.tsx
src/shared/courseProjectTypes.ts
src/shared/courseProjectSchema.ts
src/renderer/export/course/buildPublishedCourse.ts
```

---

## 5. 文件防火墙

每张任务卡写：

```text
Allowed:
- ...

Read-only:
- ...

Forbidden:
- ...
```

若任务发现必须越界：

1. 停止扩大修改；
2. 记录原因；
3. 更新任务卡或新建整合卡；
4. 不“顺手”修改热点文件。

---

## 6. 分支方式

单人维护推荐：

```text
refactor/p0-repo-index
refactor/p1-feature-facades
refactor/p3-editor-core
...
```

小工作包在阶段分支上小提交即可。多个 Agent 并行时再使用 worktree。

---

## 7. 合并方式

- 先合无行为变化的 facade；
- 再合消费者迁移；
- 最后合旧入口删除；
- 冲突按数据流解决，不机械保留两套；
- 每个阶段只有一个整合者负责热点接线。
