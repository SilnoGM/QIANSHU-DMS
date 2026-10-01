/**
 * 内置系统管理员角色的稳定技术标识。
 *
 * 该值必须与首个认证迁移中的 seed 保持一致，业务代码不得依赖角色显示名称。
 */
export const SYSTEM_ADMIN_ROLE_CODE = 'system_admin' as const

/**
 * 产品管理当前完整权限边界。
 *
 * 查看详情复用读取权限；独立编辑页面和 PATCH operation 使用更新权限。状态仍随
 * 产品资料一并编辑，本期不拆分启停权限。
 */
export const PRODUCT_MANAGEMENT_PERMISSION_CODES = [
  'products:read',
  'products:create',
  'products:update',
] as const

/**
 * 产品媒体内容的独立读取权限。
 *
 * 该权限不隐式要求 products:read，使未来订单等已确认领域可以在自己的授权边界内读取产品媒体；
 * 产品媒体写入仍由 products:update 控制。
 */
export const PRODUCT_MEDIA_PERMISSION_CODES = ['product-media:read'] as const

/**
 * 资金账户管理的完整人工权限边界。
 *
 * 该域权限自 2026-10-01（迁移 `20261001140000_fund_account_permissions_delegable`）起
 * 可委派给普通角色，财务工作台的账户管理整组需要它们；服务端 PermissionGuard 与审计
 * 逻辑不变，仍按角色权限集合判定。同一 Server 内业务域动账不使用这些人工权限，
 * 而由可信来源白名单约束。
 */
export const FUND_ACCOUNT_PERMISSION_CODES = [
  'fund-accounts:read',
  'fund-accounts:create',
  'fund-accounts:update-share-rate',
  'fund-accounts:manual-adjust',
  'fund-transactions:reverse',
  'fund-posting-types:manage',
  'fund-business-sources:manage',
] as const

/**
 * 销售订单域按读取、创建、通用更新、收款和凭证拆分权限。
 *
 * 付款状态由收款事实派生，不单独暴露手工写权限；凭证内容读取随订单读取权限，
 * 上传和关联则由 document 权限控制。
 */
export const SALES_ORDER_PERMISSION_CODES = [
  'sales-orders:read',
  'sales-orders:create',
  'sales-orders:update',
  'sales-orders:payment',
  'sales-orders:document',
] as const

/** 财务读取、审核与纠错分别授予；不隐式附送资金管理权限。 */
export const SALES_RECEIPT_PERMISSION_CODES = [
  'sales-receipts:read',
  'sales-receipts:review',
  'sales-receipts:void',
] as const

/**
 * 采购订单域按读取、创建、备货创建、审核、通用更新、付款和凭证拆分权限。
 *
 * `purchase-orders:create-stock` 在数据库中标记为 systemOnly，只能保留给
 * `system_admin`；服务端仍必须在创建事务中复核该能力，不能只依赖前端隐藏按钮。
 * `purchase-orders:review` 默认仅授予系统管理员，但允许通过角色权限管理配置。
 */
export const PURCHASE_ORDER_PERMISSION_CODES = [
  'purchase-orders:read',
  'purchase-orders:create',
  'purchase-orders:create-stock',
  'purchase-orders:review',
  'purchase-orders:update',
  'purchase-orders:payment',
  'purchase-orders:document',
] as const

/**
 * 唛头规则绑定配置与编号维护权限分离：读取可查看供应商绑定，保存同时要求读取与修改。
 * 该域由 `20260906090104_supplier_shipping_mark_rule_bindings` 建入，补登记以对齐数据库授权目录。
 */
export const PURCHASE_SHIPPING_MARK_PERMISSION_CODES = [
  'purchase-shipping-marks:read',
  'purchase-shipping-marks:update',
] as const

/** 包装费用提报、财务读取与付款分别授权，不附带采购或销售整单权限。 */
export const PACKAGING_COST_PERMISSION_CODES = [
  'packaging-costs:create',
  'packaging-costs:read',
  'packaging-costs:pay',
] as const

export const SUPPLIER_PAYMENT_PROFILE_PERMISSION_CODES = [
  'supplier-payment-profiles:read',
  'supplier-payment-profiles:update',
] as const

/** 柜次资料维护独立授权，不附带资金账户操作权限。 */
export const CONTAINER_BATCH_PERMISSION_CODES = [
  'container-batches:read',
  'container-batches:create',
  'container-batches:update',
] as const

/** 顺联航账单：导入、查看与核对；顺序与权限目录按 code 的排序一致。 */
export const SLH_BILL_PERMISSION_CODES = [
  'slh-bills:create',
  'slh-bills:read',
  'slh-bills:reconcile',
] as const

/**
 * 工作台准入权限：决定顶级导航分组的可见与直接 URL 准入。
 *
 * 业务域权限码会在工作台之间共享（`purchase-orders:payment`、`purchase-orders:read`
 * 同时服务运营、财务与采运工作台），用它做分组门槛会让一个角色看到多个工作台。
 * 准入码与业务域权限解耦：分组门槛只声明准入码，组内页面仍按业务码收敛。
 * 由 `20261001190000_workbench_access_permissions` 建入并授予内置 `system_admin`，
 * 普通角色由角色权限管理自行勾选。
 */
export const WORKBENCH_ACCESS_PERMISSION_CODES = [
  'workbench:operations',
  'workbench:finance',
  'workbench:purchase-transport',
] as const

/**
 * 首期用户、角色与审计管理功能使用的完整权限目录。
 *
 * 顺序与数据库 seed 一致，既便于契约审查，也避免各业务模块各自拼写字符串。
 * 新权限必须同时更新迁移、设计文档与此处，不能只在运行时代码中隐式出现。
 */
export const MANAGEMENT_PERMISSION_CODES = [
  'users:read',
  'users:create',
  'users:update',
  'users:enable',
  'users:disable',
  'users:assign-roles',
  'users:reset-password',
  'roles:read',
  'roles:create',
  'roles:update',
  'roles:assign-permissions',
  'audit:read',
  'regions:read',
  'regions:create',
  'regions:update',
  'regions:enable',
  'regions:disable',
  'currencies:read',
  'currencies:create',
  'currencies:update',
  'currencies:enable',
  'currencies:disable',
  'exchange-rates:read',
  'exchange-rates:create',
  'exchange-rates:update',
  'numbering-rules:read',
  'numbering-rules:create',
  'numbering-rules:update',
  'numbering-rules:publish',
  'numbering-rules:enable',
  'numbering-rules:disable',
  'numbering-rules:read-issuances',
  'dictionaries:read',
  'dictionaries:create',
  'dictionaries:update',
  'dictionaries:enable',
  'dictionaries:disable',
  ...PRODUCT_MEDIA_PERMISSION_CODES,
  ...PRODUCT_MANAGEMENT_PERMISSION_CODES,
  ...FUND_ACCOUNT_PERMISSION_CODES,
  ...SALES_ORDER_PERMISSION_CODES,
  ...SALES_RECEIPT_PERMISSION_CODES,
  ...PURCHASE_ORDER_PERMISSION_CODES,
  ...PURCHASE_SHIPPING_MARK_PERMISSION_CODES,
  ...PACKAGING_COST_PERMISSION_CODES,
  ...SUPPLIER_PAYMENT_PROFILE_PERMISSION_CODES,
  ...CONTAINER_BATCH_PERMISSION_CODES,
  ...SLH_BILL_PERMISSION_CODES,
  ...WORKBENCH_ACCESS_PERMISSION_CODES,
] as const

export type ManagementPermissionCode =
  (typeof MANAGEMENT_PERMISSION_CODES)[number]
