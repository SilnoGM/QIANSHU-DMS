import { ApiProperty, PickType } from '@nestjs/swagger'
import { ContainerBatchDto, ContainerBatchListQueryDto, ContainerLoadingItemDto } from './container-batch.dto'

/** 运营只接收整柜概览，不暴露原始文件、维护记录或其他销售员的行。 */
export class OperationsOceanContainerDto extends PickType(ContainerBatchDto, [
  'id', 'containerBatchNo', 'containerBatchName', 'loadingDate', 'warehouseValue',
  'itemCount', 'grossWeightKgTotal', 'volumeCaiTotal',
] as const) {
  @ApiProperty({ description: 'Stored warehouse label, including disabled historical values.' }) warehouseName!: string
  @ApiProperty({ minimum: 0, description: 'Loading lines whose linked sales order was issued by the current authenticated user.' }) myItemCount!: number
  @ApiProperty({ minimum: 0, type: Number, description: 'All loading lines in the container, independent of data scope.' }) declare itemCount: number
  @ApiProperty({ type: String, nullable: true, description: 'Gross weight in kg. SELF: sum of the current user\'s lines; ALL: whole-container sum; null when any counted line is missing a value.' }) declare grossWeightKgTotal: string | null
  @ApiProperty({ type: String, nullable: true, description: 'Volume in cai. SELF: sum of the current user\'s lines; ALL: whole-container sum; null when any counted line is missing a value.' }) declare volumeCaiTotal: string | null
}

export class OperationsOceanContainerPageDto {
  @ApiProperty({ enum: ['SELF', 'ALL'], description: 'Effective data scope used for the container list and item reads.' })
  dataScope!: 'SELF' | 'ALL'

  @ApiProperty({ type: [OperationsOceanContainerDto] }) items!: OperationsOceanContainerDto[]
  @ApiProperty({ minimum: 0 }) total!: number
}

export class OperationsOceanContainerItemsQueryDto extends PickType(ContainerBatchListQueryDto, ['page', 'pageSize'] as const) {}

/** 个人装柜明细的读取白名单；来源订单引用只用于既有权限下的详情读取，不暴露采运维护或账单域。 */
export class OperationsOceanContainerLineDto extends PickType(ContainerLoadingItemDto, [
  'id', 'containerBatchId', 'version', 'lineNumber', 'oceanShippingMarkText', 'goodsName',
  'shipmentNo', 'shippingMark', 'salesOrderId', 'salesOrderNo', 'purchaseOrderId', 'purchaseOrderNo', 'recipientName', 'codAmountTwd',
  'warehouseReceiptReference', 'recipientPhone', 'recipientAddress', 'packageCount', 'packageUnit',
  'grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeCai', 'remark',
] as const) {}

export class OperationsOceanContainerLinePageDto {
  @ApiProperty({ type: [OperationsOceanContainerLineDto] }) items!: OperationsOceanContainerLineDto[]
  @ApiProperty({ minimum: 0 }) total!: number
}

/** 全部柜次页读取整柜明细；mine 只用于前端逐行禁用操作，不替代服务端写接口授权。 */
export class OperationsOceanContainerAllLineDto extends OperationsOceanContainerLineDto {
  @ApiProperty({ description: 'Whether the linked sales order was issued by the current authenticated user.' })
  mine!: boolean
}

export class OperationsOceanContainerAllLinePageDto {
  @ApiProperty({ type: [OperationsOceanContainerAllLineDto] }) items!: OperationsOceanContainerAllLineDto[]
  @ApiProperty({ minimum: 0 }) total!: number
}
