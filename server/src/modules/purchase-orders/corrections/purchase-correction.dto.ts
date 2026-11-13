import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const CORRECTION_STATUSES = ['PENDING_PAYMENT', 'PAID', 'CANCELLED'] as const

export class PurchaseCorrectionBlockerDto {
  @ApiProperty() code!: string
  @ApiProperty() message!: string
  @ApiProperty({ enum: ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_ORDER_PART', 'PACKAGING_COST', 'RECONCILIATION_BATCH'] })
  targetType!: 'SALES_ORDER' | 'PURCHASE_ORDER' | 'PURCHASE_ORDER_PART' | 'PACKAGING_COST' | 'RECONCILIATION_BATCH'
  @ApiProperty() targetId!: string
}

export class PurchaseCorrectionPurchaseDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() orderNo!: string
  @ApiProperty() orderStatus!: string
  @ApiProperty() fulfillmentStatus!: string
  @ApiProperty() paymentStatus!: string
  @ApiProperty({ minimum: 1 }) version!: number
}

export class PurchaseCorrectionPaymentDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string
  @ApiProperty() purchaseOrderNo!: string
  @ApiProperty() paymentType!: string
  @ApiProperty({ description: 'CNY amount with two decimal places.' }) amount!: string
  @ApiProperty({ format: 'date-time' }) paidAt!: string
  @ApiProperty({ type: 'string', nullable: true }) paymentMethod!: string | null
}

export class PurchaseCorrectionPackagingDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string
  @ApiProperty({ format: 'uuid' }) shipmentId!: string
  @ApiProperty() shipmentNo!: string
  @ApiProperty({ description: 'CNY amount with two decimal places.' }) amount!: string
  @ApiProperty({ enum: CORRECTION_STATUSES }) status!: typeof CORRECTION_STATUSES[number]
}

export class PurchaseCorrectionReconciliationDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() batchNo!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) completedAt!: string | null
}

export class PurchaseCorrectionContainerItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid', nullable: true }) shipmentId!: string | null
  @ApiProperty({ format: 'uuid' }) containerBatchId!: string
  @ApiProperty() containerBatchNo!: string
  @ApiProperty({ description: '装柜行存在收件人/COD 变更记录；纠正只解绑，不撤销变更历史。' })
  hasChanges!: boolean
  @ApiProperty({ type: () => [PurchaseCorrectionReconciliationDto] })
  reconciliations!: PurchaseCorrectionReconciliationDto[]
}

export class PurchaseCorrectionContextDto {
  @ApiProperty({ format: 'uuid' }) salesOrderId!: string
  @ApiProperty() salesOrderNo!: string
  @ApiProperty() orderStatus!: string
  @ApiProperty() fulfillmentStatus!: string
  @ApiProperty({ minimum: 1 }) version!: number
  @ApiProperty({ type: () => [PurchaseCorrectionPurchaseDto] })
  purchaseOrders!: PurchaseCorrectionPurchaseDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionPaymentDto] })
  payments!: PurchaseCorrectionPaymentDto[]
  @ApiProperty({ description: '全部待反冲采购付款的 CNY 合计。' })
  totalPaymentAmount!: string
  @ApiProperty({ type: () => [PurchaseCorrectionPackagingDto] })
  packagingCosts!: PurchaseCorrectionPackagingDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionContainerItemDto] })
  containerItems!: PurchaseCorrectionContainerItemDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionReconciliationDto] })
  preservedReconciliations!: PurchaseCorrectionReconciliationDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionBlockerDto] })
  blockers!: PurchaseCorrectionBlockerDto[]
  @ApiProperty() canApply!: boolean
}

export class PurchaseCorrectionSalesOrderIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') salesOrderId!: string
}

export class PurchaseCorrectionOrderVersionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') purchaseOrderId!: string
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}

export class PurchaseCorrectionRequestDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') salesOrderId!: string
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedSalesOrderVersion!: number
  @ApiProperty({ type: () => [PurchaseCorrectionOrderVersionDto], minItems: 1, maxItems: 50 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true })
  @Type(() => PurchaseCorrectionOrderVersionDto)
  purchaseOrders!: PurchaseCorrectionOrderVersionDto[]
  @ApiProperty({ maxLength: 500 }) @IsString() @IsUnicodeCodePointLength(1, 500)
  reason!: string
  @ApiProperty({ maxLength: 64, description: '必须与销售单号完全一致。' })
  @IsString() @IsUnicodeCodePointLength(1, 64)
  confirmOrderNo!: string
}

export class PurchaseCorrectionCancelledOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() orderNo!: string
}

export class PurchaseCorrectionResultDto {
  @ApiProperty({ format: 'uuid' }) correctionId!: string
  @ApiProperty({ format: 'uuid' }) salesOrderId!: string
  @ApiProperty() salesOrderNo!: string
  @ApiProperty() fulfillmentStatus!: string
  @ApiProperty({ type: () => [PurchaseCorrectionCancelledOrderDto] })
  cancelledPurchaseOrders!: PurchaseCorrectionCancelledOrderDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionPaymentDto] })
  reversedPayments!: PurchaseCorrectionPaymentDto[]
  @ApiProperty({ description: '本次反冲的采购付款 CNY 合计。' })
  totalReversedAmount!: string
  @ApiProperty({ type: () => [PurchaseCorrectionPackagingDto] })
  cancelledPackagingCosts!: PurchaseCorrectionPackagingDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionContainerItemDto] })
  detachedContainerItems!: PurchaseCorrectionContainerItemDto[]
  @ApiProperty({ type: () => [PurchaseCorrectionReconciliationDto] })
  preservedReconciliations!: PurchaseCorrectionReconciliationDto[]
}
