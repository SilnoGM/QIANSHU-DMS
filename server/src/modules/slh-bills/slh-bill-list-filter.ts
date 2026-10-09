import { Prisma } from '../../generated/prisma/client'

export type SlhBillListStateValue = 'active' | 'superseded' | 'all'
export type SlhBillReconciliationFilterValue = 'all' | 'PENDING' | 'PARTIAL' | 'COMPLETED'

export interface SlhBillListFilterInput {
  keyword?: string
  state?: SlhBillListStateValue
  reconciliationStatus?: SlhBillReconciliationFilterValue
  periodFrom?: string
  periodTo?: string
  payableMin?: string
  payableMax?: string
}

/**
 * 账单列表的过滤条件。列表查询与两块工具栏的计数查询共用这一份构造，
 * 避免搜索、期间与金额语义在多个接口之间漂移；`omit*` 用来构造"忽略自己那一维"的计数基准条件。
 *
 * 期间按区间重叠判断（与重复导入判定同口径）：账单期间与所选区间有任何交集即命中。
 */
export function buildSlhBillListWhere(
  filter: SlhBillListFilterInput,
  options: { omitState?: boolean, omitReconciliationStatus?: boolean } = {},
): Prisma.SlhBillWhereInput {
  const keyword = filter.keyword?.trim()
  const conditions = slhBillReconciliationConditions(
    options.omitReconciliationStatus === true ? undefined : filter.reconciliationStatus,
  )
  // 金额区间在解析精度内比较，避免把用户的两位小数输入当成浮点数。
  // 上下界必须落在同一个 payableTotalAmountCny 键里：分开写会互相覆盖，只剩一个边界生效。
  if (filter.payableMin !== undefined || filter.payableMax !== undefined) {
    conditions.unshift({
      payableTotalAmountCny: {
        ...(filter.payableMin === undefined ? {} : { gte: new Prisma.Decimal(filter.payableMin) }),
        ...(filter.payableMax === undefined ? {} : { lte: new Prisma.Decimal(filter.payableMax) }),
      },
    })
  }
  const state = options.omitState === true ? 'all' : filter.state ?? 'active'
  return {
    ...slhBillStateCondition(state),
    ...(filter.periodFrom === undefined ? {} : { periodEnd: { gte: new Date(filter.periodFrom) } }),
    ...(filter.periodTo === undefined ? {} : { periodStart: { lte: new Date(filter.periodTo) } }),
    ...(keyword === undefined || keyword === '' ? {} : {
      OR: [
        { slhBillNo: { contains: keyword, mode: 'insensitive' } },
        { sourceFileName: { contains: keyword, mode: 'insensitive' } },
        { containerBatchNames: { contains: keyword, mode: 'insensitive' } },
      ],
    }),
    ...(conditions.length === 0 ? {} : { AND: conditions }),
  }
}

/** 账单状态条件；`all` 表示不加条件。计数时叠在"忽略状态维度"的基准谓词上。 */
export function withSlhBillState(where: Prisma.SlhBillWhereInput, state: SlhBillListStateValue): Prisma.SlhBillWhereInput {
  const condition = slhBillStateCondition(state)
  return Object.keys(condition).length === 0 ? where : { ...where, ...condition }
}

/** 账单状态缺省为生效中（与列表查询的默认值一致），`all` 才表示不加条件。 */
function slhBillStateCondition(state: SlhBillListStateValue): Prisma.SlhBillWhereInput {
  if (state === 'all') {
    return {}
  }
  return { supersededById: state === 'superseded' ? { not: null } : null }
}

/** 对账状态条件；`all` 表示不加条件。计数时叠在"忽略对账维度"的基准谓词上。 */
export function withSlhBillReconciliationStatus(
  where: Prisma.SlhBillWhereInput,
  status: SlhBillReconciliationFilterValue,
): Prisma.SlhBillWhereInput {
  const conditions = slhBillReconciliationConditions(status)
  if (conditions.length === 0) {
    return where
  }
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]
  return { ...where, AND: [...existing, ...conditions] }
}

/**
 * 未完成对账（未对账或部分对账）：账单里至少还有一行没有对账时刻。
 * 这是「未对账 + 部分对账」两态的统一谓词，供对账批次的候选账单筛选复用，
 * 免得候选集合与账单三态各自写一套判断。
 */
export function withSlhBillIncompleteReconciliation(where: Prisma.SlhBillWhereInput): Prisma.SlhBillWhereInput {
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]
  return { ...where, AND: [...existing, { lines: { some: { reconciledAt: null } } }] }
}

/**
 * 对账状态是明细行的汇总结果：
 * - 未对账 = 没有任何一行有对账时刻；
 * - 对账完成 = 没有未对账的行；
 * - 部分对账 = 两种行都存在（两个条件不能并成一个关系过滤器，必须都用存在性判断）。
 * 关系过滤器按"存在性"判断，前提是账单必然有明细行（解析器与入库都保证行数 ≥ 1）。
 */
function slhBillReconciliationConditions(status: SlhBillReconciliationFilterValue | undefined): Prisma.SlhBillWhereInput[] {
  if (status === 'PENDING') {
    return [{ lines: { none: { reconciledAt: { not: null } } } }]
  }
  if (status === 'COMPLETED') {
    return [{ lines: { none: { reconciledAt: null } } }]
  }
  if (status === 'PARTIAL') {
    return [{ lines: { some: { reconciledAt: { not: null } } } }, { lines: { some: { reconciledAt: null } } }]
  }
  return []
}
