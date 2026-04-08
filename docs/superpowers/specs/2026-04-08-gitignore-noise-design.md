# Git Ignore 本地噪音 Design

## 目标
避免本地开发噪音文件持续出现在 `git status` 中。

## 选定方案
采用方案 2：新增 `.gitignore`，忽略以下本地噪音：
- `.setting/`
- `.DS_Store`
- `*.log`

## 约束
- 不修改任何已跟踪业务代码
- 只处理本地噪音文件忽略规则
- 不执行 git commit / push，除非用户再次明确要求

## 验证
- 自动化测试确认 `.gitignore` 含上述规则
- `git status --short` 不再显示 `.setting/` 未跟踪文件
