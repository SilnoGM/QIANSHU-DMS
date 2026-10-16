/**
 * 顶级工作台分组的准入权限码。
 *
 * 业务域权限码会在工作台之间共享：`purchase-orders:payment` 既是运营侧「申请付款」，
 * 也是财务侧「采购付款」的门槛；`purchase-orders:read` 同时属于运营与采运工作台。
 * 用共享业务码做分组门槛，一个角色会同时看到多个工作台；反向收紧业务码又会破坏
 * 角色在自己工作台内的既有功能。因此工作台本身的可见与准入改由独立权限码决定：
 *
 * - 分组门槛只声明准入码，它会被 Route Store 覆盖到组内一级子路由，
 *   同时约束菜单过滤与直接 URL 准入；
 * - 组内页面继续用业务码收敛（叶子 `meta.auth` 与页面内 `auth()` 都不变）。
 *
 * 四条准入码都是可分配权限，由角色配置决定谁能进入哪个工作台；新增工作台时
 * 必须同步服务端权限目录迁移，不能只在前端出现。
 *
 * 管理员工作台同样只认准入码：它曾用「四个子模块读取权限的并集」做门槛，任何业务
 * 角色一旦获得并集中的一条（运营与财务的 `exchange-rates:read` 就命中过）都会看到
 * 并进入该工作台，业务读码与管理区域准入因此必须分开。
 */
export const OPERATIONS_WORKBENCH_PERMISSION = 'workbench:operations' as const
export const FINANCE_WORKBENCH_PERMISSION = 'workbench:finance' as const
export const PURCHASE_TRANSPORT_WORKBENCH_PERMISSION = 'workbench:purchase-transport' as const
export const ADMIN_WORKBENCH_PERMISSION = 'workbench:admin' as const

/**
 * 系统管理（审计日志与应用配置）是管理员专属区域，沿用系统专用权限 `audit:read` 收敛。
 *
 * 该权限在权限目录里 `system_only = true`，只授予内置 `system_admin`，普通角色无法分配，
 * 因此「只有管理员可进入」由权限目录保证，不新增额外准入码。
 */
export const SYSTEM_MANAGEMENT_PERMISSION = 'audit:read' as const
