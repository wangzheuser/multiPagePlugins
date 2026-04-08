# CFMail Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 CFMail 轮询补强诊断日志，帮助区分“没收到邮件”和“提取失败”。

**Architecture:** 在共享 CFMail 工具中增加摘要构建函数，由 `background.js` 在每轮轮询后输出摘要日志。保持现有状态机与轮询控制不变，仅增强可观测性。

**Tech Stack:** Chrome Extension MV3、Service Worker、Node.js `node:test`

---

### Task 1: 为诊断日志补失败测试

**Files:**
- Modify: `tests/cfmail-poll.test.cjs`
- Modify: `shared/cfmail-utils.js`

- [ ] **Step 1: 写空邮箱日志失败测试**
- [ ] **Step 2: 写 OpenAI 无验证码日志失败测试**
- [ ] **Step 3: 运行测试确认失败**

### Task 2: 实现邮件诊断摘要函数

**Files:**
- Modify: `shared/cfmail-utils.js`

- [ ] **Step 1: 增加截断/归一化摘要辅助函数**
- [ ] **Step 2: 增加邮件诊断摘要构建函数并导出**
- [ ] **Step 3: 运行对应测试**

### Task 3: 接入轮询日志

**Files:**
- Modify: `background.js`

- [ ] **Step 1: 引入诊断摘要函数**
- [ ] **Step 2: 在每轮抓取后输出空邮箱或摘要日志**
- [ ] **Step 3: 保持现有 attempt 日志与成功路径不变**
- [ ] **Step 4: 运行测试确认通过**

### Task 4: 全量验证

**Files:**
- Modify: `tests/cfmail-poll.test.cjs`

- [ ] **Step 1: 跑 `node --check background.js`**
- [ ] **Step 2: 跑 `node --check shared/cfmail-utils.js`**
- [ ] **Step 3: 跑 `node --test tests/*.cjs`**
