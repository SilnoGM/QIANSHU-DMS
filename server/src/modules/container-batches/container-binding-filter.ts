import type { Prisma } from '../../generated/prisma/client'
import { ContainerBindingFilterDto } from './container-batch.dto'

export interface ContainerBatchListFilter {
  readonly search?: string
  readonly warehouseValue?: string
  readonly bindingState?: ContainerBindingFilterDto
}

/**
 * 绑定状态是装柜明细行的汇总结果（按行计，一行一个 shipmentId）：
 * - FULL = 至少一行明细且没有任何未绑定行；
 * - PARTIAL = 已绑定与未绑定行同时存在，两个存在性判断不能合并成一个关系过滤器；
 * - NONE = 没有任何已绑定行，包含 0 行明细的空柜，三态因此互斥且并集为全部柜次。
 */
function bindingConditions(state: ContainerBindingFilterDto): Prisma.ContainerBatchWhereInput[] {
  if (state === ContainerBindingFilterDto.FULL) {
    return [{ items: { some: {} } }, { items: { none: { shipmentId: null } } }]
  }
  if (state === ContainerBindingFilterDto.PARTIAL) {
    return [{ items: { some: { shipmentId: { not: null } } } }, { items: { some: { shipmentId: null } } }]
  }
  if (state === ContainerBindingFilterDto.NONE) {
    return [{ items: { none: { shipmentId: { not: null } } } }]
  }
  return []
}

/**
 * 柜次列表与页签计数共用这一份条件构造，避免搜索、仓库与绑定语义在多个查询之间漂移。
 * `omitBindingState` 用于构造「忽略绑定维度」的计数基准条件。
 */
export function buildContainerBatchListWhere(
  filter: ContainerBatchListFilter,
  options: { omitBindingState?: boolean } = {},
): Prisma.ContainerBatchWhereInput {
  const search = filter.search?.trim()
  const match = search === undefined || search === '' ? null : { contains: search, mode: 'insensitive' as const }
  const conditions = options.omitBindingState === true
    ? []
    : bindingConditions(filter.bindingState ?? ContainerBindingFilterDto.ALL)
  return {
    ...(filter.warehouseValue === undefined || filter.warehouseValue === '' ? {} : { warehouseValue: filter.warehouseValue }),
    // 收件人姓名存在装柜行上，未关联货件的行也能按收件人找回柜次。
    ...(match === null ? {} : { OR: [
      { containerBatchName: match },
      { containerBatchNo: match },
      { items: { some: { recipientName: match } } },
    ] }),
    ...(conditions.length === 0 ? {} : { AND: conditions }),
  }
}

/** 在既有条件上叠加绑定状态；`ALL` 不加条件，供计数在基准条件上逐个状态叠加。 */
export function withContainerBindingFilter(
  where: Prisma.ContainerBatchWhereInput,
  state: ContainerBindingFilterDto,
): Prisma.ContainerBatchWhereInput {
  const conditions = bindingConditions(state)
  if (conditions.length === 0) {
    return where
  }
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]
  return { ...where, AND: [...existing, ...conditions] }
}
