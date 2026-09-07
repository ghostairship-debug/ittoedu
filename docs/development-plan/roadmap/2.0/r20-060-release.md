# r20-060-release：发布 v2.0.0 内部源码标签与固定课例离线 HTML

- Release: 2.0
- Dependencies: `r20-050-owner-acceptance`
- Optional: 否
- Write locks: `none`

## 结果与现状

发布S4已签署的同一v2.0.0内部源码标签与固定课例离线HTML；发布物不包含AI记录/凭据，不重生成冻结HTML。

当前路线只发布源码与固定HTML，无安装器；1.8起入口默认可见不等于2.0已验收或对外发行。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/WORKING_PROTOCOL.md](../../WORKING_PROTOCOL.md)
- [docs/development-plan/ARCHITECTURE_CONTRACT.md](../../ARCHITECTURE_CONTRACT.md)
- [docs/development-plan/roadmap/README.md](../README.md)

## 允许写域与旧路径退出

经授权的源码标签/固定HTML发布与最终记录；不改产品实现或重新构建冻结制品。

## 执行步骤

1. 核对050签署、同一候选verify有效证据与发布授权；冻结之后不再运行会重生成HTML的verify/build流程。
2. 断网打开已签署identity的固定HTML，扫描工程/Published/HTML不含消息/trace/本地材料缓存/凭据；制品身份此处属于合同，可校验bytes。
3. 确认无新增第二Store/History/catalog/writer的相关证据，复用未变检查；创建v2.0.0源码标签并发布该同一HTML。
4. 记录来源/制品身份与已声明支持边界；不发布安装器，不把内部签署宣称外部分发许可。

## 验收与可信反例

- 发布源码和HTML与050签署相同，离线运行正确、无AI记录/凭据；全部必选节点/签署门可追溯。
- 反例：发布前修代码不重验、重新生成HTML、换制品沿用identity、漏PPTX或插件门，均禁止正式发布。

## 停止条件

identity不一致或签署后代码变化则返回050复核/重新冻结，不能修改记录迎合新制品；无发布授权不创建标签/上传。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
git diff --check
```

复用050已通过verify，只对冻结制品进行身份核对、数据扫描及真实离线打开；不重复会改变它的生成命令。

## 回退与交接

交付正式源码标签、同一HTML与签署/支持边界链接，作为后续维护唯一已验收基线。
