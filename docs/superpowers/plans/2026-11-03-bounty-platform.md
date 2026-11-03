# 内部悬赏平台实施计划

> For agentic workers: 使用 executing-plans 在当前会话执行；用户已确认方案并明确要求实施，无需再次审批。

**Goal:** 交付具有真实登录、任务与奖励流程的中文内部悬赏平台。
**Architecture:** Next.js 页面与同源 API，PostgreSQL 保存全部业务数据，受保护的本地附件存储，独立清理进程。
**Tech Stack:** TypeScript、Next.js、React、node-postgres、Zod、Vitest、Docker Compose、Caddy。
**Spec:** 本会话用户确认的《内部悬赏平台建设方案》。

## Global Constraints
- 全程中文；删除项目文件先询问用户。自动清理任务结束 15 天后的上传附件已单独获得授权。
- 两种任务模式、两种奖励类型；单次附件不超过 20 MB；禁止匿名访问业务数据。
- 数据库事务保证领取不超员、验收发奖幂等。部署到用户自有 Linux 服务器。

## Review Focus
- 同时领取最后一个名额；重复提交验收；停用账号与密码重置后的旧会话。
- 团队分配缺少成员、超额或非法小数；直接猜测附件地址；清理边界和失败重试。
- 已完成部分奖励在取消后保留；首次团队提交后人员锁定；数据库重启和数据恢复。

### Task 1: 业务规则和数据库
**Files:** src/lib/rules.ts、src/lib/db.ts、src/lib/tasks.ts、db/001-init.sql、tests/integration.test.ts。
**Interfaces:** createTask(db,user,input)、claimTask(db,user,taskId)、submitWork(db,user,taskId,input)、reviewWork(db,user,submissionId,input)。
- [x] 先编写金额、分配、权限、生命周期测试并观察失败。
- [x] 实现数据库迁移与事务服务，执行 npm test，21项测试通过。

### Task 2: 登录、附件与接口
**Files:** src/lib/auth.ts、src/lib/files.ts、src/app/api/[...path]/route.ts。
**Interfaces:** 登录会话、同源校验、REST JSON、FormData 上传、受保护下载。
- [x] 添加登录失效、附件权限与过期清理测试，观察失败后实现。
- [x] 测试账号管理、Cookie、过期和并发流程；完成58项HTTP端到端检查。

### Task 3: 中文前端
**Files:** src/app、src/components。
- [x] 实现登录、大厅、详情、发布、工作台和账号管理，连接真实 API。
- [x] 检查移动端、空状态、错误提示、加载状态及团队奖励分配。

### Task 4: 部署与交付
**Files:** Dockerfile、compose.yaml、deploy、README.md。
- [x] 提供迁移初始化、管理员初始化、小时清理、备份恢复说明。
- [x] 执行完整测试、类型检查、生产构建和浏览器业务检查；Docker真实容器另完成26项检查（含重启、备份、独立环境恢复）。

## 独立审查及修复
- 上传回滚孤儿附件：数据库故障注入先复现失败，再增加事务级回收及24小时无引用临时文件对账，回归通过。
- 累计奖励被混合明细截断：先复现1000条其他成员记录场景，再改为独立全量聚合、分开查询个人和管理明细，回归通过。
- 实际容器启动发现初始化脚本外部Zod依赖缺失，调整为打包Zod、仅外置pg，重新构建及26项容器验收通过。
- 打包排除本地环境配置、数据库、附件和测试数据；独立审查没有遗留Critical、Important或Minor发现。
