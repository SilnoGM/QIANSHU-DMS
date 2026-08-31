# 采购订单列表产品列实施任务

## 1. 实施约束

- 严格按照失败测试 → 最小实现 → 重构 → 回归的顺序执行。
- 公共 API 扩展已获得用户确认；不得继续扩大接口、数据结构或权限范围。
- 不修改数据库 schema、迁移或生产数据。
- 不修改 `ImageGroup`、`QsGoodTooltipContent` 或销售订单列表的公共实现。
- 每一阶段只暂存本任务文件，提交前检查 `.env`、生成目录、日志和无关改动。

## 2. 任务清单

### T1：固化服务端列表摘要失败测试

目标：先证明采购列表当前缺少 `lineSummary`，并固定完整 preview 与主图 URL 规则。

- [x] 扩展 `server/src/modules/purchase-orders/purchase-order-query.service.spec.ts` 测试 fixture，加入：
  - 有 READY 主图的 `CATALOG` 明细；
  - 无主图的 `CATALOG` 明细；
  - `CUSTOM` 明细；
  - 至少四条有图明细，用于证明服务端不截断 preview。
- [x] 断言 `lineCount`、`totalQuantity`、产品名称快照、可空主图和采购列表图片 URL。
- [x] 运行定向测试并记录预期失败原因：缺少 `lineSummary`。

验证命令：

```bash
pnpm -C server test -- purchase-order-query.service.spec.ts --runInBand
```

### T2：实现采购列表摘要与 OpenAPI DTO

目标：以最小改动让 T1 通过，并形成服务端公共响应契约。

- [x] 在 `purchase-order-response.dto.ts` 新增 `PurchaseOrderListImageDto`、`PurchaseOrderLinePreviewDto`、`PurchaseOrderLineSummaryDto`。
- [x] 为 `PurchaseOrderListItemDto` 增加必返 `lineSummary`。
- [x] 扩展 `PurchaseOrderListItem` 内部类型。
- [x] 扩展 `PURCHASE_ORDER_LIST_SELECT`，一次查询取得全部明细及当前 READY 主图。
- [x] 新增 `mapLineSummary()` 并接入 `mapListItem()`。
- [x] 重新运行 T1，确认通过。
- [x] 运行服务端类型检查，排除 Prisma select 与 DTO 漂移。

验证命令：

```bash
pnpm -C server test -- purchase-order-query.service.spec.ts --runInBand
pnpm -C server typecheck
```

### T3：固化采购列表主图授权失败测试

目标：先证明当前缺少列表只读图片端点与历史采购关系校验。

- [x] 扩展 `purchase-order-product-image.service.spec.ts`：
  - 合法采购明细可解析媒体内容；
  - 订单 / 明细 / 产品 / 媒体任一不匹配时返回 `PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND`；
  - `CUSTOM` 明细拒绝读取；
  - 产品后续停用不影响已保存订单的历史主图读取。
- [x] 扩展 `purchase-orders.controller.spec.ts`：
  - GET / HEAD 路径存在；
  - 权限为 `purchase-orders:read`；
  - operationId 与稳定错误码正确；
  - GET 与 HEAD 正确调用图片服务。
- [x] 运行定向测试并记录预期失败原因：缺少端点与 `resolveListPreview()`。

验证命令：

```bash
pnpm -C server test -- purchase-order-product-image.service.spec.ts purchase-orders.controller.spec.ts --runInBand
```

### T4：实现采购列表主图只读端点

目标：以最小改动让 T3 通过，且不复用创建采购授权。

- [x] 新增 `PurchaseOrderLineProductImageParamDto`。
- [x] 在 `PurchaseOrderProductImageService` 新增 `resolveListPreview()`，校验已保存采购明细与当前 READY 主图关系。
- [x] 在 `PurchaseOrdersController` 新增列表主图 GET / HEAD 端点。
- [x] 使用 `purchase-orders:read` 与 `ApiProductMediaContentContract`。
- [x] 重新运行 T3，确认通过。
- [x] 联合运行 T1 至 T4 的服务端定向测试。

验证命令：

```bash
pnpm -C server test -- purchase-order-query.service.spec.ts purchase-order-product-image.service.spec.ts purchase-orders.controller.spec.ts --runInBand
```

### T5：同步 OpenAPI 与 Web 生成契约

目标：让 Web 只消费服务端生成类型，不手写重复接口。

- [x] 执行根契约同步。
- [x] 检查 OpenAPI snapshot 中 `PurchaseOrderListItemDto.lineSummary` 与新 GET / HEAD 路径。
- [x] 检查 Web 生成类型包含 `PurchaseOrderLinePreviewDto`。
- [x] 运行契约一致性检查。

验证命令：

```bash
node --run contract:sync
node --run contract:check
```

### T6：固化 Web 产品列失败测试

目标：先证明采购列表尚未复用销售列表的产品图片组结构。

- [x] 扩展 `web/apps/qsmds-arco/test/views/purchase-order-pages.test.ts` 或现有最贴近的采购列表页面测试：
  - “产品”列在“供应商”之后、“采购金额”之前；
  - 最小列宽为 `160px`；
  - 桌面与移动端均使用 `ImageGroup`；
  - `max-count=3`、`size=40`、`radius=md`；
  - Tooltip 使用 `QsGoodTooltipContent`；
  - 有图项按 `lineId` 稳定关联，无图项被过滤。
- [x] 复用 `ImageGroup` 既有溢出测试，并由采购列表测试固定 `lineSummary` 的有图过滤与三槽配置。
- [x] 运行定向测试并记录预期失败原因：缺少产品列与组件组合。

验证命令：

```bash
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-pages.test.ts
```

### T7：实现桌面与移动采购产品预览

目标：以最小改动让 T6 通过，并保持全部采购与待办采购一致。

- [x] 在采购列表页面引入 `ImageGroup`、`ImageGroupItem`、`QsGoodTooltipContent` 和生成 DTO 类型。
- [x] 新增 `productImageItems()` 与 `resolveProductPreview()`。
- [x] 在供应商后增加 `productSummary` 列，宽度为 `160px`。
- [x] 增加桌面 `cell-productSummary` slot。
- [x] 在移动卡片供应商后增加跨两列产品图片组。
- [x] 保持 `max-count=3` 的既有折叠语义：超过三个有图产品时显示两张实图和一个 `+N` 槽位。
- [x] 重新运行 T6，确认通过。
- [x] 运行采购列表相关 Web 测试与类型检查。

验证命令：

```bash
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-list.logic.test.ts apps/qsmds-arco/test/api/purchase-orders.test.ts
pnpm -C web typecheck
```

### T8：回归检查与浏览器验收

目标：证明改动不破坏采购列表、契约和仓库治理，并在真实页面确认视觉与请求行为。

- [x] 运行服务端采购订单相关测试。
- [x] 运行 Web 采购订单相关测试。
- [x] 运行根完整检查。
- [x] 启动或确认前后端运行在既有端口 `3000 / 9000`。
- [x] 验证 Server `/api/health` 中数据库为 `up`，Web 返回 HTTP 200。
- [x] 浏览器验收“全部采购”与“待办采购”：
  - 产品列位于供应商与采购金额之间；
  - 当前数据库产品主图成功加载；
  - Tooltip 展示正确采购产品名称；
  - 图片请求使用采购列表只读端点。
- [x] 通过页面测试验收移动布局、无图过滤与稳定明细 ID 关联。
- [x] 通过 `ImageGroup` 既有测试验收三槽折叠语义；列表查询一次返回摘要，不发起逐订单详情 JSON 请求。

验证命令：

```bash
pnpm -C server test -- purchase-order-query.service.spec.ts purchase-order-product-image.service.spec.ts purchase-orders.controller.spec.ts --runInBand
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-list.logic.test.ts apps/qsmds-arco/test/api/purchase-orders.test.ts
node --run contract:check
node --run check
curl --fail --silent http://127.0.0.1:3000/api/health
curl --fail --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:9000/
```

### T9：Git 收口

目标：按可审计的小步提交保存本功能，不推送远端。

- [x] 检查 `git status --short`、`git diff --check` 和完整 diff。
- [x] 提交规格与服务端契约 / 图片读取实现：

```text
feat: 添加采购列表产品摘要契约
```

- [x] 提交 Web 产品列与相关测试：

```text
feat: 展示采购列表产品主图
```

- [x] 确认工作树无本任务遗漏，并报告提交 SHA 与所有验证结果。
- [x] 不 push、不创建 PR、不部署。

## 3. 完成定义

只有同时满足以下条件，才能声明完成：

1. 服务端、Web 和 OpenAPI 的定向测试全部通过；
2. `node --run check` 通过；
3. 全部采购、待办采购及移动布局完成真实浏览器验收；
4. 列表无 N+1 详情请求，图片端点权限为 `purchase-orders:read`；
5. 数据库 schema、销售订单列表和公共组件 API 均未改变；
6. 两个约定 Git 提交均创建成功，且未推送远端。
