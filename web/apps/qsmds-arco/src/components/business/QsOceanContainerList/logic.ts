import type { OceanContainerDetailScope, OceanContainerLine, OceanContainerSummary } from './types'

export type OceanContainerColumn = 'recipient' | 'mark' | 'goods' | 'shippingMark' | 'cod' | 'source' | 'actions'

const OCEAN_CONTAINER_COLUMNS: readonly OceanContainerColumn[] = ['recipient', 'mark', 'goods', 'shippingMark', 'cod', 'source', 'actions']

/** 全部柜次页不展示来源列；个人页保持原有销售/采购订单入口。 */
export function visibleOceanContainerColumns(showSource: boolean): OceanContainerColumn[] {
  return OCEAN_CONTAINER_COLUMNS.filter(column => showSource || column !== 'source')
}

/** 柜次是否含本人明细；与后端 personalOceanLineWhere 的归属口径一致。 */
export function isOwnOceanContainer(item: Pick<OceanContainerSummary, 'myItemCount'>): boolean {
  return item.myItemCount > 0
}

/** 个人页按本人计数决定是否加载；全部柜次页按整柜计数，零明细柜次不发起请求。 */
export function hasOceanContainerDetails(
  item: Pick<OceanContainerSummary, 'itemCount' | 'myItemCount'>,
  scope: OceanContainerDetailScope,
): boolean {
  return scope === 'all' ? item.itemCount > 0 : item.myItemCount > 0
}

/** 全部柜次页只放行服务端标记为 mine 的行；个人页的响应天然全是本人行。 */
export function isOceanContainerLineActionable(
  line: Pick<OceanContainerLine, 'mine'>,
  restrictToOwned: boolean,
): boolean {
  return !restrictToOwned || line.mine === true
}

/** 本人明细行的浅绿底色只在全部柜次页启用，个人页保持既有视觉。 */
export function isOceanContainerLineHighlighted(
  line: Pick<OceanContainerLine, 'mine'>,
  scope: OceanContainerDetailScope,
): boolean {
  return scope === 'all' && line.mine === true
}
