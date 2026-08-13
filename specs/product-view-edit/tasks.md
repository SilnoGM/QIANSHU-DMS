# 产品查看与编辑实施计划

## 状态

- Phase R：已确认
- Phase D：已确认
- Phase T：已确认
- Phase 4：已授权实施
- 持久开发数据库：已授权在隔离验证和精确待迁移检查通过后应用

## Tasks

- [x] 1. 固化 Requirements、Design 与 Tasks
  - 落盘已确认范围、恢复性状态规则、UI 设计和数据库授权。
  - _Requirement: R1-R9_

- [x] 2. 权限和审计 Migration
  - TDD 新增 `products:update`、`PRODUCT_UPDATED`、`system_admin` 授权和结构自检。
  - RED：缺少权限常量、两条 Migration 和 enum，目标测试 5 项按预期失败。
  - GREEN：Prisma validate/generate、相关 Server 目标测试 21/21 与目标 ESLint 通过。
  - _Requirement: R6, R9_

- [x] 3. Product 更新输入契约
  - TDD 新增 Product UUID、Update DTO、白名单和规范化 Patch。
  - RED：目标测试只因 `product-update.dto` 与 `product-update.normalizer` 缺失失败。
  - GREEN：DTO、白名单、深复制冻结与完整目标差异计算测试通过。
  - _Requirement: R2-R5, R8_

- [x] 4. Product 详情读取
  - TDD 实现 `getById()`、历史供应商解析、404 和脱敏。
  - RED：`getById()` 与事务内历史字典解析能力缺失。
  - GREEN：详情、404、历史供应商及固定内部错误边界测试通过。
  - _Requirement: R1, R3, R8_

- [x] 5. Product 更新持久化与服务
  - TDD 实现 `FOR UPDATE`、no-op、依赖规则、并发、版本和原子审计。
  - RED：行锁持久化与 `ProductUpdateService` 模块缺失。
  - GREEN：Product 与字典目标回归 14 suites / 178 tests 通过，目标 ESLint 与 TypeScript 通过。
  - _Requirement: R2, R4-R6, R8_

- [x] 6. Controller、OpenAPI 与生成契约
  - 精确新增 `products_get_by_id/products_update` 并同步 generated types。
  - RED：Controller 缺少第三个依赖与两个 handler，Module 未注册更新服务。
  - GREEN：Controller/Module 9 tests、目标 ESLint/TypeScript 与 `contract:check` 通过。
  - _Requirement: R1-R7_

- [x] 7. Web API、路由与共享表单
  - TDD 扩展 adapter/route，受控移动创建表单并保持创建回归。
  - GREEN：Web 产品定向测试 32/32、TypeScript、ESLint 与 Stylelint 通过。
  - _Requirement: R1-R5, R7-R8_

- [x] 8. 产品详情 Drawer
  - 接入真实详情、完整字段、权限、重试和编辑入口。
  - GREEN：列表快照先稳定布局，fresh GET 受 Abort/Auth epoch 防竞态保护。
  - _Requirement: R1, R3, R7-R8_

- [x] 9. 产品编辑页面
  - 实现 diff、dirty、并发冲突、GET 对账、离开守卫和成功返回列表。
  - GREEN：空差异不 PATCH，409 不覆盖，网络/5xx 只 GET 对账且不自动重放。
  - _Requirement: R2-R5, R7-R8_

- [x] 10. Server 隔离 E2E 与 Web/Chrome 验收
  - 覆盖权限、CSRF、历史引用、并发、回滚、响应式和中文审计。
  - Server：16 条 Migration 从零/重复部署和状态检查通过，28 suites / 167 tests 全绿。
  - Web：定向逻辑/源码契约与静态检查通过；隔离真实 Chrome 2/2 全绿。
  - 持久开发数据：两条真实产品的列表、详情与编辑回填只读验收通过；发现并修复异步详情导致 Drawer 编辑入口缺失的问题。
  - _Requirement: R1-R9_

- [x] 11. 应用持久开发数据库
  - 精确检查待迁移集合，执行 deploy 并验证权限、授权、enum 和 Product 行数不变量。
  - GREEN：仅两条目标 Migration 被应用；状态 up to date，Product 行数保持 2，四项结构/授权计数符合预期。
  - _Requirement: R6, R9_

- [x] 12. 全量验证、重启与 Git 收口
  - Root 663/663、Server 156 suites / 1549 tests、Web 784/784、OpenAPI、生产构建与真实 Chrome 2/2 全绿。
  - 前后端已从根入口重启；Web/Server HTTP 200，数据库健康为 `up`，完成小步提交且不 push。
  - _Requirement: R1-R9_

## 停止条件

- 必须修改 Product 表字段或 `product_status`。
- 必须新增第三个 Product operation、Supplier 领域或公共 Qs/Fa 契约。
- 持久数据库待迁移集合不是本期精确两条，或存在 Schema drift。
- 发现用户未提交的重叠修改或无法解释的测试失败。
