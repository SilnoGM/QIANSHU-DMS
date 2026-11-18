# 产品别名与唛头拼接实施记录

## 1. 文档状态

- 状态：本地实施完成，待页面级验收
- 实施日期：2026-11-17 至 2026-11-18
- 实施分支：`产品别名与唛头拼接`
- 需求文档：[requirements.md](requirements.md)
- 技术设计：[design.md](design.md)

## 2. 已实施范围

### 2.1 数据库与权限

- 新增 `user_product_aliases` 表：`product_id`/`user_id` 外键、`alias VARCHAR(36)`、`UNIQUE(product_id, user_id)`、别名 trim/长度/控制字符/`×` 检查与 `user_id` 索引。
- 新增审计枚举 `PRODUCT_ALIAS_UPDATED`、`PRODUCT_ALIAS_CLEARED`。
- 新增权限 `product-aliases:manage`（UUID `...215`），授予 `system_admin`；`operations_staff` 存在时增量授予 `products:read`、`product-media:read`、`product-aliases:manage`。
- 新增客户名 `char_length <= 24` 与货件唛头 `char_length <= 30` 的数据库 CHECK；迁移以存量预检失败关闭，不回填既有业务行。
- 迁移：`server/prisma/migrations/20261117130000_user_product_aliases/migration.sql`。

### 2.2 别名 API

- `GET /api/product-aliases/mine`
- `PUT /api/product-aliases/mine/:productId`
- `DELETE /api/product-aliases/mine/:productId`
- 只从登录上下文取用户；支持批量 `productIds`（逗号分隔，最多 100 个）。
- 设置/清除写入审计；相同值重复保存不写审计；产品不存在返回 `PRODUCT_NOT_FOUND`。
- 新增 `ProductAliasesModule`，并向采购模块导出 `ProductAliasService` 供详情和应付批量解析。

### 2.3 唛头格式

- `shipping-mark-label.ts` 改为货件级生成：
  - SALES_LINKED：`【唛头】展示名+展示名（出单前缀-客户名）`
  - STOCK：`【唛头】产品名+产品名（公司囤货采购）`
  - 目录产品按 `productId` 聚合数量；自定义行按行独立。
  - 数量 >1 输出 `×N`；别名优先，否则采购行产品名。
  - 别名块 438 字符上限，按整项截断并加 `…`；完整唛头 500 字符上限。
- 采购详情新增 `parts[].shippingMarkSuffix`（可选字段，仅在有货件唛头时返回）；复制文案直接消费该字段。
- 采购单图片快照改为每货件自己的后缀；模板版本 `5 → 6`；货件项按 `lineNumber` 排序。
- 应付/对账单按每货件产品集合和出单人别名生成 `shippingMarks`；批量读取别名，避免 N+1；`shippingMarkSuffix` 保留为销售级兼容字段。
- 对账单图片单条唛头校验 `300 → 500`。
- 审核时增加货件唛头 30 字符校验，超限返回 `PURCHASE_ORDER_SHIPPING_MARK_TOO_LONG`。

### 2.4 运营产品库页面

- 新增路由 `/qs-operations/products`，菜单“产品库”，单页菜单，位于“看机预约”之前。
- 图片优先方形卡片库：1:1 `object-contain`、thumb 变体、懒加载、无图占位、状态标签。
- 卡片展示名称、编号、分类/产品头、供应商、台币/马币/成本、别名标签、查看详情。
- 顶部筛选：关键字、供应商、分类、产品头、状态（默认启用）、重置。
- `FaPagination` 每页 24/48/96。
- 详情抽屉展示完整资料、价格、媒体、属性/备注、折叠审计；不显示编辑产品。
- 别名弹窗支持保存/清除、36 字符计数、控制字符/`×` 校验和历史影响提示。
- 无媒体权限占位；无别名权限隐藏别名入口；无别名显示“使用产品名”。

## 3. 验证结果

### 3.1 已通过

- Server 单测：`445` 个套件、`4753` 项通过（含类型检查与 lint）。
- Web API/视图测试：`2236` 项通过。
- Web 类型检查：`typecheck:scripts` 与 `typecheck:app` 通过。
- Web ESLint/Stylelint：通过。
- 根治理：`node --run test:root` 717 项通过。
- 契约：`contract:sync` 与 `contract:check` 通过。
- 定向隔离数据库 E2E：`product-alias`、`auth-api`、`auth-schema`、`seed`、`contract`、`purchase-order-parts`、`purchase-payable` 共 7 个套件、80 项通过。
- 单独复跑：`packaging-cost` 19 项、`purchase-order-service` 10 项、`purchase-order-review-marks`（含新的 22 字符基础码与 30 字符拒绝用例）通过。
- 迁移在隔离 PostgreSQL 连续部署两次，无待执行项；191 条迁移基线一致。

### 3.2 未完成或未通过

- 全量 `ci:server-e2e` 在同一进程运行到后段出现 Node OOM（`FATAL ERROR: Ineffective mark-compacts near heap limit`）；同时出现 `packaging-cost` 与 `purchase-order-service` 两个跨套件偶发失败，单独复跑均通过。该组合结果不作为全绿结论。
- 页面级浏览器验收未执行：需要真实账号、图片与产品数据，验证筛选、卡片、详情抽屉、别名保存/清除和 500 字符对账单实际出图。
- 未对本地开发库或生产库执行迁移；只在隔离临时 PostgreSQL 验证。
- 未做真实采购单图片/对账单的亮色/暗色人工出图核对（渲染器单测通过）。

## 4. 实现偏差与说明

- `purchase_order_parts.shipping_mark_text` 的 30 字符 CHECK 允许空串（`<= 30`），避免历史空白值阻断迁移；正常审核仍要求非空。
- 审计枚举值在同一事务内不可见，迁移 `DO` 块不复查两个新枚举值，仅依靠 `ALTER TYPE ... ADD VALUE IF NOT EXISTS` 的幂等性。
- `shippingMarkSuffix` 在共享采购货件 DTO 中为可选字段，只有采购详情返回；工厂发货和入仓读取不承担该字段。
- 现有采购审核 E2E 的 64 字符基础码用例改为 22 字符基础码，并新增超 30 字符拒绝用例，符合新业务上限。
- 本期未新增服务端重复产品校验或数据库唯一约束；目录产品在货件内按 `productId` 聚合兜底，自定义同名行保留为多个条目。

## 5. 后续动作

1. 页面级浏览器验收：产品库筛选/分页/详情/别名、无图占位、无媒体权限、无别名权限。
2. 真实渲染验收：采购单图片与对账单图片在亮色/暗色、最长 500 字符唛头下的布局和高度。
3. 在获得单独授权后，将迁移应用到开发库；生产迁移、发布与部署不在本次范围。
4. 如需彻底消除 `packaging-cost` / `purchase-order-service` 跨套件偶发失败，应单独排查临时 schema 隔离器的测试顺序，不与本功能混改。
