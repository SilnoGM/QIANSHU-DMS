import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { PurchaseOrderFulfillmentStatus, PurchaseOrderPaymentStatus, PurchaseOrderStatus, SalesOrderFulfillmentStatus, SalesOrderPaymentStatus, SalesOrderStatus } from '../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { PurchaseOrderSupplierDto } from '../purchase-orders/dto/purchase-order-response.dto'
import { SlhBillFindingDto, SlhBillLineDto, SlhBillListItemDto, SlhBillReconciliationStatusDto } from '../slh-bills/slh-bill.dto'

/** 批次状态（派生，不落列）：completed_at 为空即进行中。 */
export enum SlhReconciliationBatchStatusDto { IN_PROGRESS = 'IN_PROGRESS', COMPLETED = 'COMPLETED' }
/** 列表筛选取值；`all` 表示不加状态条件（顺序与工具栏一致，`all` 收尾）。 */
export enum SlhReconciliationBatchFilterDto { IN_PROGRESS = 'IN_PROGRESS', COMPLETED = 'COMPLETED', ALL = 'all' }
/** 匹配来源：与持久化枚举 slh_bill_line_match_source 一致。 */
export enum SlhBillLineMatchSourceDto { NAME = 'NAME', MARK = 'MARK' }
/** 未匹配合格的原因码；与 slh-bill-line-matching 的原因码一一对应。 */
export enum SlhBillLineUnmatchedReasonDto {
  MISSING_CONTAINER_REFERENCE = 'MISSING_CONTAINER_REFERENCE',
  INVALID_CONTAINER_NAME = 'INVALID_CONTAINER_NAME',
  CONTAINER_NOT_FOUND = 'CONTAINER_NOT_FOUND',
  CONTAINER_AMBIGUOUS = 'CONTAINER_AMBIGUOUS',
  MISSING_SHIPPING_MARK = 'MISSING_SHIPPING_MARK',
  MARK_NOT_FOUND_IN_CONTAINER = 'MARK_NOT_FOUND_IN_CONTAINER',
  LOADING_ITEM_AMBIGUOUS = 'LOADING_ITEM_AMBIGUOUS',
  SHIPMENT_NOT_MATCHED = 'SHIPMENT_NOT_MATCHED',
  PURCHASE_SOURCE_MISSING = 'PURCHASE_SOURCE_MISSING',
  SALES_SOURCE_MISSING = 'SALES_SOURCE_MISSING',
}
const BATCH_FILTER_VALUES = [SlhReconciliationBatchFilterDto.IN_PROGRESS, SlhReconciliationBatchFilterDto.COMPLETED, SlhReconciliationBatchFilterDto.ALL] as const

export class SlhReconciliationBatchIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}

export class SlhReconciliationBatchListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ enum: SlhReconciliationBatchFilterDto, default: SlhReconciliationBatchFilterDto.IN_PROGRESS }) @IsOptional() @IsIn(BATCH_FILTER_VALUES) status?: SlhReconciliationBatchFilterDto
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches batch number, bill number or bill name.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}

/** 弹窗候选账单的筛选取值；`all` 收尾，与工具栏顺序一致。 */
export enum SlhReconciliationBillGroupDto { SELECTABLE = 'SELECTABLE', BLOCKED = 'BLOCKED' }
/** 账单暂时不能发起对账的原因：决定「不可选」分组卡片上的说明。 */
export enum SlhReconciliationBillBlockReasonDto {
  IN_PROGRESS_BATCH = 'IN_PROGRESS_BATCH',
  NO_UNRECONCILED_LINES = 'NO_UNRECONCILED_LINES',
  NO_RECONCILABLE_LINES = 'NO_RECONCILABLE_LINES',
}

/** 弹窗第一步的候选账单列表：只列未完成对账且没有进行中批次的生效账单。 */
export class SlhReconciliationBatchCandidateQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches bill number, source file name or container batch name.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}

/** 可选/不可选两组的分组查询：`group` 决定返回哪一组的当页数据，计数始终同时给出。 */
export class SlhReconciliationBillOptionQueryDto {
  @ApiProperty({ enum: SlhReconciliationBillGroupDto }) @IsIn([SlhReconciliationBillGroupDto.SELECTABLE, SlhReconciliationBillGroupDto.BLOCKED]) group!: SlhReconciliationBillGroupDto
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches bill number, source file name or container batch name.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}

/** 静默算可核对行数：按账单主键批量算当前页（上限 100），不改任何数据。 */
export class SlhReconciliationReconcilableCountsRequestDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 100, description: 'Bills whose currently reconcilable lines are counted. At most 100 per request.' })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @IsUUID('4', { each: true }) billIds!: string[]
}

export class SlhBillLineUnmatchedReasonCountDto {
  @ApiProperty({ enum: SlhBillLineUnmatchedReasonDto }) code!: SlhBillLineUnmatchedReasonDto
  @ApiProperty() count!: number
}

export class SlhReconciliationReconcilableCountsItemDto {
  @ApiProperty({ format: 'uuid' }) billId!: string
  @ApiProperty({ description: 'Lines that currently match a qualified container row.' }) reconcilableLineCount!: number
  @ApiProperty({
    description: 'Matchable lines that no batch in progress has frozen: what the bill list column shows. '
      + 'reconcilableLineCount minus this value is what the in-progress batch froze.',
  })
  unfrozenLineCount!: number
  @ApiProperty({ type: [String], format: 'uuid', description: 'Reconcilable line ids; the create endpoint compares them before freezing members.' }) reconcilableLineIds!: string[]
  @ApiProperty({ type: [SlhBillLineUnmatchedReasonCountDto], description: 'Why the remaining unreconciled lines cannot be reconciled right now.' }) reasons!: SlhBillLineUnmatchedReasonCountDto[]
}

export class SlhReconciliationReconcilableCountsDto {
  @ApiProperty({ type: [SlhReconciliationReconcilableCountsItemDto] }) items!: SlhReconciliationReconcilableCountsItemDto[]
}

/** 弹窗卡片：账单基础信息 + 可核对行数（可选）或不能对账的原因（不可选）。 */
export class SlhReconciliationBillOptionDto extends SlhBillListItemDto {
  @ApiProperty({ description: 'True when the bill currently has at least one reconcilable line and no batch in progress.' }) selectable!: boolean
  @ApiProperty({ description: 'Reconcilable line count; 0 when the bill cannot be selected.' }) reconcilableLineCount!: number
  @ApiProperty({ type: [String], format: 'uuid', description: 'Reconcilable line ids; echoed back on create so the frozen scope is compared instead of silently changed.' }) reconcilableLineIds!: string[]
  @ApiPropertyOptional({ enum: SlhReconciliationBillBlockReasonDto, nullable: true, description: 'Null when selectable.' }) blockReason?: SlhReconciliationBillBlockReasonDto | null
  @ApiProperty({ type: [SlhBillLineUnmatchedReasonCountDto], description: 'Reason summary when the block reason is NO_RECONCILABLE_LINES.' }) reasons!: SlhBillLineUnmatchedReasonCountDto[]
}

export class SlhReconciliationBillOptionCountsDto {
  @ApiProperty({ description: 'Bills that currently have reconcilable lines and no batch in progress.' }) selectable!: number
  @ApiProperty({ description: 'Bills that cannot be selected right now.' }) blocked!: number
}

export class SlhReconciliationBillOptionPageDto {
  @ApiProperty({ type: [SlhReconciliationBillOptionDto] }) items!: SlhReconciliationBillOptionDto[]
  @ApiProperty({ type: SlhReconciliationBillOptionCountsDto, description: 'Counts of both groups under the current keyword; the paged group is included.' }) counts!: SlhReconciliationBillOptionCountsDto
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class SlhReconciliationBatchCreateDto {
  @ApiProperty({ format: 'uuid', description: 'Bill to reconcile. Its currently reconcilable lines are matched again inside the create transaction.' }) @IsUUID('4') billId!: string
  @ApiPropertyOptional({
    type: [String], format: 'uuid', maxItems: 1000,
    description: 'Line ids the user saw as reconcilable. Compared with the server-side match only: any difference rejects the create instead of silently changing the scope.',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) reconcilableLineIds?: string[]
}

export class SlhReconciliationBatchBillDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty() billName!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty({ enum: SlhBillReconciliationStatusDto, description: 'Live tri-state of the bill, still derived from its lines.' }) reconciliationStatus!: SlhBillReconciliationStatusDto
  @ApiProperty() lineCount!: number
  @ApiProperty({ description: 'Reconciled line count of the bill; lineCount minus this is 本账单还剩多少行未核对.' }) reconciledLineCount!: number
}

export class SlhReconciliationBatchListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() batchNo!: string
  @ApiProperty({ enum: SlhReconciliationBatchStatusDto }) status!: SlhReconciliationBatchStatusDto
  @ApiProperty({ type: SlhReconciliationBatchBillDto }) bill!: SlhReconciliationBatchBillDto
  @ApiProperty({ description: 'Member line count of this batch.' }) memberCount!: number
  @ApiProperty({ description: 'Members already reconciled in this batch.' }) reconciledMemberCount!: number
  @ApiProperty({ type: 'string' }) createdByDisplayName!: string
  @ApiProperty({ type: 'string' }) createdAt!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) completedAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) completedByDisplayName!: string | null
}

export class SlhReconciliationBatchPageDto {
  @ApiProperty({ type: [SlhReconciliationBatchListItemDto] }) items!: SlhReconciliationBatchListItemDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

/**
 * 匹配到的柜次装柜行：与账单行逐字段核对时用得到的列，外加串联来源链路的货件号。
 * 采购/销售订单本身不在这块里，见下面的来源摘要。
 */
export class SlhReconciliationMatchedItemDto {
  @ApiPropertyOptional({ type: 'string', nullable: true }) warehouseReceiptReference!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) oceanShippingMarkText!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty() packageCount!: number
  @ApiPropertyOptional({ type: 'string', nullable: true }) packageUnit!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) grossWeightKg!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) lengthCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) widthCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) heightCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) volumeCai!: string | null
  @ApiPropertyOptional({ type: Number, nullable: true }) chargeableVolumeCai!: number | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reportedVolumeCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Null means this container row does not involve COD, matching the bill line contract.' }) codAmountTwd!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) recipientName!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) recipientPhone!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) recipientAddress!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) remark!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Purchase part matched to this container row; null when the row has no shipment (never for frozen members).' }) shipmentNo!: string | null
}

/**
 * 采购来源摘要：装柜行 → 货件 → 采购订单，与匹配合格判定同一条关系链。
 *
 * 本模块对外只要求 `slh-bills:reconcile`，这里是经确认后有意放开的采购域字段，
 * 只保留对账页当前展示的列；金额与供应商标签都与采购域同口径
 * （两位小数人民币、同一份字典解析），余下列（下单日期、类型、产品模式、备注等）不放进来。
 */
export class SlhReconciliationMatchedPurchaseOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string' }) orderNo!: string
  @ApiProperty({ enum: PurchaseOrderStatus }) orderStatus!: PurchaseOrderStatus
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) purchaseTotalAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) depositDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额' }) balanceDueAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额；未作废付款记录之和' }) paidAmount!: string
  @ApiProperty({ type: 'string', pattern: '^\\d+\\.\\d{2}$', description: '两位小数的人民币金额；采购金额 − 实际已付款' }) outstandingAmount!: string
  @ApiProperty({ enum: PurchaseOrderFulfillmentStatus }) fulfillmentStatus!: PurchaseOrderFulfillmentStatus
  @ApiProperty({ enum: PurchaseOrderPaymentStatus }) paymentStatus!: PurchaseOrderPaymentStatus
  @ApiPropertyOptional({ type: 'string', nullable: true }) shippingMarkText!: string | null
  @ApiProperty({ type: () => PurchaseOrderSupplierDto }) supplier!: PurchaseOrderSupplierDto
  @ApiProperty({ type: 'string', description: '采购人：采购订单创建人的显示名' }) creatorDisplayName!: string
}

/**
 * 销售来源摘要：采购订单上的销售来源，字段口径与销售域一致（四位小数订单币种金额）。
 * 实际已收款/实际待收款直接用销售域的聚合口径（未作废收款累加、待收＝约定总额 − 已收）。
 */
export class SlhReconciliationMatchedSalesOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'string' }) orderNo!: string
  @ApiProperty({ enum: SalesOrderStatus }) orderStatus!: SalesOrderStatus
  @ApiProperty({ type: 'string' }) currencyCode!: string
  @ApiProperty({ type: 'string' }) customerName!: string
  @ApiProperty({ type: 'string' }) customerPhone!: string
  @ApiProperty({ type: 'string' }) customerFullAddress!: string
  @ApiProperty({ type: 'string', description: '四位小数的订单币种金额' }) agreedTotalAmount!: string
  @ApiProperty({ type: 'string', description: '四位小数的订单币种金额' }) depositDueAmount!: string
  @ApiProperty({ type: 'string', description: '四位小数的订单币种金额' }) balanceDueAmount!: string
  @ApiProperty({ type: 'string', description: '四位小数的订单币种金额' }) receivedAmount!: string
  @ApiProperty({ type: 'string', description: '四位小数的订单币种金额' }) outstandingAmount!: string
  @ApiProperty({ enum: SalesOrderFulfillmentStatus }) fulfillmentStatus!: SalesOrderFulfillmentStatus
  @ApiProperty({ enum: SalesOrderPaymentStatus }) paymentStatus!: SalesOrderPaymentStatus
  @ApiProperty({ type: 'string' }) issuerDisplayName!: string
}

/** 成员行：账单明细行的全部字段 + 本批次的匹配依据、柜次侧可比字段、来源摘要与核对留痕。 */
export class SlhReconciliationBatchMemberDto extends SlhBillLineDto {
  @ApiProperty({ format: 'uuid', description: 'Member row id inside this batch.' }) id!: string
  @ApiProperty({ format: 'uuid', description: 'Bill line id; the reconcile endpoint takes these ids.' }) lineId!: string
  @ApiProperty({ enum: SlhBillLineMatchSourceDto }) matchSource!: SlhBillLineMatchSourceDto
  @ApiProperty({ format: 'uuid' }) matchedLoadingItemId!: string
  @ApiProperty({ type: 'string' }) matchedContainerBatchName!: string
  @ApiProperty({ type: Number }) matchedLoadingItemLineNumber!: number
  @ApiProperty({ type: SlhReconciliationMatchedItemDto, description: 'Container row matched at creation time; the other side of every field comparison.' }) matchedLoadingItem!: SlhReconciliationMatchedItemDto
  @ApiPropertyOptional({ type: () => SlhReconciliationMatchedPurchaseOrderDto, nullable: true, description: 'Purchase source reachable from the matched container row; null only for damaged data.' }) purchaseOrder!: SlhReconciliationMatchedPurchaseOrderDto | null
  @ApiPropertyOptional({ type: () => SlhReconciliationMatchedSalesOrderDto, nullable: true, description: 'Sales source of the purchase order; null only for damaged data.' }) salesOrder!: SlhReconciliationMatchedSalesOrderDto | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Null means this batch has not reconciled the line yet.' }) reconciledAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reconciledByDisplayName!: string | null
}

export class SlhReconciliationBatchDetailDto extends SlhReconciliationBatchListItemDto {
  @ApiProperty({ type: [SlhReconciliationBatchMemberDto], description: 'Only the lines matched at creation time; other bill lines never appear here.' }) members!: SlhReconciliationBatchMemberDto[]
  @ApiProperty({ type: [SlhBillFindingDto], description: 'Import-time findings snapshot of the whole bill; the page keeps the ones belonging to this batch but still reports the bill-wide count.' }) findings!: SlhBillFindingDto[]
}
