# 产品查看与编辑需求规格

## 1. 文档状态

- 状态：Requirements 已确认，等待本地实施验收
- 确认日期：2026-08-13
- 适用范围：`server/`、`web/apps/qsmds-arco`
- 实施分支：`feat/admin-product-management`
- 关联规格：`specs/product-list/`、`specs/product-create/`

## 2. 目标与边界

本期把产品列表中的“查看”“编辑”占位轻提示替换为真实能力：查看通过详情 Drawer
读取最新 Product，编辑通过独立页面修改既有业务字段，并使用 `expectedVersion` 防止并发
覆盖。产品编号、媒体和审计身份字段保持只读；图片、视频上传继续延期。

## 3. 已确认业务决策

1. 查看使用右侧 `QsGenericDrawer`，桌面 `xl`、窄屏全宽。
2. 编辑使用 `/admin/products/:productId/edit` 独立页面。
3. 可编辑字段为名称、状态、供应商、三组价格和有序属性。
4. `id`、`productNo`、媒体和审计字段不可编辑。
5. 三个状态可以相互转换；目标为 `ACTIVE` 时必须具有有效供应商。
6. 目标仍为 `ACTIVE` 时重验全部供应商与货币；从 `ACTIVE` 降级为非 Active 时允许退出，仅校验本次主动修改的引用。
7. `DRAFT/INACTIVE` 未修改的停用或未知历史供应商可以保留。
8. 新增 `products:update` 权限和 `PRODUCT_UPDATED` 审计事件。
9. 编辑成功后返回产品列表并重新加载。
10. 已授权在隔离验证和待迁移集合检查通过后应用本期 Migration 到持久开发数据库 `qianshu_dms_dev`。

## 4. Requirements 与 Acceptance Criteria

### Requirement 1 - 产品详情

**User Story:** 作为产品维护人员，我希望从列表查看一条产品的完整最新资料，以便核对价格、供应商、属性、媒体和审计信息。

#### Acceptance Criteria

1. 当用户点击“查看”时，Web 应打开详情 Drawer 并通过 `GET /api/products/{productId}` 加载最新数据。
2. 当用户具有 `products:read` 时，Server 应返回完整 `ProductListItemDto`；否则应拒绝请求。
3. 当 Product 不存在时，Server 应返回 `404 PRODUCT_NOT_FOUND`，Drawer 应显示可恢复错误态。
4. 当历史供应商已停用或未知时，系统应保留 raw value 并明确展示 `DISABLED/UNKNOWN` 状态。
5. 当用户具有 `products:update` 时，Drawer 应显示“编辑产品”；否则不得显示编辑入口。

### Requirement 2 - 产品编辑与字段边界

**User Story:** 作为具有编辑权限的维护人员，我希望在完整表单中修改产品业务资料，同时不会误改产品身份或媒体。

#### Acceptance Criteria

1. 当用户访问 `/admin/products/:productId/edit` 时，页面应同时要求可信的读取与更新能力。
2. 当用户编辑 Product 时，系统应允许修改 `name/status/supplierValue/twdSalePrice/myrSalePrice/purchaseCost/attributes`。
3. 当请求携带 `id/productNo/mainImage/images/videos` 或审计字段时，Server 应按未知字段拒绝。
4. 当提交字段规范化后与当前值相同时，Server 应返回当前 Product，且不得增加版本或写审计。
5. 当更新成功时，系统应更新 `updatedByUserId/updatedAt`、令 `version + 1`，并返回最新 Product。

### Requirement 3 - 状态与外部引用

**User Story:** 作为产品维护人员，我希望历史产品仍可维护，同时 Active 产品始终满足当前供应商和币种规则。

#### Acceptance Criteria

1. 当目标状态为 `ACTIVE` 时，系统应要求非空且当前有效的供应商，并重验三组币种与金额精度。
2. 当 `ACTIVE` 产品的历史引用已经失效且用户将其降为 `DRAFT/INACTIVE` 时，系统应允许降级。
3. 当目标状态为非 Active 且供应商未修改时，系统应允许保留停用或未知历史 raw value。
4. 当用户主动修改供应商时，系统应只接受当前有效值或 `null`。
5. 当用户修改 Money 字段时，系统应验证对应币种当前启用及金额符合 `minorUnit`。

### Requirement 4 - 乐观并发与失败恢复

**User Story:** 作为并发维护产品的用户，我希望系统阻止旧页面覆盖他人的最新修改，并在网络结果未知时安全对账。

#### Acceptance Criteria

1. 当更新请求到达时，Server 应先锁定 Product 行，再比较 `expectedVersion`。
2. 当版本不一致时，Server 应返回 `409 PRODUCT_STATE_CHANGED`，不得写 Product 或 Audit。
3. 当两个相同版本请求并发到达时，最多一个请求应成功。
4. 当 PATCH 因网络或 `5xx` 结果未知时，Web 应先 GET 最新详情，不得自动重放 PATCH。
5. 当 GET 发现版本恰为 `expectedVersion + 1` 且提交字段全部匹配时，Web 应收敛为成功；否则应进入未知结果并要求人工核查。

### Requirement 5 - 权限、审计与事务

**User Story:** 作为管理员和审计人员，我希望产品编辑经过真实 RBAC，并留下不泄露业务内容的原子审计。

#### Acceptance Criteria

1. 当实施本期能力时，系统应新增 `products:update` 并授予内置 `system_admin`。
2. 当 Product 发生真实更新时，Server 应在同一事务写入 `PRODUCT_UPDATED`。
3. 当 Audit 写入失败时，Product 更新应整体回滚。
4. 审计元数据应只包含 `productNo/changedFields/previousVersion/version/previousStatus/status`。
5. 审计不得记录金额、属性内容、供应商 raw value、媒体 URL 或完整请求体。

### Requirement 6 - Web 交互与可访问性

**User Story:** 作为桌面或移动端用户，我希望查看和编辑界面与既有后台一致，并能通过键盘安全完成操作。

#### Acceptance Criteria

1. 详情和编辑应复用现有 Fa/Qs、语义 Token、`Noto Sans SC` 与 `Noto Sans Mono`。
2. 桌面编辑页应使用约 `8/4` 非对称双栏；窄屏应收敛为无横向滚动的单列。
3. 图片应使用 `ImageGroup`，金额应使用 `AmountDisplay/MoneyInput`，供应商应使用 `QsDictionarySelect`。
4. 当提交进行中时，所有可变字段和页面操作应统一锁定并暴露 busy 状态。
5. 当存在未保存修改且用户离开时，页面应要求确认。
6. 错误应包含文字说明、字段级反馈和安全 requestId，并把焦点移动到首个错误或状态标题。
7. 窄屏主要触控目标应不小于 44px，并支持 Dark 与 Reduced Motion。

### Requirement 7 - 公共 API 与安全

#### Acceptance Criteria

1. 系统应新增 `products_get_by_id` 与 `products_update` 两个 operation，且不得新增其他 Product operation。
2. GET 应要求 Session、`products:read` 和 private no-store。
3. PATCH 应要求 Session、`products:update`、CSRF、private no-store，并禁止客户端自动重试。
4. PATCH 至少应包含一个可编辑字段和 `expectedVersion`；金额与属性继续使用严格字符串和白名单校验。
5. 内部错误不得泄露 SQL、连接信息、Cookie、Token 或完整 Payload。

### Requirement 8 - 自动化与数据库验收

#### Acceptance Criteria

1. Server 单测应覆盖 DTO、规范化、行锁、no-op、并发、依赖校验、审计和错误映射。
2. 隔离 PostgreSQL E2E 应覆盖详情、更新、权限、CSRF、历史引用、并发和原子回滚。
3. Web 测试应覆盖 API、路由、详情 Drawer、表单 diff、冲突、未知结果和创建回归。
4. 真实 Chrome 应覆盖查看、编辑、中文审计、窄屏、Dark、Reduced Motion 与触控尺寸。
5. 应用持久开发数据库前，系统应证明待迁移集合精确等于本期 Migration；发现额外待迁移或 drift 时必须停止。
6. 应用后应验证权限、管理员授权、审计 enum 和 Product 行数不变量，并重启前后端验证健康状态。

## 5. UI Design Specification

- Purpose：在不丢失列表上下文的情况下查看完整产品，并安全编辑复杂数据。
- Aesthetic Direction：`Industrial/utilitarian`。
- Color Palette：Ink `#0F172A`、Paper `#FFFFFF`、Mist `#F1F5F9`、Functional accent `#0F766E`、Destructive `#DC2626`；实现只消费现有语义 Token。
- Typography：`Noto Sans SC`；编号、金额、币种和 UUID 使用 `Noto Sans Mono`。
- Layout：详情 Drawer 约 `7/5` 信息区；编辑页 `8/4` 非对称双栏；窄屏单列。

## 6. 非目标

- 媒体上传、URL 输入、排序或删除。
- Product 删除、快捷状态 API、批量编辑、复制、SKU、库存、分类或导入导出。
- Product 表字段、`product_status` 或公共 Qs/Fa 组件契约变更。
- Supplier Model/API/Store 或第三方依赖。
- push、PR、merge、部署或其他数据库环境。
