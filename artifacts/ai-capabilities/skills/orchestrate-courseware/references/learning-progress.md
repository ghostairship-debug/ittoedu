# 本设备学习进度

只有作品确实需要刷新、关闭后继续时才显式使用。API5 Source 从 `context.scope.progress` 取得可选端口；普通 HTML 从 `await window.courseProgressReady` 取得同一能力。支持的正式播放环境由顶层宿主持有存储，隔离内容不需要也不得自行放开 `allow-same-origin`。编辑、观察和导出截图不是正式续玩环境，端口不可用时保留正文并如实提示。

保存的值是作品自己选择的有限 JSON 快照，例如实验输入、真实结果、完成事实和继续点；不序列化 DOM、计时器、运行闭包或整份 runtime Map。存档按本设备、正式文件位置、作品身份和命名空间隔离。把导出文件移动/复制到新位置会形成独立进度；同一文件位置的同作品重新导出仍可读取原进度。作者 GLX 保存不夹带学习者记录，也不提供跨设备同步。

## 先恢复，再允许自动保存

端口为 `read(namespace, schemaVersion)`、`write(namespace, schemaVersion, value, expectedRevision)` 和 `clear(namespace, schemaVersion, expectedRevision)`。`read` 返回 `empty`、`ready` 或 `incompatible`，都带当前 `revision`；`ready` 还带版本和值。写入/清档必须携带该挂载调用者最近读到或写入确认的版本。存储拒绝、容量不足、取消、并发冲突是失败，不是空存档。

```js
const progress = await window.courseProgressReady;
const key = 'experiment-voyage';
const loaded = await progress.read(key, 1);
let revision = loaded.revision;
if (loaded.status === 'incompatible') {
  showSaveNotice('旧进度版本暂不兼容，尚未覆盖；请明确选择重新开始。');
  return;
}
if (loaded.status === 'ready') restoreMeaningfulState(loaded.value);
let tail = Promise.resolve();
function saveMeaningfulState(snapshot) {
  // 在事件发生时冻结输入；按确认顺序更新 CAS 版本，不能并发覆盖。
  const copy = structuredClone(snapshot);
  const pending = tail.then(async () => {
    const saved = await progress.write(key, 1, copy, revision);
    revision = saved.revision;
    showSaveNotice('已在本设备保存');
  });
  tail = pending.catch(error => { showSaveNotice('未保存：' + error.message); });
  return pending;
}
```

示例中的 `restoreMeaningfulState` 和 `showSaveNotice` 是作品自己的界面逻辑。HTML 不在模块顶层 `await` 一个必须等 iframe 完成加载后才接通的宿主端口；用非阻塞的异步启动函数连接后再启用交互，避免模块完成和挂载互相等待。恢复完成前不自动写默认值；读失败或版本不兼容时也不覆盖原记录。冲突时保留内存草稿，提示重新读取并由用户决定，不静默采用他窗版本重试覆盖。

明确“开始新航行/清除本次进度”时，先停止旧界面及其自动保存，取消尚未发送的旧快照，等待正在提交的操作结束，再调用 `clear` 并接收新版本。清档是带版本的独立动作，不能用 `write(undefined)` 代替。清档失败不报成功；后续新快照使用清档确认后的版本，迟到旧窗口会被拒绝。单幕重播是否清档由作品明确设计，普通运行复位不擅自清除持久存档。

只在写入确认后显示“已保存”。刷新按钮先等待必要保存；页面退出时的异步保存只能尽力而为，关键输入和完成事件应提前保存。手动备份码可作为补充，但“页面显示了一段 JSON”不等于文件已保存。

## 对应承诺做一次有效验收

在最终导出文件的稳定位置实际完成一个实验，刷新并彻底关闭浏览器后重开；确认输入/结果、相应完成或解锁事实都恢复，并能继续下一步。再验证明确重开、两个窗口冲突及另一个作品不串档。仅出现“继续”按钮、场景号恢复或存储 API 返回成功，不能代替这些消费者结果。离线可用性也应在断网状态下消费同一最终导出版本。
