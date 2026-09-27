import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export enum SlhBillRateSourceDto { EMBEDDED = 'EMBEDDED', SYSTEM = 'SYSTEM', MANUAL = 'MANUAL' }
export enum SlhBillPricingBasisDto { WEIGHT = 'WEIGHT', VOLUME = 'VOLUME' }
/** 列表与计数工具栏共用的账单状态取值；`all` 表示不加状态条件。 */
export enum SlhBillListStateDto { ACTIVE = 'active', SUPERSEDED = 'superseded', ALL = 'all' }
/** 对账状态筛选取值；`all` 表示不加对账条件，其余与账单三态同名（顺序与工具栏一致，`all` 收尾）。 */
export enum SlhBillReconciliationFilterDto { PENDING = 'PENDING', PARTIAL = 'PARTIAL', COMPLETED = 'COMPLETED', ALL = 'all' }
const SLH_BILL_LIST_STATE_VALUES = [SlhBillListStateDto.ACTIVE, SlhBillListStateDto.SUPERSEDED, SlhBillListStateDto.ALL] as const
const SLH_BILL_RECONCILIATION_FILTER_VALUES = [SlhBillReconciliationFilterDto.PENDING, SlhBillReconciliationFilterDto.PARTIAL, SlhBillReconciliationFilterDto.COMPLETED, SlhBillReconciliationFilterDto.ALL] as const
/** 明细行对账状态（二态）；账单级三态见 SlhBillReconciliationStatusDto，由明细行汇总派生。 */
export enum SlhBillLineReconciliationStatusDto { PENDING = 'PENDING', RECONCILED = 'RECONCILED' }
/** 账单对账状态（三态）：未对账 / 部分对账 / 对账完成。 */
export enum SlhBillReconciliationStatusDto { PENDING = 'PENDING', PARTIAL = 'PARTIAL', COMPLETED = 'COMPLETED' }
export enum SlhBillFindingSeverityDto { DIFFERENCE = 'difference', WARNING = 'warning' }
export enum SlhBillFindingKindDto {
  FREIGHT_MISMATCH = 'FREIGHT_MISMATCH',
  PAYABLE_MISMATCH = 'PAYABLE_MISMATCH',
  VOLUME_MISMATCH = 'VOLUME_MISMATCH',
  CHARGE_MISMATCH = 'CHARGE_MISMATCH',
  SUBTOTAL_MISMATCH = 'SUBTOTAL_MISMATCH',
  NET_AMOUNT_MISMATCH = 'NET_AMOUNT_MISMATCH',
  DIMENSION_PRECISION = 'DIMENSION_PRECISION',
  RATE_MISSING = 'RATE_MISSING',
  REMARK_NOTE = 'REMARK_NOTE',
}

/** 复算与账单的出入项；同一份数据既用于账单级分组，也用于明细行的行内提示。 */
export class SlhBillFindingDto {
  @ApiProperty({ enum: SlhBillFindingKindDto }) kind!: SlhBillFindingKindDto
  @ApiProperty({ enum: SlhBillFindingSeverityDto }) severity!: SlhBillFindingSeverityDto
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Line ordinal inside the bill; used to locate the row.' }) lineNumber!: number | null
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Row number in the source sheet, matching the line list.' }) sourceRowNumber!: number | null
  @ApiProperty() message!: string
}
export enum SlhBillChargeTypeDto {
  FREIGHT = 'FREIGHT', COD_HANDLING = 'COD_HANDLING', HEAVY_CARGO = 'HEAVY_CARGO', DELIVERY = 'DELIVERY',
  REDELIVERY = 'REDELIVERY', TRANSFER_DELIVERY = 'TRANSFER_DELIVERY', REMOTE_AREA = 'REMOTE_AREA',
  UNLOADING = 'UNLOADING', STORAGE = 'STORAGE', WAITING = 'WAITING', OVERSIZE = 'OVERSIZE',
  INSPECTION = 'INSPECTION', FORKLIFT = 'FORKLIFT', MINIMUM_CHARGE = 'MINIMUM_CHARGE', OTHER = 'OTHER',
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u
const RATE_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/u
// 账单月份只到月，不存日期，避免出现「月份里带日」的歧义。
const BILL_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u

export class SlhBillIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}

export class SlhBillListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ type: 'string', description: 'Inclusive period start lower bound (YYYY-MM-DD).' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/u) periodFrom?: string
  @ApiPropertyOptional({ type: 'string', description: 'Inclusive period end upper bound (YYYY-MM-DD).' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/u) periodTo?: string
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches bill number, source file name or container batch name.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
  @ApiPropertyOptional({ type: 'string', pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$', description: 'Minimum payable amount in CNY.' }) @IsOptional() @IsString() @Matches(AMOUNT_PATTERN) payableMin?: string
  @ApiPropertyOptional({ type: 'string', pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$', description: 'Maximum payable amount in CNY.' }) @IsOptional() @IsString() @Matches(AMOUNT_PATTERN) payableMax?: string
  @ApiPropertyOptional({ enum: SlhBillListStateDto, default: SlhBillListStateDto.ACTIVE }) @IsOptional() @IsIn(SLH_BILL_LIST_STATE_VALUES) state?: SlhBillListStateDto
  @ApiPropertyOptional({ enum: SlhBillReconciliationFilterDto, default: SlhBillReconciliationFilterDto.ALL, description: 'Filter by the reconciliation status derived from the lines of this bill.' }) @IsOptional() @IsIn(SLH_BILL_RECONCILIATION_FILTER_VALUES) reconciliationStatus?: SlhBillReconciliationFilterDto
}

/** 计数查询与列表共用同一组筛选，只去掉分页（计数覆盖完整结果集，不是当前页）。 */
export class SlhBillStatusCountsQueryDto extends OmitType(SlhBillListQueryDto, ['page', 'pageSize'] as const) {}

export class SlhBillStateCountDto {
  @ApiProperty({ enum: SlhBillListStateDto }) value!: SlhBillListStateDto
  @ApiProperty() count!: number
}

export class SlhBillReconciliationCountDto {
  @ApiProperty({ enum: SlhBillReconciliationFilterDto }) value!: SlhBillReconciliationFilterDto
  @ApiProperty() count!: number
}

export class SlhBillStatusCountsDto {
  @ApiProperty({ type: [SlhBillStateCountDto], description: 'Counts per bill state; the current reconciliation filter applies, the state filter does not.' }) states!: SlhBillStateCountDto[]
  @ApiProperty({ type: [SlhBillReconciliationCountDto], description: 'Counts per reconciliation status; the current state filter applies, the reconciliation filter does not.' }) reconciliationStatuses!: SlhBillReconciliationCountDto[]
}

/** 明细分页查询只带分页字段；账单主键走路径参数，不能继承带必填 id 的 DTO。 */
export class SlhBillLineListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 50, maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number
  @ApiPropertyOptional({ maxLength: 128, description: 'Matches warehouse receipt reference, shipping mark, goods name or recipient info.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string
  @ApiPropertyOptional({ maxLength: 128, description: 'Container batch name exactly as printed on the bill.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) containerBatchName?: string
}

export class SlhBillStagedFileDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty() fileName!: string
  @ApiProperty({ description: 'Lowercase hex SHA-256 of the uploaded bytes.' }) checksumSha256!: string
  @ApiProperty() sizeBytes!: number
}

export class SlhBillMediaAssetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') mediaAssetId!: string
}

export class SlhBillImportCreateDto extends SlhBillMediaAssetDto {
  @ApiProperty({ maxLength: 200, description: 'Bill name shown in the list; unique among bills that are not superseded.' })
  @IsString() @IsUnicodeCodePointLength(1, 200) billName!: string
  @ApiProperty({ type: 'string', pattern: '^\\d{4}-(?:0[1-9]|1[0-2])$', description: 'Bill month (YYYY-MM).' })
  @IsString() @Matches(BILL_MONTH_PATTERN) billMonth!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 500 })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 500) remark?: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, pattern: '^(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,12})?$', description: 'Manual TWD per CNY rate; only allowed when the bill formula has no divisor.' })
  @IsOptional() @IsString() @Matches(RATE_PATTERN) manualForeignUnitsPerCny?: string | null
  @ApiPropertyOptional({ type: 'string', format: 'uuid', nullable: true, description: 'Existing bill this import replaces.' })
  @IsOptional() @IsUUID('4') supersedesBillId?: string | null
  @ApiPropertyOptional({ default: false, description: 'Acknowledge a duplicate period and container set.' })
  @IsOptional() @Type(() => Boolean) @IsIn([true, false]) duplicateAcknowledged?: boolean
}

export class SlhBillLineChargeDto {
  @ApiProperty({ enum: SlhBillChargeTypeDto }) chargeType!: SlhBillChargeTypeDto
  @ApiProperty({ enum: ['CNY', 'TWD'] }) currencyCode!: string
  @ApiProperty({ type: 'string', description: 'Amount in the charge currency.' }) amount!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) sourceRemarkText!: string | null
}

export class SlhBillLineDto {
  @ApiProperty() lineNumber!: number
  @ApiProperty({ type: Number, description: 'Row number in the source sheet; the first detail row follows the header.' }) sourceRowNumber!: number
  @ApiProperty({ type: 'string', description: 'YYYY-MM-DD' }) loadingDate!: string
  @ApiProperty() containerBatchNameText!: string
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) containerBatchId!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) warehouseReceiptReference!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) shippingMarkText!: string | null
  @ApiProperty() goodsName!: string
  @ApiProperty() packageCount!: number
  @ApiPropertyOptional({ type: 'string', nullable: true }) packageUnit!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) grossWeightKg!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) weightUnit!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) lengthCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) widthCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) heightCm!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) volumeCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reportedVolumeCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) volumeDifferenceCai!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) categoryCode!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) unitPriceAmount!: string | null
  @ApiPropertyOptional({ enum: SlhBillPricingBasisDto, nullable: true }) pricingBasis!: SlhBillPricingBasisDto | null
  @ApiProperty({ type: 'string' }) freightAmountCny!: string
  @ApiProperty({ type: 'string' }) codHandlingAmountCny!: string
  @ApiProperty({ type: 'string' }) surchargeAmountCny!: string
  @ApiProperty({ type: 'string' }) payableAmountCny!: string
  @ApiProperty({ type: 'string' }) codAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeAmountTwd!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) recipientInfoRaw!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Parsed recipient name; null when it cannot be determined.' }) recipientName!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Parsed phone numbers kept in the original writing, one field for all numbers.' }) recipientPhones!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Parsed shipping address.' }) recipientAddress!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ enum: SlhBillLineReconciliationStatusDto, description: 'Reconciliation state of this line; RECONCILED once it has been reconciled.' }) reconciliationStatus!: SlhBillLineReconciliationStatusDto
  @ApiProperty({ type: [SlhBillLineChargeDto] }) charges!: SlhBillLineChargeDto[]
}

export class SlhBillLinePageDto {
  @ApiProperty({ type: [SlhBillLineDto] }) items!: SlhBillLineDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class SlhBillListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty() billName!: string
  @ApiProperty({ type: 'string' }) billMonth!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty() lineCount!: number
  @ApiProperty() containerBatchCount!: number
  @ApiProperty({ type: [String], description: 'Container batch names in this bill; the list shows them in a tooltip next to the count.' }) containerBatchNames!: string[]
  @ApiProperty({ type: 'string' }) payableTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) reportedNetAmountTwd!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Rate embedded in the bill formula; the list folds the net amount with it.' }) embeddedForeignUnitsPerCny!: string | null
  @ApiPropertyOptional({ enum: SlhBillRateSourceDto, nullable: true }) rateSource!: SlhBillRateSourceDto | null
  @ApiProperty({ enum: SlhBillReconciliationStatusDto, description: 'Derived from the lines of this bill: PENDING when none is reconciled, COMPLETED when all are, PARTIAL in between.' }) reconciliationStatus!: SlhBillReconciliationStatusDto
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) supersededById!: string | null
  @ApiProperty() sourceFileName!: string
  @ApiProperty({ type: 'string' }) createdAt!: string
  @ApiProperty({ type: 'string' }) createdByDisplayName!: string
}

export class SlhBillPageDto {
  @ApiProperty({ type: [SlhBillListItemDto] }) items!: SlhBillListItemDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class SlhBillRateDto {
  @ApiProperty({ enum: SlhBillRateSourceDto }) source!: SlhBillRateSourceDto
  @ApiProperty({ type: 'string', description: 'TWD per CNY, twelve decimals.' }) foreignUnitsPerCny!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'Rate embedded in the bill formula, when present.' }) embeddedForeignUnitsPerCny!: string | null
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) exchangeRateId!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) capturedAt!: string | null
}

export class SlhBillReportedDto {
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 小计 row payable amount as written by the carrier.' }) subtotalPayableAmountCny!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 小计 row COD total.' }) subtotalCodAmountTwd!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 小计 row NTD surcharge total.' }) subtotalNtdSurchargeAmountTwd!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 合计应付人民币 row amount, negative by the carrier convention.' }) payableAmountCny!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'The 合计应付台币NTD cell value as written by the carrier.' }) netAmountTwd!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) netAmountFormula!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'TWD per CNY embedded in the bill formula; present means the net amount cell is already converted.' }) embeddedForeignUnitsPerCny!: string | null
  @ApiProperty({ type: 'string', description: 'Unconverted net amount: COD total minus NTD surcharge total.' }) reportedNetAmountTwd!: string
}

export class SlhBillDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty() billName!: string
  @ApiProperty({ type: 'string' }) billMonth!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty() lineCount!: number
  @ApiProperty() containerBatchCount!: number
  @ApiProperty({ type: [String] }) containerBatchNames!: string[]
  @ApiProperty({ type: 'string' }) freightTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codHandlingTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) surchargeTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) payableTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) reportedNetAmountTwd!: string
  @ApiPropertyOptional({ type: () => SlhBillRateDto, nullable: true }) rate!: SlhBillRateDto | null
  @ApiProperty({ type: () => SlhBillReportedDto }) reported!: SlhBillReportedDto
  @ApiProperty({ type: [SlhBillFindingDto], description: 'Confirm-time snapshot of differences and warnings.' }) findings!: SlhBillFindingDto[]
  @ApiProperty() sourceFileName!: string
  @ApiProperty() sourceFileSha256!: string
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) supersededById!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) supersededAt!: string | null
  @ApiProperty() version!: number
  @ApiProperty({ type: 'string' }) createdAt!: string
  @ApiProperty({ type: 'string' }) createdByDisplayName!: string
}

export class SlhBillPreviewLineDto extends SlhBillLineDto {
  /** 本行的差异与告警；账单级视图用的是同一份数据，只是不做行过滤。 */
  @ApiProperty({ type: [SlhBillFindingDto] }) findings!: SlhBillFindingDto[]
  @ApiProperty({ type: [String] }) errors!: string[]
}

export class SlhBillTotalsDto {
  @ApiProperty({ type: 'string' }) freightTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codHandlingTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) surchargeTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) payableTotalAmountCny!: string
  @ApiProperty({ type: 'string' }) codTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) ntdSurchargeTotalAmountTwd!: string
  @ApiProperty({ type: 'string' }) reportedNetAmountTwd!: string
}

export class SlhBillDuplicateDto {
  @ApiProperty({ format: 'uuid' }) billId!: string
  @ApiProperty() slhBillNo!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
}

export class SlhBillImportPreviewDto {
  @ApiProperty({ description: 'Default name derived from the source file name.' }) suggestedBillName!: string
  @ApiProperty({ description: 'Default bill month derived from the period, falling back to the file name.' }) suggestedBillMonth!: string
  @ApiProperty({ type: 'string' }) periodStart!: string
  @ApiProperty({ type: 'string' }) periodEnd!: string
  @ApiProperty({ type: [String] }) containerBatchNames!: string[]
  @ApiProperty() lineCount!: number
  @ApiProperty() containerBatchCount!: number
  @ApiProperty({ type: () => SlhBillTotalsDto }) totals!: SlhBillTotalsDto
  @ApiProperty({ type: () => SlhBillReportedDto }) reported!: SlhBillReportedDto
  @ApiPropertyOptional({ type: 'string', nullable: true, description: 'System TWD per CNY rate read for preview; null when the bill embeds its own rate.' })
  systemForeignUnitsPerCny!: string | null
  @ApiPropertyOptional({ type: () => SlhBillDuplicateDto, nullable: true }) duplicate!: SlhBillDuplicateDto | null
  @ApiProperty({ type: [SlhBillFindingDto], description: 'Differences and warnings; unchanged when the bill is stored.' }) findings!: SlhBillFindingDto[]
  @ApiProperty({ type: [SlhBillPreviewLineDto] }) lines!: SlhBillPreviewLineDto[]
}
