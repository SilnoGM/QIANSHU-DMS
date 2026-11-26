/**
 * 采购审核自动托管的固定参数。
 *
 * 执行账号由迁移创建，保持无角色：数据范围按「无 data-scope 权限即全量」的既有
 * 契约解析，同时没有任何页面或接口权限。任务、重试与租约参数集中在这里，
 * 扫描命令与服务端校验共用同一份真值。
 */
export const PURCHASE_AUTO_REVIEW_SETTINGS_ID = 'default' as const

/** 迁移 20261126130000_purchase_auto_review 创建的系统账号，审计与历史外键使用。 */
export const PURCHASE_AUTO_REVIEW_ACTOR_ID =
  '00000000-0000-4000-8000-000000002449' as const

/** 自动审核写入状态历史与审计的原因文案。 */
export const PURCHASE_AUTO_REVIEW_REASON = '系统自动托管审核通过'

/** 单轮最多处理的订单数，避免集中建单时长时间占用渲染与存储。 */
export const PURCHASE_AUTO_REVIEW_DEFAULT_LIMIT = 5
export const PURCHASE_AUTO_REVIEW_MAX_LIMIT = 5

/**
 * 最多尝试次数（首次执行 + 3 次重试）；用尽后转人工并通知审核人。
 * 计数在领取任务时递增，因此最后一次失败时 attempts 等于本值。
 */
export const PURCHASE_AUTO_REVIEW_MAX_ATTEMPTS = 4

/** 第 1/2/3 次失败后的等待时间；长度等于 MAX_ATTEMPTS - 1。 */
export const PURCHASE_AUTO_REVIEW_RETRY_DELAYS_MS = [
  60_000,
  300_000,
  900_000,
] as const

/** 领取租约；进程崩溃后超过该时间的 PROCESSING 任务可被重新领取。 */
export const PURCHASE_AUTO_REVIEW_LEASE_MS = 10 * 60_000
