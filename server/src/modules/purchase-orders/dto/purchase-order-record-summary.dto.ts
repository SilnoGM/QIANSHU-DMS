import { ApiProperty } from '@nestjs/swagger'
import { PurchaseOrderDocumentType, PurchaseOrderPaymentType } from '../../../generated/prisma/enums'

export class PurchaseOrderPaymentTypeSummaryDto {
  @ApiProperty({ enum: PurchaseOrderPaymentType }) readonly paymentType!: PurchaseOrderPaymentType
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '该类型有效付款合计，两位小数十进制字符串' }) readonly amount!: string
}

export class PurchaseOrderPaymentRecordSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0, description: '全部付款记录数，包含已作废记录；仅用于历史记录入口' }) readonly totalCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
  @ApiProperty({ type: () => [PurchaseOrderPaymentTypeSummaryDto] }) readonly byType!: readonly PurchaseOrderPaymentTypeSummaryDto[]
}

export class PurchaseOrderDocumentTypeSummaryDto {
  @ApiProperty({ enum: PurchaseOrderDocumentType }) readonly documentType!: PurchaseOrderDocumentType
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
}

export class PurchaseOrderDocumentSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly count!: number
  @ApiProperty({ type: () => [PurchaseOrderDocumentTypeSummaryDto] }) readonly byType!: readonly PurchaseOrderDocumentTypeSummaryDto[]
}

export class PurchaseOrderLatestChangeDto {
  @ApiProperty({ enum: ['STATUS', 'AMOUNT'] }) readonly kind!: 'STATUS' | 'AMOUNT'
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly changedAt!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly reason!: string | null
}

export class PurchaseOrderChangeSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly statusCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly amountCount!: number
  @ApiProperty({ type: () => PurchaseOrderLatestChangeDto, nullable: true }) readonly latest!: PurchaseOrderLatestChangeDto | null
}
