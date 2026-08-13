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

- [ ] 2. 权限和审计 Migration
  - TDD 新增 `products:update`、`PRODUCT_UPDATED`、`system_admin` 授权和结构自检。
  - _Requirement: R6, R9_

- [ ] 3. Product 更新输入契约
  - TDD 新增 Product UUID、Update DTO、白名单和规范化 Patch。
  - _Requirement: R2-R5, R8_

- [ ] 4. Product 详情读取
  - TDD 实现 `getById()`、历史供应商解析、404 和脱敏。
  - _Requirement: R1, R3, R8_

- [ ] 5. Product 更新持久化与服务
  - TDD 实现 `FOR UPDATE`、no-op、依赖规则、并发、版本和原子审计。
  - _Requirement: R2, R4-R6, R8_

- [ ] 6. Controller、OpenAPI 与生成契约
  - 精确新增 `products_get_by_id/products_update` 并同步 generated types。
  - _Requirement: R1-R7_

- [ ] 7. Web API、路由与共享表单
  - TDD 扩展 adapter/route，受控移动创建表单并保持创建回归。
  - _Requirement: R1-R5, R7-R8_

- [ ] 8. 产品详情 Drawer
  - 接入真实详情、完整字段、权限、重试和编辑入口。
  - _Requirement: R1, R3, R7-R8_

- [ ] 9. 产品编辑页面
  - 实现 diff、dirty、并发冲突、GET 对账、离开守卫和成功返回列表。
  - _Requirement: R2-R5, R7-R8_

- [ ] 10. Server 隔离 E2E 与 Web/Chrome 验收
  - 覆盖权限、CSRF、历史引用、并发、回滚、响应式和中文审计。
  - _Requirement: R1-R9_

- [ ] 11. 应用持久开发数据库
  - 精确检查待迁移集合，执行 deploy 并验证权限、授权、enum 和 Product 行数不变量。
  - _Requirement: R6, R9_

- [ ] 12. 全量验证、重启与 Git 收口
  - Server/Web/Root/OpenAPI/build/browser 全绿，更新证据，小步提交，不 push。
  - _Requirement: R1-R9_

## 停止条件

- 必须修改 Product 表字段或 `product_status`。
- 必须新增第三个 Product operation、Supplier 领域或公共 Qs/Fa 契约。
- 持久数据库待迁移集合不是本期精确两条，或存在 Schema drift。
- 发现用户未提交的重叠修改或无法解释的测试失败。
