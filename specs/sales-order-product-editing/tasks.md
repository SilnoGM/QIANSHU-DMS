# 销售订单产品修改与采购入口收敛实施计划

## 1. 文档状态

- 阶段：Phase 3 - Task Breakdown
- 状态：已确认，实施中
- 编写日期：2026-09-02
- 需求规格：[requirements.md](./requirements.md)
- 技术设计：[design.md](./design.md)

## 2. 执行原则

1. 新功能和业务规则修改严格采用 RED → GREEN → REFACTOR。
2. 先固定数据库与服务端可信边界，再同步 OpenAPI，最后接入 Web。
3. 删除旧 API、旧组件和采购页旧流程时使用 `rg` 全仓审计，不保留无必要兼容层。
4. migration 必须先通过 schema 测试、隔离 PostgreSQL E2E、Prisma validate 和契约检查，才应用当前开发数据库。
5. 每个可独立验证的功能段完成后创建标准 Git 提交；不推送远端。
6. 任一测试或命令失败必须停止对应交付步骤并如实报告。

## 3. 任务清单

### T1：固化需求与技术设计

- [x] 使用 EARS 编写产品修改、两视图采购和金额联动需求。
- [x] 确认定金下调采用一层加强版二次确认，并由服务端校验确认标记。
- [x] 确认 `removedAt` 软移除、公共 API 替换和 migration 直接应用开发数据库。
- [x] 完成 UI 设计规格、事务锁顺序、API、错误码和验证策略。
- _Requirements: R1-R9_

### T2：建立数据库软移除与约束失败测试

- [ ] 新增 schema 测试，要求 `SalesOrderLine.removedAt` 和 `SALES_ORDER_PRODUCTS_CHANGED` 唯一存在。
- [ ] 固定 migration 只能新增可空字段和枚举，不回填、不删除历史数据。
- [ ] 固定销售小计触发器只统计有效销售明细且至少保留一行。
- [ ] 固定有效采购不得引用软移除行、取消采购可以保留历史引用。
- [ ] 固定软移除行不得存在有效采购数量。
- [ ] 运行定向 schema 测试并记录有效 RED。
- _Requirements: R5, R6, R8_

### T3：实现 Prisma schema 与增量 migration

- [ ] 修改 Prisma schema，增加 `removedAt` 和审计枚举。
- [ ] 新增单条增量 migration，替换相关数据库约束函数。
- [ ] 更新 schema governance 固定枚举和 migration 顺序。
- [ ] 运行 `prisma:validate`、schema 定向测试和 drift gate。
- [ ] 确认未应用当前开发数据库。
- [ ] 提交数据库契约改造。
- _Requirements: R5, R6, R8_

### T4：把采购来源收敛为两个可信视图

- [ ] 先修改领域分类测试，删除 `COMPLETED_PURCHASE_ADD_ON` 并固定两类互斥规则。
- [ ] 修改采购来源查询测试，要求 SQL、计数、预览和来源明细只读取有效销售明细。
- [ ] 修改采购创建依赖与采购覆盖测试，拒绝软移除来源并忽略软移除行。
- [ ] 实现两视图常量、SQL 分类、来源读取和覆盖计算。
- [ ] 运行采购来源、采购创建依赖和覆盖服务定向测试。
- [ ] 提交采购域可信读取改造。
- _Requirements: R1, R7_

### T5：建立销售产品修改 DTO、normalizer 与查询失败测试

- [ ] 新增 DTO 测试，覆盖 `expectedVersion`、原因、确认标记、完整既有行和新增行。
- [ ] 新增 normalizer 测试，覆盖重复行 ID、非法数量、`0` 业务移除、空有效行和最多 100 行。
- [ ] 新增查询测试，覆盖海运前资格、每行有效采购数量、取消采购不锁定、有效产品选项和无供应商条件。
- [ ] 新增图片授权测试，要求 `sales-orders:update`、有效订单和有效产品关系。
- [ ] 运行定向测试并记录有效 RED。
- _Requirements: R2-R5, R8_

### T6：实现销售产品修改只读契约

- [ ] 新增 `SalesOrderProductEditQueryService`。
- [ ] 返回订单、金额、既有行、有效采购数量、`canDecrease` 和剩余行容量。
- [ ] 新增不受供应商限制的目录产品选项和授权主图路径。
- [ ] 统一过滤 `removedAt: null`。
- [ ] 实现 DTO/normalizer 并转绿 T5。
- [ ] 提交销售产品修改查询能力。
- _Requirements: R2-R5, R8_

### T7：建立销售产品修改事务失败测试

- [ ] 固定“销售行 → 销售订单”锁顺序、Serializable 和版本校验。
- [ ] 覆盖既有行增加、无有效采购减少、软移除、新增 CATALOG/CUSTOM。
- [ ] 覆盖有效采购锁定、仅取消采购允许减少、行集合伪造和最终空订单。
- [ ] 覆盖金额增减、定金下调确认、总价低于有效收款和付款状态重算。
- [ ] 覆盖剩余数量导致 `PENDING` 回退、覆盖完成导致 `PREPARING` 推进和其他海运前状态保持。
- [ ] 覆盖金额修订、状态历史、单条审计、版本只增加一次和事务任一步失败回滚。
- [ ] 覆盖并发修改、并发采购与序列化冲突映射。
- [ ] 运行定向测试并记录有效 RED。
- _Requirements: R3-R8_

### T8：实现销售产品修改事务服务

- [ ] 新增 `SalesOrderProductEditService`，事务内重读全部业务事实。
- [ ] 实现数量更新、`removedAt` 软移除和新增行快照。
- [ ] 服务端重算金额、确认定金下调、保护有效收款并派生付款状态。
- [ ] 重算采购覆盖和履约状态，写入必要状态历史。
- [ ] 写金额修订与 `SALES_ORDER_PRODUCTS_CHANGED` 审计。
- [ ] 映射稳定业务错误码与并发冲突。
- [ ] 转绿 T7，并运行相关销售/采购回归测试。
- [ ] 提交销售产品原子修改能力。
- _Requirements: R3-R8_

### T9：替换 Controller、OpenAPI 和 Web API 契约

- [ ] 先修改 Controller 测试，固定 `product-edit-context`、产品选项、图片和 `PATCH products`。
- [ ] 固定所有新端点只要求 `sales-orders:update`，mutation 要求 CSRF、private no-store 和 `retry: false`。
- [ ] 删除旧 add-on Controller 路径、DTO 注入与模块 provider。
- [ ] 实现新 Controller 路径、DTO 响应和错误码。
- [ ] 执行 `contract:sync` 并只使用 generated types。
- [ ] 修改 Web API 定向测试和适配器，删除旧 add-on 方法。
- [ ] 运行 Controller、OpenAPI、Web API 和 `contract:check`。
- [ ] 提交公共契约替换。
- _Requirements: R2-R9_

### T10：建立并实现 `QsSalesOrderProductsEditorModal`

- [ ] 先写 logic 测试：既有行最小数量、增加/减少/移除、新增行和金额预览。
- [ ] 固定普通确认与定金下调加强确认，确认标记只能由对应复核状态产生。
- [ ] 先写结构测试：纯组件边界、`90rem`、`4:8`、锁定提示、草稿保留和移动布局。
- [ ] 新建组件 `types.ts`、`logic.ts`、`index.vue` 和 README。
- [ ] 既有行只编辑数量；新增行复用 `QsOrderProductLineEditor`。
- [ ] 本地错误使用 Warning Toast 并保留字段错误；服务端错误使用弹窗持久错误。
- [ ] 替换组件库路由、Showcase 和验收测试。
- [ ] 删除旧组件目录与旧组件测试。
- [ ] 运行组件、logic、组件库、typecheck、ESLint 和 Stylelint。
- [ ] 提交新产品修改组件。
- _Requirements: R3-R6, R9_

### T11：接入全部销售订单操作列

- [ ] 先写页面测试，固定“全部订单”显示“查看 + 修改产品”，待办页不新增该入口。
- [ ] 固定 `CONFIRMED + 海运前 + sales-orders:update` 资格。
- [ ] 固定上下文加载、产品选项、二次确认、禁止重复提交、错误恢复和成功刷新。
- [ ] 接入新组件和 Web API，调整操作列宽度。
- [ ] 成功后 Toast 并刷新列表/状态计数，不自动跳转采购页。
- [ ] 运行销售列表页面与逻辑定向测试。
- [ ] 提交全部销售订单入口。
- _Requirements: R2-R9_

### T12：删除采购页第三视图与加购流程

- [ ] 先修改选择器、适配器和采购页面测试，要求只剩两个视图。
- [ ] 删除 `canAddSalesOrderProducts`、第三视图动作和权限说明。
- [ ] 删除采购创建页 add-on state、API、弹窗、`FaMultiStepLoader` 和相关恢复逻辑。
- [ ] 删除 `purchase-order-sales-add-on.logic.ts` 及旧测试。
- [ ] 保持普通来源选择、快捷入口、同步剩余行和已采购灰色行行为不变。
- [ ] 全仓审计 `COMPLETED_PURCHASE_ADD_ON`、旧组件名和旧 add-on API 不再存在于运行时代码。
- [ ] 运行采购页面、选择器、快捷入口和同步逻辑回归测试。
- [ ] 提交采购入口收敛。
- _Requirements: R1, R7, R9.8-R9.9_

### T13：隔离 PostgreSQL E2E 与完整回归

- [ ] 在隔离数据库执行全部 migration。
- [ ] 验证软移除、取消采购历史、有效采购锁定和数据库约束。
- [ ] 验证产品增加/减少、定金确认、收款保护和状态联动。
- [ ] 验证并发修改以及采购创建竞态最多一个合法结果。
- [ ] 验证修改后订单进入正确采购视图并只能同步剩余产品。
- [ ] 运行 Server/Web 定向测试、typecheck、lint、Stylelint、生产构建和契约检查。
- [ ] 运行 `node --run check` 与 `git diff --check`。
- [ ] 修复新增失败；既有失败单独记录，不掩盖。
- _Requirements: R1-R9_

### T14：应用 migration 并完成运行时验收

- [ ] 应用前脱敏核对当前开发数据库身份与 migration 状态。
- [ ] 执行 `pnpm -C server db:migrate:deploy`。
- [ ] 验证 migration 为 Applied、`removed_at`、审计枚举和约束函数。
- [ ] 重启或确认 Server/Web 使用最新代码。
- [ ] 验证 Web `9000` HTTP 200、Server `3000/api/health` database `up`。
- [ ] 对“全部销售订单 → 修改产品 → 采购两视图同步”执行浏览器验收。
- [ ] 更新 `tasks.md`、旧规格替代状态和最终验证记录。
- [ ] 创建最终收口提交，确认 Git 工作区干净。
- _Requirements: R1-R9_

## 4. 计划提交边界

1. `feat: 增加销售产品软移除数据契约`
2. `refactor: 收敛采购销售来源为两个视图`
3. `feat: 添加销售订单产品修改服务`
4. `feat: 替换销售产品修改公共契约`
5. `feat: 添加销售订单产品修改组件`
6. `feat: 接入全部销售订单产品修改入口`
7. `refactor: 移除采购页销售加购流程`
8. `test: 完成销售产品修改闭环验收`

实际提交可根据依赖关系合并相邻的小改动，但不得把失败状态提交为完成结果。

## 5. Phase 3 确认门

任务拆分已确认，现进入 Phase 4 正式实施。实施期间：

- 按任务顺序持续更新勾选状态。
- 公共 API、schema、migration 和旧文件删除严格限制在已确认设计内。
- migration 通过规定验证后直接应用当前开发数据库。
- 不推送远端、不部署生产环境。
