# Config Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件配置项在修改后自动持久化，并在插件重载后自动恢复。

**Architecture:** 继续以 `chrome.storage.session` 作为运行态主存储，同时把配置键镜像写入 `chrome.storage.local`。读取状态时合并 `local + session`，重置流程时只清空运行态并从 `local` 回填配置。

**Tech Stack:** Chrome Extension Manifest V3、Service Worker、Side Panel、Node.js 内置 `node:test`

---

### Task 1: 为背景脚本补持久化回归测试

**Files:**
- Modify: `tests/cfmail-poll.test.cjs`

- [ ] **Step 1: 写失败测试，覆盖配置跨重载恢复与运行态不恢复**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 写最小实现**
- [ ] **Step 4: 运行测试确认通过**

### Task 2: 在 background.js 中接入 local/session 双层存储

**Files:**
- Modify: `background.js`

- [ ] **Step 1: 增加持久化配置键常量与筛选函数**
- [ ] **Step 2: 修改 `getState()` 合并 `storage.local` 与 `storage.session`**
- [ ] **Step 3: 修改 `setState()`，配置键同步写入 `storage.local`**
- [ ] **Step 4: 修改 `resetState()`，从 `storage.local` 回填配置**
- [ ] **Step 5: 运行对应测试**

### Task 3: 让侧边栏配置修改即保存

**Files:**
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: 把 `vpsUrl`、`customPassword`、`inbucketHost`、`inbucketMailbox` 的保存事件改为 `input`**
- [ ] **Step 2: 保持 `mailProvider` 的 `change` 事件逻辑不变**
- [ ] **Step 3: 运行回归测试与语法检查**

### Task 4: 全量验证

**Files:**
- Modify: `tests/cfmail-poll.test.cjs`
- Modify: `tests/sidepanel-regression.test.cjs`

- [ ] **Step 1: 跑 `node --check background.js`**
- [ ] **Step 2: 跑 `node --check sidepanel/sidepanel.js`**
- [ ] **Step 3: 跑 `node --test tests/*.cjs`**
- [ ] **Step 4: 审查持久化范围是否只包含配置项**
