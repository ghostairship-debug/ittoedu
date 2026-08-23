# ARCH-0A：治理、合法 V9 基线与事实重算

本阶段与 ARCH-0B 并行，只允许治理文档、测试/基线资产、只读盘点和基线脚本修复；不改变产品行为。

## 1. GOV-00 激活稳定化

根入口必须明确：稳定化已激活；V9 软冻结、Skill 路由、教师 `accepted` 状态和历史已完成任务继续有效；本计划不自动扩张产品能力。

## 2. BSL-00 干净基线

记录 HEAD、工作树、Node/npm/OS、合同与能力检查的当前状态，并建立可恢复的阶段起点。基线失败分为：

- `blocking`：影响本阶段目标，先修或停止；
- `known-unrelated`：有可复现证据，登记后继续；
- `flaky`：原命令重跑一次，仍随机则隔离；
- `unknown`：不得直接进入广泛施工。

## 3. 三份代表工程

必须是可由当前编辑器读取的合法 Course Project V9，不得使用被当前产品拒绝的 V8 示例：

| Fixture | 必须覆盖 | 记录 |
|---|---|---|
| Slide-heavy | 场景状态、图层、媒体、组件、播放、静态导出 | path/hash/build command |
| Flow-heavy | 文档块、公式/表格/代码、IME、FlowComponentBlock、DOCX/PDF 适用流程 | path/hash/build command |
| Mixed/Spatial | 三 Surface、全局/共享层、控制器、世界相机/路径、组件/Runtime | path/hash/build command |

真实用户文件只在副本上验证，不作为可修改 fixture。

## 4. 产品与性能基线

至少记录：新建/打开、保存/另存/重开、undo/redo、切 location、拖拽提交、Flow IME、Preview mount/destroy、HTML/Web/PPTX/PDF/DOCX 适用范围、大型 Mixed 打开与 history 内存观察。

每项写明环境、样本次数、median/P95 或明确的定性口径。后续“无显著退化”必须引用这里的口径。

## 5. FACT-00 与 MAP-00

建立唯一的 Feature/consumer/owner 台账，字段：

```text
Feature
current status
canonical contract/carrier
writers
runtime/preview/export consumers
build/fixture/release consumers
tests
hotspot owner
legacy replacement
delete gate
```

每项标记 `existing/preserve`、`partial`、`missing` 或 `legacy-consumer`。只登记可复现事实，不把目标愿景写成现状。

## 6. 并行派工

- Worker A：三份代表工程与人工流程；
- Worker B：writer/consumer/owner 盘点；
- Worker C：测试地图、性能采样与基线证据；
- Coordinator：治理激活、热点 Owner 和回滚点。

四者不得修改产品热点。

## 7. 退出条件

- 治理入口清楚且没有两份“当前主线”；
- 工作树与用户差异已登记；
- 三份合法 V9 代表工程可重复获得；
- blocking/known/flaky 状态清楚；
- writer/consumer/owner 起始计数完整；
- 性能比较口径固定；
- ARCH-1 可据此生成一组可派发任务卡。
