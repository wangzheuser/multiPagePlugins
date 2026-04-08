# 配置自动持久化 Design

## 背景
当前扩展把绝大多数状态写入 `chrome.storage.session`。这会导致插件被重新加载后，侧边栏配置项全部丢失，用户需要重复输入。

## 目标
让“配置项”自动持久化，并在插件重载后自动恢复；同时保持“运行态数据”仍然是临时状态，避免恢复脏流程。

## 持久化范围
持久化到 `chrome.storage.local` 的键：
- `vpsUrl`
- `customPassword`
- `mailProvider`
- `inbucketHost`
- `inbucketMailbox`
- `cfmailApiHost`
- `cfmailApiKey`
- `cfmailDomains`

不持久化、继续只保存在 `chrome.storage.session` 的键：
- `stepStatuses`
- `logs`
- `email`
- `password`
- `oauthUrl`
- `localhostUrl`
- `cfmailMailbox`
- `lastEmailTimestamp`
- `flowStartTime`
- 其他流程运行态字段

## 方案
1. 在 `background.js` 中引入“持久化配置键”常量。
2. `getState()` 同时读取 `storage.local` 和 `storage.session`，以 `session` 覆盖 `local`，保证运行态优先。
3. `setState()` 在写入 `session` 的同时，把命中的配置键同步写入 `local`。
4. `resetState()` 清空并重建 `session` 时，从 `local` 回填配置键，继续保留“重置流程但不丢配置”的行为。
5. 侧边栏把配置输入的保存时机统一改成“修改即保存”：文本输入使用 `input` 事件，选择器继续使用 `change`。

## 边界与约束
- 不引入新的存储层抽象，保持 KISS。
- 不改变现有步骤执行逻辑。
- 保留敏感字段日志脱敏逻辑。
- 不执行 git 提交。

## 验证
- 自动化测试验证：
  - 配置经 `setState()` 后会写入 `local`
  - 新会话 `getState()` 可恢复配置
  - 运行态字段不会被恢复
  - `resetState()` 后配置仍在
- 语法检查：`node --check`
