import type {
  PurchaseOrderSourceSalesOrderListItemDto,
  PurchaseOrderSourceSalesOrdersDto,
} from '@/api/generated/types.gen'

/**
 * 采购表单除候选订单外还需要知道选择发生在哪个采购场景，
 * 以区分普通关联采购与“已完成采购-加购产品”的追加编排。
 */
export interface PurchaseSourceSalesOrderSelection {
  readonly item: PurchaseOrderSourceSalesOrderListItemDto
  readonly view: PurchaseOrderSourceSalesOrdersDto['view']
}
