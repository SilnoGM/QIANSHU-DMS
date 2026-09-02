import type {
  PurchaseOrderSourceSalesOrderListItemDto,
  PurchaseOrderSourceSalesOrdersDto,
} from '@/api/generated/types.gen'

/** 采购表单保留来源视图，以便审计选择来自未采购或部分采购列表。 */
export interface PurchaseSourceSalesOrderSelection {
  readonly item: PurchaseOrderSourceSalesOrderListItemDto
  readonly view: PurchaseOrderSourceSalesOrdersDto['view']
}
