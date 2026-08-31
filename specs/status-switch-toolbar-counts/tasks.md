# 状态切换工具栏计数实施任务

## 0. 文档状态

- 状态：已确认并进入实施
- 确认日期：2026-08-31

## 1. 实施约束

- 严格执行失败测试 → 最小实现 → 重构 → 回归，不先写实现再补测试。
- 已确认新增销售、采购两个只读状态计数公共 API；不得继续扩大为 mutation、数据库或权限变更。
- 不修改 Prisma schema、migration、订单状态机、分页协议和 `QsStatusSwitchToolbar` 公共组件 API。
- 计数必须来自 Server 完整结果集，禁止使用当前页行数或前端下载全部分页推算。
- 所有计数请求继续遵守 `AbortSignal`、请求版本和鉴权世代边界。
- 每次提交只暂存本任务文件；不 push、不创建 PR、不部署。

## 2. 任务清单

### T1：提交已确认规格文档

目标：先保存已确认需求、技术设计和实施任务，形成后续代码变更的审计基线。

- [x] 将 `requirements.md`、`design.md` 和 `tasks.md` 状态更新为已确认/实施中。
- [x] 检查文档与最终确认范围一致。
- [x] 运行 `git diff --check`。
- [x] 创建本地提交：

```text
docs: 设计订单状态计数能力
```

### T2：固化销售计数契约与聚合失败测试

目标：证明当前销售订单域缺少状态计数 DTO、Controller 路由和服务端聚合。

- [x] 扩展 `sales-order-query-dto.spec.ts`，覆盖：
  - `view=all|pending`；
  - 关键字、币种、出单人、付款状态和日期范围；
  - 非法视图、UUID、日期和枚举被拒绝。
- [x] 扩展 `sales-order-query.service.spec.ts`，覆盖：
  - 全部销售排除 `DRAFT`；
  - 四个正式状态与 `ALL`；
  - 待办五个履约分类、待收款和去重 `ALL`；
  - 缺失分组补 `0`；
  - 基础筛选进入所有聚合谓词；
  - 待办多次读取使用 `RepeatableRead`。
- [x] 扩展销售 Controller/OpenAPI 测试，断言：
  - `GET /api/sales-orders/status-counts`；
  - `operationId = sales_orders_status_counts`；
  - `sales-orders:read`；
  - 私有 no-store、校验和响应 DTO。
- [x] 运行定向测试并记录预期失败原因。

```bash
pnpm -C server test -- sales-order-query-dto.spec.ts sales-order-query.service.spec.ts sales-orders-product-options.controller.spec.ts --runInBand
```

### T3：实现销售订单只读状态计数接口

目标：以最小实现让 T2 通过，并复用销售列表基础谓词。

- [x] 新增 `SalesOrderStatusCountsQueryDto`、计数项 DTO 和响应 DTO。
- [x] 提取销售列表基础 `where` 构造，保持关键字、日期和通用筛选语义不变。
- [x] 实现全部销售 `groupBy(orderStatus)`，显式排除 `DRAFT`。
- [x] 实现待办销售履约分组、付款分组和去重联合 `ALL`。
- [x] 待办聚合使用 `RepeatableRead` 事务。
- [x] 在 Controller 接入只读路由、权限和 OpenAPI 契约。
- [x] 重新运行 T2，确认通过。
- [x] 运行服务端类型检查和 lint。
- [x] 创建本地提交：

```text
feat: 添加销售订单状态计数接口
```

验证命令：

```bash
pnpm -C server test -- sales-order-query-dto.spec.ts sales-order-query.service.spec.ts sales-orders-product-options.controller.spec.ts --runInBand
pnpm -C server typecheck
pnpm -C server lint
```

### T4：固化采购计数契约与聚合失败测试

目标：证明当前采购订单域缺少全部/待办状态计数能力。

- [x] 新建 `purchase-order-query-dto.spec.ts`，覆盖：
  - `view=all|pending`；
  - 关键字、供应商、采购类型、履约、付款和日期范围；
  - 查询契约不接受 `orderStatus`、`pendingTask`、分页参数；
  - 非法视图、日期和枚举被拒绝。
- [x] 扩展 `purchase-order-query.service.spec.ts`，覆盖：
  - `CONFIRMED`、`COMPLETED`、`CANCELLED` 与 `ALL`；
  - 待发货、待入仓、待付款；
  - 同一订单可同时贡献履约与付款分类；
  - 缺失分组补 `0`；
  - 基础筛选进入所有聚合谓词；
  - 待办两次读取使用 `RepeatableRead`。
- [x] 扩展 `purchase-orders.controller.spec.ts`，固定路由、operationId、读取权限和响应契约。
- [x] 运行定向测试并记录预期失败原因。

```bash
pnpm -C server test -- purchase-order-query-dto.spec.ts purchase-order-query.service.spec.ts purchase-orders.controller.spec.ts --runInBand
```

### T5：实现采购订单只读状态计数接口

目标：以最小实现让 T4 通过，并复用采购列表基础谓词。

- [x] 新增 `PurchaseOrderStatusCountsQueryDto`、计数项 DTO 和响应 DTO。
- [x] 提取采购列表基础 `where` 构造，保持关键字、日期、供应商和通用筛选语义不变。
- [x] 实现全部采购订单状态分组与 `ALL`。
- [x] 实现待办履约、付款分组和允许重叠的映射。
- [x] 待办聚合使用 `RepeatableRead` 事务。
- [x] 在 Controller 接入只读路由、权限和 OpenAPI 契约。
- [x] 重新运行 T4，确认通过。
- [x] 运行服务端类型检查和 lint。
- [x] 创建本地提交：

```text
feat: 添加采购订单状态计数接口
```

验证命令：

```bash
pnpm -C server test -- purchase-order-query-dto.spec.ts purchase-order-query.service.spec.ts purchase-orders.controller.spec.ts --runInBand
pnpm -C server typecheck
pnpm -C server lint
```

### T6：同步 OpenAPI 并固化 Web 失败测试

目标：生成可信 Web 类型，并先证明正式页面尚未提供完整计数与全部采购工具栏。

- [x] 执行契约同步，检查两个新路径、查询 DTO、响应 DTO 和 operationId。
- [x] 扩展 `status-switch-toolbar.test.ts`，覆盖：
  - 按 `value` 合并计数；
  - 显式 `0` 保留；
  - 缺失键归零；
  - `label`、`disabled` 保持。
- [x] 扩展销售列表逻辑测试，要求全部/待办所有项目均具备计数。
- [x] 扩展采购列表逻辑测试，覆盖：
  - 全部采购四个状态顺序；
  - 非法 URL 状态归一；
  - `ALL` 不发送 `orderStatus`；
  - 其他状态映射到 `orderStatus`；
  - 待办继续映射 `pendingTask`；
  - 计数查询排除工具栏选择和分页。
- [x] 扩展销售、采购页面测试，断言 API 计数接入、全部采购工具栏、重复订单状态筛选移除和请求世代保护。
- [x] 扩展组件库测试，要求每个固定示例项都含 `count`。
- [x] 运行 Web 定向测试并记录预期失败原因。

```bash
node --run contract:sync
node --run contract:check
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/status-switch-toolbar.test.ts apps/qsmds-arco/test/views/sales-order-list-view.logic.test.ts apps/qsmds-arco/test/views/sales-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-list.logic.test.ts apps/qsmds-arco/test/views/purchase-order-pages.test.ts apps/qsmds-arco/test/api/sales-orders.test.ts apps/qsmds-arco/test/api/purchase-orders.test.ts
```

### T7：实现共享计数映射与销售页面接入

目标：让销售全部和销售待办展示服务端计数，同时保持现有列表与 URL 语义。

- [x] 在 `QsStatusSwitchToolbar/logic.ts` 实现 `withStatusSwitchCounts()`。
- [x] 在销售 API 模块增加生成类型驱动的 `statusCounts()`。
- [x] 建立销售计数查询，只包含 `view` 与计数基准条件。
- [x] 为销售状态项目映射计数，初始与缺失值展示 `0`。
- [x] 基础筛选变化、mutation、重试时并发刷新计数；状态切换和分页只刷新列表。
- [x] 使用 `AbortSignal`、请求版本和鉴权世代阻止过期响应覆盖。
- [x] 使用列表 `total` 校准当前选中项目计数。
- [x] 重新运行销售与共享逻辑测试。

### T8：实现全部采购工具栏与采购计数接入

目标：让采购全部和采购待办使用同一工具栏结构并显示真实计数。

- [x] 在采购 API 模块增加生成类型驱动的 `statusCounts()`。
- [x] 新增全部采购状态类型、项目定义和 URL `status` 规范化。
- [x] `buildPurchaseOrderListQuery()` 根据模式映射 `orderStatus` 或 `pendingTask`。
- [x] 建立采购计数查询，排除分页、订单状态和待办任务。
- [x] 页面始终渲染工具栏，并根据 `viewMode` 切换项目、model 与 aria-label。
- [x] 删除筛选抽屉中重复的“订单状态”。
- [x] 接入与销售一致的计数刷新、过期响应防护和选中项 `total` 校准。
- [x] mutation 与重试重新刷新计数。
- [x] 重新运行采购与共享逻辑测试。

### T9：更新组件库并完成 Web 回归

目标：确保仓库内每一个 `QsStatusSwitchToolbar` 实例都展示计数。

- [x] 将组件库 `NO_COUNT` 示例改为带固定计数状态。
- [x] 保留禁用项计数、390px 横向浏览和所有既有视觉规格。
- [x] 使用 `rg` 复核所有组件引用及其 items 来源。
- [x] 运行 Web API、页面、组件逻辑测试、类型检查和 lint。
- [x] 创建本地提交：

```text
feat: 展示订单状态分类计数
```

验证命令：

```bash
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/status-switch-toolbar.test.ts apps/qsmds-arco/test/views/sales-order-list-view.logic.test.ts apps/qsmds-arco/test/views/sales-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-list.logic.test.ts apps/qsmds-arco/test/views/purchase-order-pages.test.ts apps/qsmds-arco/test/api/sales-orders.test.ts apps/qsmds-arco/test/api/purchase-orders.test.ts
pnpm -C web typecheck
pnpm -C web lint
```

### T10：完整检查与真实页面验收

目标：证明契约、Server、Web、运行时和真实交互均满足确认基线。

- [ ] 运行两个订单域全部定向测试。
- [ ] 运行 `node --run contract:check`。
- [ ] 运行 `node --run check`。
- [ ] 确认 Server `3000`、Web `9000` 正常运行；仅在需要时按既有脚本重启。
- [ ] 验证 `/api/health` 数据库为 `up`，Web 返回 HTTP 200。
- [ ] 浏览器验收销售全部、销售待办、采购全部、采购待办和组件库页面。
- [ ] 验证搜索、日期和通用筛选会刷新计数。
- [ ] 验证状态切换和翻页不会清空计数，选中项与列表 `total` 一致。
- [ ] 验证零计数、待办重叠计数、全部采购 URL 恢复和窄屏横向浏览。
- [ ] 检查浏览器网络请求没有为计数下载全部分页。

```bash
node --run contract:check
node --run check
curl --fail --silent http://127.0.0.1:3000/api/health
curl --fail --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:9000/
```

### T11：Git 收口

- [ ] 检查 `git status --short`、完整 diff、暂存范围和 `git diff --check`。
- [ ] 确认预定四个本地提交存在：

```text
docs: 设计订单状态计数能力
feat: 添加销售订单状态计数接口
feat: 添加采购订单状态计数接口
feat: 展示订单状态分类计数
```

- [ ] 确认没有 `.env`、密钥、日志、缓存、生成构建目录或无关文件进入提交。
- [ ] 确认工作树干净，报告提交 SHA 与验证结果。
- [ ] 不 push、不创建 PR、不部署。

## 3. 完成定义

只有同时满足以下条件才能声明完成：

1. 两个只读计数 API、OpenAPI 和 Web 生成类型一致；
2. 四个正式业务页面与组件库的每个工具栏项目都显示数值计数；
3. 计数遵守全量、筛选联动、零值、待办重叠和销售去重语义；
4. 全部采购工具栏、URL 恢复和重复筛选移除已完成；
5. 定向测试、根完整检查、运行时健康和真实页面验收全部通过；
6. 四个约定本地提交创建成功，且未推送远端。
