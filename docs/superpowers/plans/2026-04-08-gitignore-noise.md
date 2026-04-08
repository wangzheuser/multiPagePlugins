# Git Ignore Noise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `.gitignore`，屏蔽本地开发噪音文件。

**Architecture:** 使用仓库根目录 `.gitignore` 管理忽略规则，并用一个极小 Node 测试验证关键规则存在。

**Tech Stack:** Git ignore rules、Node.js `node:test`

---

### Task 1: 为 ignore 规则补失败测试

**Files:**
- Create: `tests/gitignore-regression.test.cjs`

- [ ] 写失败测试
- [ ] 运行测试确认失败

### Task 2: 新增 `.gitignore`

**Files:**
- Create: `.gitignore`

- [ ] 写最小 ignore 规则
- [ ] 运行测试确认通过

### Task 3: 验证效果

**Files:**
- Modify: `.gitignore`
- Modify: `tests/gitignore-regression.test.cjs`

- [ ] 跑 `node --test tests/*.cjs`
- [ ] 跑 `git status --short`
