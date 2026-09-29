import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { SlhBillLineDto, SlhBillListItemDto, SlhBillReconciliationStatusDto } from '../slh-bills/slh-bill.dto'

/** 批次状态（派生，不落列）：completed_at 为空即进行中。 */
export enum SlhReconciliationBatchStatusDto { IN_PROGRESS = 'IN_PROGRESS', COMPLETED = 'COMPLETED' }
/** 列表筛选取值；`all` 表示不加状态条件（顺序与工具栏一致，`all` 收尾）。 */
export enum SlhReconciliationBatchFilterDto { IN_PROGRESS = 'IN_PROGRESS', COMPLETED = 'COMPLETED', ALL = 'all' }
/** 匹配来源：与持久化枚举 slh_bill_line_match_source 一致。 */
export enum SlhBillLineMatchSourceDto { NAME = 'NAME', MARK = 'MARK' }
/** 未匹配合格的原因；与 slh-bill-line-matching 的原因码一一对应。 */
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

/** 弹窗第一步的候选账单列表：只列未完成对账且没有进行中批次的生效账单。 */
export class SlhReconciliationBatchCandidateQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches bill number, source file name or container batch name.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
}

export class SlhReconciliationBatchPreviewRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Bill whose unreconciled lines will be matched against container rows.' }) @IsUUID('4') billId!: string
}

export class SlhReconciliationBatchCreateDto extends SlhReconciliationBatchPreviewRequestDto {
  @ApiPropertyOptional({
    type: [String], format: 'uuid', maxItems: 1000,
    description: 'Line ids the user saw in the preview. Compared with the server-side match only: any difference rejects the create instead of silently changing the scope.',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) previewLineIds?: string[]
}

export class SlhReconciliationBatchReconcileDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 1000, description: 'Member line ids to reconcile in this batch.' })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(1000) @IsUUID('4', { each: true }) lineIds!: string[]
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

/** 预审/匹配结果行：已匹配的行带柜次依据，未匹配的行只带原因。 */
export class SlhReconciliationMatchPreviewLineDto {
  @ApiProperty({ format: 'uuid' }) lineId!: string
  @ApiProperty() lineNumber!: number
  @ApiProperty() sourceRowNumber!: number
  @ApiProperty({ type: 'string', description: 'YYYY-MM-DD' }) loadingDate!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) containerBatchNameText!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) shippingMarkText!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) warehouseReceiptReference!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty({ enum: SlhBillLineMatchSourceDto, nullable: true }) matchSource!: SlhBillLineMatchSourceDto | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Container batch name of the matched loading item.' }) matchedContainerBatchName!: string | null
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Row number of the matched loading item inside its container batch.' }) matchedLoadingItemLineNumber!: number | null
  @ApiProperty({ enum: SlhBillLineUnmatchedReasonDto, nullable: true }) reason!: SlhBillLineUnmatchedReasonDto | null
}

export class SlhReconciliationBatchPreviewDto {
  @ApiProperty({ type: SlhBillListItemDto }) bill!: SlhBillListItemDto
  @ApiProperty({ type: [SlhReconciliationMatchPreviewLineDto], description: 'Lines that match a qualified container row and will become batch members.' }) matched!: SlhReconciliationMatchPreviewLineDto[]
  @ApiProperty({ type: [SlhReconciliationMatchPreviewLineDto], description: 'Lines that cannot be reconciled now, each with its reason.' }) unmatched!: SlhReconciliationMatchPreviewLineDto[]
}

/** 成员行：账单明细行的全部字段 + 本批次的匹配依据与核对留痕。 */
export class SlhReconciliationBatchMemberDto extends SlhBillLineDto {
  @ApiProperty({ format: 'uuid', description: 'Member row id inside this batch.' }) id!: string
  @ApiProperty({ format: 'uuid', description: 'Bill line id; the reconcile endpoint takes these ids.' }) lineId!: string
  @ApiProperty({ enum: SlhBillLineMatchSourceDto }) matchSource!: SlhBillLineMatchSourceDto
  @ApiProperty({ format: 'uuid' }) matchedLoadingItemId!: string
  @ApiProperty({ type: 'string' }) matchedContainerBatchName!: string
  @ApiProperty({ type: Number }) matchedLoadingItemLineNumber!: number
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Null means this batch has not reconciled the line yet.' }) reconciledAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reconciledByDisplayName!: string | null
}

export class SlhReconciliationBatchDetailDto extends SlhReconciliationBatchListItemDto {
  @ApiProperty({ type: [SlhReconciliationBatchMemberDto], description: 'Only the lines matched at creation time; other bill lines never appear here.' }) members!: SlhReconciliationBatchMemberDto[]
}
