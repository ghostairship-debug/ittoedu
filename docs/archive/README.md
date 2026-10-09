# 归档入口

归档只从这里进入，不再按内部/外部作者或每一轮整理创建重复目录。

| 仍需保留的依据 | 用途 |
|---|---|
| [2.0 历史收敛方案](2.0-历史收敛方案.md) | 原 Owner 决定与旧验收范围，不能当当前实施清单 |
| [20261006 统一修复执行依据](20261006-统一修复执行依据.md) | L/M/R1–R6 已实施任务的原范围、撤回项和必要保留行为 |
| [前轮修复结果](20261006-前轮修复结果.md) | 本批之前的有效成果与证据边界 |
| [native 与存量诊断依据](20261006-native与存量诊断依据.md) | 尚未完全验证的 native 根因及存量维护依据 |

当前结果读[CURRENT_STATUS](../development-plan/CURRENT_STATUS.md)及[唯一结果](../development-plan/20261008-core-experience-unified/REVIEW_RESULT.md#brand-release-cleanup-20261009)，不重新派发归档方案。

## 磁盘原始材料

统一根目录为 **`D:/果铃工作台/docs/archive/local`**：

归档现已位于仓库目录内；`local/` 保存本机原始材料并由 `.gitignore` 排除，不把恢复 profile、课件样本及大型原始记录混入远端源码提交。

- `evidence/`：各批真实检查、截图、失败记录与性能采样，目录名称保留原日期。
- `evidence/20261007-product-audit/`：桌面审计20份原输入、两轮收敛报告及641/131证据记录的本机副本，原件未修改；当前执行及逐条覆盖见[20261007 执行包](../development-plan/20261007-content-revision/README.md)。
- `materials/`：原课件样本、恢复稿和测试 profile；不能作为无效文档删除。
- `20261006-main-consolidation/`：工作树保全映射、未提交材料与原始辅助数据。`preservation.json`/Git archive refs 负责恢复；不再在仓库重复保存这些快照。
- `retired-workspaces/`：D 盘旧开发区的独有源码、补丁与记录。原映射见 `manifest.json`；本轮恢复索引如下。普通缓存可再生，真实冻结验收载体的运行依赖与制品完整压缩保留。

原 `D:/果铃恢复候选` 已收拢到上述根，现行报告链接已更新。源码、作品、资源和有效失败证据不因目录精简改写。

一次性工作流精简输入现保存在 `local/materials/workflow-simplification-20261008/`，原路径映射见其中 `manifest.json`；当前规则与实施事实已有正式入口承接，历史提示词不再作为启动入口。

### 本机压缩材料的恢复

以下均位于 `local/retired-workspaces/`，只提供恢复导航；实际清理与未完成项统一见上面的唯一结果。

| 原材料 | 保存位置与恢复依据 |
|---|---|
| 原三份 D 盘工作区 ZIP | `compressed/<原名>.zip.7z`；`compression-20261009.json` 对应原 ZIP 的完整字节和原路径。先解出内层 ZIP，再使用原 `manifest.json` |
| `D:/果铃并行/20261007-content-revision` 的 30 个注册工作树 | `d-parallel-20261009.json` 保存原路径、分支与 HEAD；这些分支保留在主仓库。用原分支重新创建工作树，解出 `d-content-revision-20261007-extras.7z`；Git 长路径删除中断时的原文件另在 `d-content-revision-e-residual.7z` |
| `D:/果铃并行/20261007-core-experience-01a115f1` 的八份候选 | `d-core-experience-20261007-candidates.7z` 与同名 JSON，包含全部源码、补丁与原记录。JSON 的 `links` 记录依赖连接，解压不自动遍历或恢复连接 |
| 九份旧 Electron 包、两份冻结验收载体及 hygiene 原 ZIP | `historical-runtimes-20261009.7z` 与同名 JSON；按仓库相对路径完整解出。截图、作品、profile 和外围报告仍在原证据目录 |

使用现有 7-Zip 的 `x <压缩文件> -o<原根目录>` 解出文件；先确认目标为空或已单独保全。恢复工作树时仅重建记录中的 `node_modules` 连接，禁止对连接递归删除。大型材料仍由 `.gitignore` 排除，不纳入远端源码。

## 历史原文

旧方案、外部评估、原始审计正文、旧任务卡、旧导航/协议快照及重复索引共 **237 份**，已有统一方案、当前状态或结果承接，已从当前文件树移除；不另建“归档的归档”。需要精确追溯时从整理前提交 `917ad383` 读取：

```powershell
git show "917ad383:docs/archive/<原相对路径>"
```

原路径可用 `git ls-tree -r --name-only 917ad383 -- docs/archive` 查询。这些旧原文只解释当时结论，不是当前调用者、授权或待修清单。清理不把旧未签收改为通过；类型债、native 不确定性和作品质量边界仍保留在当前状态。
