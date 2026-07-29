# 系统货币与当前汇率管理实施计划

## 1. 文档状态

- 状态：执行中
- 开始日期：2026-07-29
- 分支：`feat/currency-system`
- 需求文档：`specs/system-currency-management/requirements.md`
- 技术设计：`specs/system-currency-management/design.md`

## 2. 执行规则

- 新功能采用 TDD：先建立失败测试，再实现最小代码，最后重构。
- 每项任务完成后更新本文件状态。
- 每个提交必须通过对应范围测试，不提交仅包含失败测试的中间状态。
- 公共 decimal 值使用 string，不暴露 Decimal 实例。
- Server 与 Web 通过 OpenAPI 契约协作，不跨目录引用源码。
- 代码中的非直观工程约束使用必要的中文注释说明。

## 3. 实施任务

- [x] 1. 建立规格文档与绿色基线
  - 写入已确认 requirements、design 和 tasks。
  - 复核分支、工作区和现有相关测试。
  - _Requirement: 1-9_

- [x] 2. 以 TDD 建立数据库模型与迁移
  - 先补 schema、migration、permission、Audit 和 seed 失败测试。
  - 新增 Currency、ExchangeRate、数据库约束及跨表 trigger。
  - 导入四币种且保持零汇率。
  - _Requirement: 1, 2, 3, 4, 7, 8_

- [ ] 3. 以 TDD 实现严格 DTO 与 Decimal 边界
  - 校验 code、minorUnit、文本和 expectedVersion。
  - 校验、规范化 `foreignUnitsPerCny` decimal string。
  - 建立稳定错误码与持久化错误映射。
  - _Requirement: 2, 3, 8_

- [ ] 4. 以 TDD 实现货币查询与 Catalog
  - 实现管理查询与正常 Session 可用的全量 Catalog。
  - 注册 Module、Controller、operationId 和 OpenAPI 错误矩阵。
  - _Requirement: 2, 5, 8_

- [ ] 5. 以 TDD 实现货币写操作
  - 创建默认停用、受控编辑、启停、version、锁序和 Audit。
  - 无汇率启用与 CNY 停用必须失败。
  - _Requirement: 1, 2, 4, 8_

- [ ] 6. 以 TDD 实现当前汇率管理
  - 实现 LEFT JOIN 列表、创建、更新、version 和 Audit。
  - 允许停用外币配置汇率，禁止 CNY 与重复当前行。
  - _Requirement: 3, 4, 8_

- [ ] 7. 完成 Server E2E 与 OpenAPI
  - 验证 migration replay、seed、约束、并发和 Audit 回滚。
  - 生成 OpenAPI 并同步 Web 契约。
  - _Requirement: 1-8_

- [ ] 8. 以 TDD 实现 Web API 与 Currency Catalog
  - 实现 generated DTO adapter、runtime validation、缓存和失效。
  - 覆盖身份隔离、Abort、慢响应及失败不缓存。
  - _Requirement: 5, 8_

- [ ] 9. 以 TDD 动态化 MoneyInput
  - 删除静态货币和隐式默认值。
  - 支持动态 options、minorUnit、停用当前值和异常状态。
  - _Requirement: 5, 6_

- [ ] 10. 以 TDD 动态化 AmountDisplay
  - 动态 symbol、minorUnit、code 和未解析回退。
  - 验证 0、2、4 位及大整数 half-up。
  - _Requirement: 5, 6_

- [ ] 11. 以 TDD 实现货币管理页面
  - 实现路由权限、查询、表格、创建/编辑和启停确认。
  - 无汇率时禁止启用，无删除入口。
  - _Requirement: 2, 4, 8, 9_

- [ ] 12. 以 TDD 实现汇率管理页面
  - 实现未配置状态、严格输入、公式预览和并发恢复。
  - 不增加历史、有效期或删除能力。
  - _Requirement: 3, 4, 8, 9_

- [ ] 13. 完成审计、浏览器与总体验收
  - 同步 Web Audit 事件和中文文案。
  - 验证 1440px、390px、亮暗主题、键盘、权限撤销和完整状态流。
  - 运行全部检查、构建、数据库 E2E、contract 和 diff 门禁。
  - _Requirement: 1-9_

## 4. Git 提交边界

建议提交顺序：

1. `docs: 完善系统货币体系规格`
2. `feat: 建立货币与汇率数据模型`
3. `feat: 实现货币与汇率服务端接口`
4. `feat: 动态化金额货币组件`
5. `feat: 实现货币与汇率管理页面`
6. `test: 完善系统货币体系验收`

未经用户要求不 push、不 merge、不删除分支。

## 5. 最新验证证据

### Task 1

- `pnpm -C server check`：通过，83 suites / 721 tests。
- 相关 Web API/页面测试通过，441 tests。
- MoneyInput、AmountDisplay 与 Basic Data 路由定向测试通过，24 tests。
- Web ESLint 与 Stylelint 通过。
- Web `vue-tsc -b` 通过。
- `pnpm -C web check` 在受限环境中因 `tsx` CLI 创建 IPC pipe 失败：
  `listen EPERM .../tsx-501/*.pipe`。相同 TypeScript 测试通过
  `node --import tsx --test` 执行；仍会在三个测试内部再次启动 `tsx` CLI 时复现
  同一环境错误，未发现业务断言失败。

### Task 2

- 数据库结构与权限定向测试通过，14 tests。
- `pnpm -C server prisma:validate`：通过。
- `git diff --check`：通过。
- 本阶段只验证 migration 静态契约；live migration replay 与数据库 E2E 保留到
  Task 7 执行。
