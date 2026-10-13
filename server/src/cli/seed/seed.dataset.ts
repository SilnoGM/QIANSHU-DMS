import { DictionaryTone } from '../../generated/prisma/enums'
import type { NumberingRuleSegmentInput } from '../../modules/numbering/dto/numbering-segment.dto'
import type {
  NumberingDateFormat,
  NumberingResetPolicy,
} from '../../modules/numbering/rule-engine'

/**
 * 上线内置数据的唯一真相源，内容按 2026-10-01 用户确认口径取自 dev 库现状：
 * 四币种全启用 + 三条汇率、除 develop.test 外的全部字典、19 条编号规则、
 * 供应商唛头绑定、打木架资金类型。业务账号不在此数据集内，管理员一律由
 * `auth:bootstrap-admin` 交互创建。
 */

export interface SeedExchangeRate {
  readonly currencyCode: string
  /** 1 CNY 兑换的外币数量，十进制字符串，避免浮点转换。 */
  readonly foreignUnitsPerCny: string
}

export interface SeedDictionaryItem {
  readonly value: string
  readonly label: string
  readonly tone: (typeof DictionaryTone)[keyof typeof DictionaryTone]
  readonly sortOrder: number
}

export interface SeedDictionaryType {
  readonly code: string
  readonly name: string
  readonly sortOrder: number
  readonly items: readonly SeedDictionaryItem[]
}

export interface SeedRole {
  readonly code: string
  readonly name: string
  readonly description: string
  readonly permissionCodes: readonly string[]
}

export interface SeedNumberingRule {
  readonly ruleCode: string
  readonly name: string
  readonly description: string
  readonly purpose: 'BUSINESS' | 'SHIPPING_MARK'
  readonly resetPolicy: NumberingResetPolicy
  readonly segments: readonly NumberingRuleSegmentInput[]
}

export interface SeedShippingMarkBinding {
  readonly supplierValue: string
  readonly ruleCode: string
}

export interface SeedFundPostingType {
  readonly code: string
  readonly name: string
  readonly description: string
  readonly businessCategory: 'REVENUE' | 'COST' | 'NEUTRAL'
  readonly requiresUser: boolean
  readonly amountSignPolicy: 'POSITIVE_ONLY' | 'NON_ZERO_SIGNED'
  readonly legs: ReadonlyArray<{
    readonly position: number
    readonly accountTarget: 'USER' | 'COMPANY'
    readonly directionPolicy: 'CREDIT' | 'DEBIT' | 'FOLLOW_AMOUNT_SIGN'
    readonly amountStrategy: 'FULL_AMOUNT' | 'USER_SHARE' | 'COMPANY_REMAINDER'
  }>
}

/** 打木架付款专用来源，编号与资金绑定都必须使用该稳定 code。 */
export const SEED_PACKAGING_COST_SOURCE_CODE = 'PACKAGING_COST'

export const SEED_EXCHANGE_RATES: readonly SeedExchangeRate[] = [
  { currencyCode: 'TWD', foreignUnitsPerCny: '5.2' },
  { currencyCode: 'MYR', foreignUnitsPerCny: '0.6' },
  { currencyCode: 'USD', foreignUnitsPerCny: '0.148' },
]

export const SEED_DICTIONARIES: readonly SeedDictionaryType[] = [
  {
    code: 'mainland.warehouse',
    name: '内地仓库',
    sortOrder: 0,
    items: [
      { value: 'SLH.SZ.BA.SJJD.HSNP.B5', label: '顺联航-深圳南浦科技园B5仓', tone: DictionaryTone.PRIMARY, sortOrder: 0 },
      { value: 'SLH.DW.FHSNL.4HGYQ.B', label: '顺联航-东莞虎门钦隆国际仓', tone: DictionaryTone.PRIMARY, sortOrder: 10 },
      { value: 'YJ.594540.DGHM.ZTBHCG.B.DXM', label: '优集-东莞虎门大熊猫转运仓', tone: DictionaryTone.PRIMARY, sortOrder: 20 },
      { value: 'QITA', label: '其他', tone: DictionaryTone.DEFAULT, sortOrder: 30 },
    ],
  },
  {
    code: 'payment.method',
    name: '付款方式',
    sortOrder: 0,
    items: [
      { value: 'ALIPAY', label: '支付宝', tone: DictionaryTone.DEFAULT, sortOrder: 10 },
      { value: 'WECHAT', label: '微信', tone: DictionaryTone.DEFAULT, sortOrder: 20 },
      { value: 'BANK_TRANSFER', label: '银行转账', tone: DictionaryTone.DEFAULT, sortOrder: 30 },
      { value: 'CASH', label: '现金付款', tone: DictionaryTone.DEFAULT, sortOrder: 20 },
      { value: 'CHECK', label: '支票支付', tone: DictionaryTone.DEFAULT, sortOrder: 30 },
      { value: 'LETTER_OF_CREDIT', label: '信用证 L/C', tone: DictionaryTone.DEFAULT, sortOrder: 40 },
      // 代收回填收款的固定收款方式：与迁移来源同标签、同排序，seed 只补缺失不覆盖。
      { value: 'BILL_COD_SETTLEMENT', label: '账单代收结算', tone: DictionaryTone.DEFAULT, sortOrder: 50 },
    ],
  },
  {
    code: 'service_provider.carrier',
    name: '承运商',
    sortOrder: 0,
    items: [
      { value: 'TEST', label: '测试承运商', tone: DictionaryTone.DEFAULT, sortOrder: 0 },
    ],
  },
  {
    code: 'service_provider.supplier',
    name: '供应商',
    sortOrder: 0,
    items: [
      { value: 'TEST', label: '测试供应商', tone: DictionaryTone.DEFAULT, sortOrder: 0 },
    ],
  },
  {
    code: 'warehouse.packaging_type',
    name: '包装类型',
    sortOrder: 0,
    items: [
      { value: 'WOODEN_BOX', label: '木箱', tone: DictionaryTone.DEFAULT, sortOrder: 0 },
      { value: 'WOODEN_FRAME', label: '木架', tone: DictionaryTone.DEFAULT, sortOrder: 10 },
    ],
  },
]

export const SEED_ROLES: readonly SeedRole[] = [
  {
    code: 'operations_staff',
    name: '运营人员',
    description: '运营人员（销售人员）',
    permissionCodes: [
      'packaging-costs:create',
      'purchase-orders:create',
      'purchase-orders:document',
      'purchase-orders:payment',
      'purchase-orders:read',
      'purchase-orders:update',
      'sales-orders:create',
      'sales-orders:document',
      'sales-orders:payment',
      'sales-orders:read',
      'sales-orders:update',
      'sales-receipts:void',
      'workbench:operations',
    ],
  },
  {
    code: 'finance_staff',
    name: '财务人员',
    description: '财务人员（千树财务工作台）',
    permissionCodes: [
      'fund-accounts:create',
      'fund-accounts:manual-adjust',
      'fund-accounts:read',
      'fund-accounts:update-share-rate',
      'fund-business-sources:manage',
      'fund-posting-types:manage',
      'fund-transactions:reverse',
      'packaging-costs:pay',
      'packaging-costs:read',
      'purchase-orders:payment',
      'sales-receipts:read',
      'sales-receipts:review',
      'sales-receipts:void',
      'slh-bills:create',
      'slh-bills:read',
      'slh-bills:reconcile',
      'workbench:finance',
    ],
  },
  {
    code: 'purchasing_staff',
    name: '采购人员',
    description: '采购人员（千树采运工作台）',
    permissionCodes: [
      'container-batches:create',
      'container-batches:read',
      'container-batches:update',
      'purchase-orders:read',
      'purchase-orders:review',
      'purchase-orders:update',
      'sales-orders:read',
      'workbench:purchase-transport',
    ],
  },
]

function datedSequence(
  fixedValue: string,
  sequenceWidth: number,
  dateFormat: NumberingDateFormat,
): readonly NumberingRuleSegmentInput[] {
  return [
    { type: 'FIXED', value: fixedValue },
    { type: 'SEPARATOR', value: '/' },
    { type: 'DATE', format: dateFormat },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: sequenceWidth, startValue: '1', step: '1' },
  ]
}

export const SEED_NUMBERING_RULES: readonly SeedNumberingRule[] = [
  { ruleCode: 'PRODUCT', name: '产品编码', description: '用于产品的编码', purpose: 'BUSINESS', resetPolicy: 'NEVER', segments: [{ type: 'FIXED', value: 'PROD' }, { type: 'SEPARATOR', value: '/' }, { type: 'SEQUENCE', width: 5, startValue: '1', step: '1' }] },
  { ruleCode: 'SALES_ORDER', name: '销售订单编号', description: '用于销售订单的唯一编号', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('SO', 5, 'YYYYMMDD') },
  { ruleCode: 'PURCHASE_ORDER', name: '采购订单编号', description: '用于销售订单的唯一编号', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('PO', 5, 'YYYYMMDD') },
  { ruleCode: 'SHIPMENT_NO', name: '货件编号', description: '货件编号', purpose: 'BUSINESS', resetPolicy: 'NEVER', segments: datedSequence('PKG', 5, 'YYYYMMDD') },
  { ruleCode: 'CONTAINER_BATCH_NO', name: '海运柜次编号', description: '海运装柜柜次编号', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('CTN', 3, 'YYYY') },
  { ruleCode: 'CTN_BILL_NO', name: '海运账单编号', description: '海运账单编号', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('CBILL', 2, 'YYYYMM') },
  { ruleCode: 'SLH_RECON_BATCH_NO', name: '顺联航对账批次编号', description: '顺联航对账批次编号', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('SRB', 3, 'YYYYMMDD') },
  { ruleCode: 'SALES_COLLECTION', name: '销售收款编号', description: '用于给销售收款申请编号', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('SCO', 4, 'YYYYMMDD') },
  { ruleCode: 'SEA_FRT_VOY_NO', name: '海快运次编号', description: '海快运次编号，每月一个', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('SEAF', 2, 'YYYYMM') },
  { ruleCode: 'TEST', name: '测试编号', description: '', purpose: 'BUSINESS', resetPolicy: 'YEARLY', segments: datedSequence('TEST', 4, 'YYYYMMDD') },
  { ruleCode: 'CUSTOM_MARK', name: '自定义产品唛头', description: '自定义产品采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'NEVER', segments: datedSequence('CUSTOM', 4, 'YYYYMMDD') },
  { ruleCode: 'BTJ_MARK', name: '拔铜机唛头', description: '拔铜机采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('BTJ', 4, 'YYYYMMDD') },
  { ruleCode: 'DBJ_MARK', name: '液压打包机唛头', description: '液压打包机采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('DBJ', 4, 'YYYYMMDD') },
  { ruleCode: 'FSL_MARK', name: '焚烧炉唛头', description: '焚烧炉采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('FSL', 4, 'YYYYMMDD') },
  { ruleCode: 'LDC_MARK', name: '履带车唛头', description: '履带车采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('LDC', 4, 'YYYYMMDD') },
  { ruleCode: 'PSJ_MARK', name: '破碎机唛头', description: '破碎机采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('PSJ', 4, 'YYYYMMDD') },
  { ruleCode: 'SSJ_MARK', name: '撕碎机唛头', description: '撕碎机采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('SSJ', 4, 'YYYYMMDD') },
  { ruleCode: 'WGJ_MARK', name: '微耕机唛头', description: '微耕机采购唛头', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('WGJ', 4, 'YYYYMMDD') },
  { ruleCode: 'TEST_MARK', name: '测试唛头编号', description: '测试', purpose: 'SHIPPING_MARK', resetPolicy: 'YEARLY', segments: datedSequence('TEST', 4, 'YYYYMMDD') },
]

export const SEED_SHIPPING_MARK_BINDINGS: readonly SeedShippingMarkBinding[] = [
  { supplierValue: 'TEST', ruleCode: 'TEST_MARK' },
]

export const SEED_FUND_POSTING_TYPES: readonly SeedFundPostingType[] = [
  {
    code: 'WOODEN_PACKING_COST',
    name: '打木架费用',
    description: '按用户当前分成比例从用户与公司账户扣除',
    businessCategory: 'COST',
    requiresUser: true,
    amountSignPolicy: 'POSITIVE_ONLY',
    legs: [
      { position: 1, accountTarget: 'USER', directionPolicy: 'DEBIT', amountStrategy: 'USER_SHARE' },
      { position: 2, accountTarget: 'COMPANY', directionPolicy: 'DEBIT', amountStrategy: 'COMPANY_REMAINDER' },
    ],
  },
]
