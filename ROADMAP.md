# 路线图

本文回答"果铃工作台走到哪一步、下一步是什么"。详细里程碑时间线见 [CHANGELOG.md](CHANGELOG.md);权威状态以 `task_registry.json` + `acceptance_cases.json` 同源 JSON 为准。

## 2.0 当前状态(2026-10-02,已收官)

- 全部 44 个 S/M 任务 `verified`(100%)。
- 241 项验收用例:**232 passed / 9 not_run**(延期项不计入 2.0 完成门)。
- M30-T08 Owner 终局签收已落盘,扩展 2.0 范围(M25–M30 / B19–B24 / 30 项新增验收)整体闭合。
- 自动化最多证 `engineering candidate`;最终 accepted 由 Owner 实际验收决定。

## 既定延期的 9 项 not_run

### 发行准备 `release-preparation`(4 项)

| 用例 | 内容 |
|---|---|
| M12-T01 | 无 CLI 的安装包首次使用 |
| M12-T04 | 重装卸载与用户文件保留 |
| REL-T08 | 分发包资产与许可 |
| REL-T10 | 发布前范围核对 |

属正式发行阶段动作,发行前由 Owner 单独签收。

### 媒体/委派跟进 `media-followup`(5 项)

| 用例 | 内容 |
|---|---|
| M29-T03 | 首个语音或视频闭环(供应商与账号未定) |
| M29-T04 | 单执行器有限委派(完整父模型续接组合) |
| M30-T05 | T2 多资料研究压缩续接(部分组合未运行) |
| M30-T06 | T3 独立图像交互 HTML(账号/权限边界) |
| M30-T07 | T4 外部工具异步继续 |

既定权限/账号边界的决策层延期,不进入当前 2.0 完成门,不新增采购或索要凭据。

## 下一步:2.1 阶段

Owner 签收后的下一阶段方向(不绑定时间):

1. **Release preparation**:上述 4 项发行准备用例的发行前闭环(安装/卸载/资产/范围核对)。
2. **Media follow-up**:真实语音/视频生成闭环、媒体最小框架补完(供应商与账号确定后)。
3. **ACP/委派**:单执行器有限委派续接、外部工具异步组合的真实账号边界验收。
4. **UI/UX 治理**:R3 之后的美学与 rework,由 Owner 单独定优先级与范围。

## 长期方向(不进 2.0/2.1 完成门)

`GPTpro方案/guoling_2_0_execution_plan/long_term/` 中仍在研究期的路线:

- [L02 多格式路线](GPTpro方案/guoling_2_0_execution_plan/long_term/L02.md):原格式保真、有限编辑与可视化共编
- [L03 自有执行器路线](GPTpro方案/guoling_2_0_execution_plan/long_term/L03.md):2.0 基线后续演进
- [L04 全画布实时共创](GPTpro方案/guoling_2_0_execution_plan/long_term/L04.md):过程可见、可干预与协作边界
- [L05 长尾能力与平台边界](GPTpro方案/guoling_2_0_execution_plan/long_term/L05.md):布局、性能、连接器与扩展生态

未排入当前登记与 DAG,不视为承诺的实现节点。
