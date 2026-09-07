# 1.8 场景与步骤导航分层（U12 / R10）

Owner 2026-09-07确认：步负责场景内部播放次序，场景只负责场景跳转。本文件为新增必选工作包，085–087已实施，工程证据见[导航结束记录](../../reviews/1.8-navigation-level-exit.md)；不撤销r18-083已有有限工程证据，也不提前宣布1.8完成。

## 当前根因与产品结果

`publishedControllerNavigationTarget`、`PublishedInteractionCourseSession.#nextScene`把scene.next直接映射为下一个location；location混合了Slide页、Flow block和Spatial camera。`publishedCoursePresenter.ts`的普通导航与authored-command回调也都按location index加减。控制器正式动作集没有独立步进分支。因此不是两个按钮文案相似，而是不同推进层级共用同一位置序列。以上为实施前源码根因；新增语义已完成真实Electron与离线HTML验证。

| 表面 | 场景单元 | 场景内步骤 |
| --- | --- | --- |
| Slide | 一张演示页/scene | 作者明确编排的呈现状态、逐次显示或动作；不把所有动画帧都当一步 |
| Flow | 一份讲义/Flow surface | 作者明确编排的讲解步骤或锚点；不自动把每个段落变成步骤 |
| Spatial | 一张无限画布/Spatial surface | 作者编排的镜头及已有可推进演示动作；同一画布切镜头不算切场景 |

- 上/下一步按整课编排连续推进：下一步越过当前末步进入下一场景首步，上一步越过当前首步返回上一场景末步；只有整课首尾停留并禁用对应方向。上一/下一场景是直接跳过当前剩余步骤的快捷操作，进入目标场景定义的起始步骤；两者在边界处结果相同是预期行为，场景内部不能每按一次下一场景只移动一个镜头。零显式步骤的场景保留其初始呈现作为一次可停留位置，继续按步即可跨场景，不插入虚假动画步骤；整课单场景/空步骤也不能循环跳转。
- 场景目录以场景为主层级，镜头/锚点可作为明确标注的场景内步骤展开；场景总数、当前位置、步数各自准确。课程中返回同一画布的合法顺序不能被按surfaceId全局去重而丢失；在r18-085根据已有locations顺序定义场景出现段与重复进入规则。
- 重播当前场景与恢复观察视图分开：前者回到该场景起始步骤，并按原有重播合同重置适用状态；后者只复位zoom/pan，不改变步骤、world camera、答案或实例进度。普通镜头/锚点步进保留已有同surface实例生命周期，不用重建整个宿主实现移动。
- 控制器的手动跳转/临时越过权限保持原合同；普通步进、课程主交互和翻页笔不能借用控制器的guard bypass。全局控制器是便捷入口，不成为课程唯一推进器。
- 控制器按钮、翻页笔/键盘、课程显式交互、Runtime/Component导航接口、目录及试运行/预览/离线HTML消费同一语义owner。输入框/IME和动态实例内部优先规则保持；观察缩放仍走r18-077独立临时port。

## 正式工作包与依赖

### 085实施合同（Owner本轮已授权执行）

- 唯一只读投影为`player/navigation/coursePlaybackSequence.ts`。按locations顺序生成连续出现段：Slide以surfaceId+sceneId分组，Flow/Spatial以surfaceId分组，非连续返回另起段；段ID使用首location ID。Slide未指定stateId的位置按initialStateId首位、其余states数组顺序展开；精确stateId位置仅占一个步骤，同scene多个location不去重。显式位置被Runtime切到另一状态时仍按该location的编排位置推进，真实状态继续归Slide host，不能另存stepIndex。
- 新增`step.next`/`step.previous`为TeacherControllerAction与InteractionAction的两个无额外字段strict动作分支。Course V9与Published V2复用同一Native/Interaction分支，旧工程继续读取；旧reader缺少新discriminator时明确拒绝新动作，不能剥离为旧scene.next。无新文档字段、无新版本号，当前只完成独立合同diff及对应消费者，不创建未经要求的Git提交。
- 既有`scene.next`/`scene.previous`按Owner决定纠正为相邻场景出现段，所有入口一起迁移；`scene.go`/location ID/deep link以及listCatalog/getProgress/goToIndex的内部location索引保持精确语义，不能用scene索引替换捕获接口。
- Runtime/Component增加可选nextStep/previousStep宿主方法，旧宿主须先feature-detect；既有nextScene/previousScene消费场景投影。未改变源码信任或宿主权限。
- 步进边界按用户最新确认自动跨场景；场景快捷跳转到目标段首步；重播回当前段首步并执行原有重播生命周期，保留课程global重置边界。Presenter authored-command只执行明确且条件满足的规则，无规则不fallback。

### r18-085-navigation-level-contract

- 依赖：r18-083-surface-integration-exit。Owner：Navigation Contract；写域/锁：contracts-schema。
- 结果：锁定场景/步骤投影、步骤排序与可逆范围、跨场景边界行为、重复进入、精确深链、replay范围、旧按钮/action/API映射和键盘策略；形成明确输入输出的窄port及兼容表。优先利用已有V9 locations、Slide呈现/交互、Flow锚点、Spatial镜头顺序，不另建第二持久课程序列。
- 必读producer/consumer：native-v1 TeacherControllerAction、interaction-v1 scene动作、Runtime API2/3与Component API4导航、PublishedCourseV2 locations、MixedCourseNavigator、publishedCoursePresenter、PlayerPresenterInput、teacherControllerLayout、控制器属性和现有ScenePicker。保留精确location ID与外部deep link；不得把深链或捕获index偷偷重新解释成场景index。
- 如独立步进需新增持久动作分支，先在本包明确V9/Published strict分支、旧工程读取、旧reader明确失败及既有动作的兼容政策，按架构合同独立处理；不得把新语义藏在按钮label，亦不得无合同改动既有Runtime/Component公开API。当前产品决定不等于已经完成wire合同。
- 验证/停止：基于实际V9混合夹具列出单步、多步、零步、非连续返回同surface、指定镜头深链及旧控制器的期望序列，解析和边界检查足以锁定合同即停；不建设通用时间线/新动画系统。

### r18-086-navigation-level-implementation

- 依赖：r18-085-navigation-level-contract。Owner：Player Navigation；锁：published-dynamic、published-interaction、published-slide、published-flow、published-spatial、props-global、workspace-shell。
- 写域：一个导航语义owner及MixedCourseNavigator/Published session窄适配；三host步骤能力、控制器动作/目录/属性、publishedCoursePresenter/PlayerPresenterInput、必要的现有producer/tool consumer与直接测试。Core/History仅在合同指出直接必要性时协调，不新建Store。
- 结果：真正区分step与scene请求、状态和可用性；删除各入口用location index加减冒充scene/step的私有算法。保留精确location导航作为内部底层能力，场景/步骤投影只由唯一owner产生。Runtime/Component显式跳转及翻页笔authored-command按合同接线，不能无规则时静默翻场景。
- 验证：目标导航/控制器/Presenter测试证明首尾、场景跳过剩余镜头、重复进入、guard及失败零导航；一份真实Mixed课件在当前位置试运行、整课预览与离线HTML中按同一序列运行，保存重开后编排不变。同画布镜头变化保持适用Component/Runtime实例与答案，观察缩放不修改任何步骤。
- 停止：合同与直接consumer全部一致、旧重合路径退出即结束。不能仅修改label或把旧测试期望改为新的错误序列。

### r18-087-navigation-level-exit

- 依赖：r18-086-navigation-level-implementation。Owner：Integration/Delivery；锁：generated-index。
- 结果：补齐新增U12工程结束证据与S3清单，保留r18-083已通过范围；r18-060新增等待本节点，1.9–2.0沿S3依赖继续等待。Codex外部阻断不阻止本包实施。
- 验证：复用各包证据，只补Mixed真实“步→步→场景→返回→重播→恢复视图”纵切，包含Spatial至少三镜头、Flow至少两明确锚点和Slide至少两呈现步骤；同时检查目录计数、全局控制器保留、保存重开、键盘与动态输入归属。类型、受影响测试和必要构建按工作协议执行，不重复收费CLI或完整历史矩阵。
- 不包含：S3签署、发布、真实数据迁移、任意脚本动作的自动逆执行。无可逆语义的已有效果按合同处理，不虚构通用Undo。

## 执行边界

Owner后续明确授权执行；085–087现已完成，证据见导航结束记录。实施顺序为085→086→087；合同先行，唯一导航writer。可在085之后将只读反例检查与独立测试准备并行，不能让多个执行者同时改navigator/session。最终证据须同时回填S3及新增工程结束门，不能因此前r18-083结束而漏验U12。
