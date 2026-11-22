/**
 * 看机预约的稳定契约：地点、机型、时段、权限码与字段长度。
 *
 * 三个枚举同时约束数据库枚举、DTO 与前端选项，任何一处新增都必须同步迁移。
 */
export const MACHINE_VIEWING_SITE_VALUES = [
  'NEW_TAIPEI_LINKOU',
  'TAICHUNG_LONGJING',
] as const
export type MachineViewingSiteValue = (typeof MACHINE_VIEWING_SITE_VALUES)[number]

export const MACHINE_VIEWING_MACHINE_TYPE_VALUES = [
  'MINI_TILLER',
  'SHREDDER',
  'INCINERATOR',
] as const
export type MachineViewingMachineTypeValue = (typeof MACHINE_VIEWING_MACHINE_TYPE_VALUES)[number]

export const MACHINE_VIEWING_PERIOD_VALUES = ['AM', 'PM'] as const
export type MachineViewingPeriodValue = (typeof MACHINE_VIEWING_PERIOD_VALUES)[number]

/** 状态与数据库枚举一一对应；新登记固定为待预约，之后按下方顺序流转。 */
export const MACHINE_VIEWING_STATUS_VALUES = [
  'PENDING_APPOINTMENT',
  'APPOINTED',
  'FEEDBACK_GIVEN',
  'CANCELLED',
] as const
export type MachineViewingStatusValue = (typeof MACHINE_VIEWING_STATUS_VALUES)[number]

/** 状态视图在 ALL 之外复用真实状态值；计数接口不接受状态筛选。 */
export const MACHINE_VIEWING_STATUS_FILTER_VALUES = [
  'ALL',
  ...MACHINE_VIEWING_STATUS_VALUES,
] as const
export type MachineViewingStatusFilterValue = (typeof MACHINE_VIEWING_STATUS_FILTER_VALUES)[number]

/** 可主动流转的目标状态；当前状态由服务端按行锁读取后裁决。 */
export const MACHINE_VIEWING_TRANSITION_TARGET_VALUES = [
  'APPOINTED',
  'FEEDBACK_GIVEN',
  'CANCELLED',
] as const
export type MachineViewingTransitionTargetValue = (typeof MACHINE_VIEWING_TRANSITION_TARGET_VALUES)[number]

/** 只有未产生反馈的预约允许修改内容与取消；已反馈、已取消都锁定。 */
export const MACHINE_VIEWING_EDITABLE_STATUS_VALUES = [
  'PENDING_APPOINTMENT',
  'APPOINTED',
] as const

export const MACHINE_VIEWING_FEEDBACK_MAX_LENGTH = 500
export const MACHINE_VIEWING_CANCEL_REASON_MAX_LENGTH = 500

export const MACHINE_VIEWING_PERMISSION_READ = 'machine-viewings:read'
export const MACHINE_VIEWING_PERMISSION_CREATE = 'machine-viewings:create'
export const MACHINE_VIEWING_PERMISSION_UPDATE = 'machine-viewings:update'

/** 编号域规则：MV/YYYYMMDD-####，按年重置；规则由建号迁移写入并启用。 */
export const MACHINE_VIEWING_NO_RULE_CODE = 'MACHINE_VIEWING_NO'
export const MACHINE_VIEWING_NO_CONSUMER_CODE = 'MACHINE_VIEWING.CREATE'

export const MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH = 128
export const MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH = 64
export const MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH = 64

/** 小时只在已选时段内取值 1–12；空值表示当天时段未定，不约定到具体几点。 */
export const MACHINE_VIEWING_HOUR_MIN = 1
export const MACHINE_VIEWING_HOUR_MAX = 12
