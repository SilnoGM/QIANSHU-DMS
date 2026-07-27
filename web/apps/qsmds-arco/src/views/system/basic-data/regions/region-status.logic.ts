import type { RegionDto } from '@/api/generated/types.gen'

export type RegionStatusAction = 'disable' | 'enable'
export type RegionStatusPathNode = Pick<RegionDto, 'code' | 'id' | 'name'>
export type RegionStatusTarget = Pick<
  RegionDto,
  'code' | 'id' | 'level' | 'name'
>

export interface RegionStatusChangeModalProps {
  action: RegionStatusAction
  ancestorPath: readonly RegionStatusPathNode[]
  error?: null | string
  modelValue: boolean
  region: null | RegionStatusTarget
  requestId?: string
  submitting?: boolean
}

export interface RegionStatusChangeRequest {
  action: RegionStatusAction
  regionId: string
}

export interface RegionStatusChangeCopy {
  confirmLabel: string
  consequence: string
  title: string
}

const REGION_STATUS_CHANGE_COPY: Readonly<
  Record<RegionStatusAction, RegionStatusChangeCopy>
> = {
  disable: {
    confirmLabel: '确认停用',
    consequence:
      '停用后，该地区及全部后代将退出业务地区选择器；已保存的历史数据不会删除，仍可按原路径回显。',
    title: '确认停用地区',
  },
  enable: {
    confirmLabel: '确认启用',
    consequence:
      '启用后，系统会重新计算该地区及其后代的有效状态；若任一祖先仍处于停用状态，该地区仍不可用于业务选择。',
    title: '确认启用地区',
  },
}

/**
 * `ancestorPath` 明确只包含祖先，当前操作对象由 `region` 追加。
 * 这样国家/地区、省/州、城市三个层级都由同一个规则生成完整且可核对的路径。
 */
export function formatRegionStatusPath(
  ancestorPath: readonly RegionStatusPathNode[],
  region: RegionStatusPathNode,
): string {
  return [...ancestorPath, region]
    .map(node => node.name.normalize('NFC').trim() || node.code)
    .join(' / ')
}

export function regionStatusChangeCopy(
  action: RegionStatusAction,
): RegionStatusChangeCopy {
  return REGION_STATUS_CHANGE_COPY[action]
}

/**
 * 提交 payload 只暴露页面执行领域写入所需的最小信息。
 * 确认框不知道 API、权限或缓存；提交期间返回 null，作为重复触发的第二道保护。
 */
export function createRegionStatusChangeRequest(
  action: RegionStatusAction,
  region: null | RegionStatusTarget,
  submitting: boolean,
): null | RegionStatusChangeRequest {
  if (submitting || region === null) {
    return null
  }

  return {
    action,
    regionId: region.id,
  }
}
