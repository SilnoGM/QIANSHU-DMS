import type { MachineViewingDto } from '../api/generated/types.gen'
import type { QsStatusTagTone } from './status-tag-tone'

export type MachineViewingStatusValue = MachineViewingDto['status']

/**
 * 状态展示元信息与接口枚举一一对应：标签文案走 i18n，颜色只选现有五档语义色。
 * 状态流转入口尚未开放，这里的映射只服务于列表与反馈弹窗的只读展示。
 */
export const MACHINE_VIEWING_STATUS_META: Readonly<Record<
  MachineViewingStatusValue,
  { readonly labelKey: string, readonly tone: QsStatusTagTone }
>> = {
  PENDING_APPOINTMENT: { labelKey: 'machineViewing.status.PENDING_APPOINTMENT', tone: 'warning' },
  APPOINTED: { labelKey: 'machineViewing.status.APPOINTED', tone: 'info' },
  FEEDBACK_GIVEN: { labelKey: 'machineViewing.status.FEEDBACK_GIVEN', tone: 'success' },
  CANCELLED: { labelKey: 'machineViewing.status.CANCELLED', tone: 'neutral' },
}

export function machineViewingStatusMeta(status: MachineViewingStatusValue) {
  return MACHINE_VIEWING_STATUS_META[status]
}
