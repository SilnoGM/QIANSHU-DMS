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
] as const

export type ManagementPermissionCode =
  (typeof MANAGEMENT_PERMISSION_CODES)[number]
