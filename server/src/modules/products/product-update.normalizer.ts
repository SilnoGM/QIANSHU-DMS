import { HttpStatus } from '@nestjs/common'

import type { ProductStatus as ProductStatusValue } from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeProductCreateCommand,
  type NormalizedProductCreateCommand,
} from './product-command.normalizer'

const MAX_INT32 = 2_147_483_647
const MUTABLE_FIELDS = [
  'name',
  'categoryName',
  'productHeadName',
  'status',
  'supplierValue',
  'twdSalePrice',
  'myrSalePrice',
  'purchaseCost',
  'attributes',
] as const

type ProductMutableField = typeof MUTABLE_FIELDS[number]

export interface ProductUpdateCurrent {
  readonly name: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly status: ProductStatusValue
  readonly supplierValue: string | null
  readonly twdSalePrice: Readonly<{ amount: string | null; currency: string }>
  readonly myrSalePrice: Readonly<{ amount: string | null; currency: string }>
  readonly purchaseCost: Readonly<{ amount: string | null; currency: string }>
  readonly attributes: unknown
}

export interface NormalizedProductUpdatePatch {
  readonly expectedVersion: number
  readonly name?: unknown
  readonly categoryName?: unknown
  readonly productHeadName?: unknown
  readonly status?: unknown
  readonly supplierValue?: unknown
  readonly twdSalePrice?: unknown
  readonly myrSalePrice?: unknown
  readonly purchaseCost?: unknown
  readonly attributes?: unknown
}

export interface ProductUpdateTarget {
  readonly command: NormalizedProductCreateCommand
  readonly changedFields: readonly ProductMutableField[]
}

function validationFailure(field = 'body'): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    { [field]: ['字段校验失败'] },
  )
}

function hasSubmittedField(
  input: Readonly<Record<string, unknown>>,
  field: ProductMutableField,
): boolean {
  // JSON 无法表达 undefined；DTO class field 的 undefined 只代表“调用方未提交”。
  return Object.hasOwn(input, field) && input[field] !== undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 防御性复制并冻结未知 Patch 值，避免校验、锁行和写入之间被调用方修改。 */
function cloneAndFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => cloneAndFreeze(item)))
  }
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneAndFreeze(item)]),
    ))
  }
  return value
}

export function normalizeProductUpdatePatch(
  input: unknown,
): NormalizedProductUpdatePatch {
  /*
   * HTTP 边界开启了 transform，合法 Body 在进入 Service 时是 DTO class instance，
   * 不是 Object.prototype 的 plain object。这里仍以 own enumerable keys 白名单和
   * 深复制约束输入，同时允许 ValidationPipe 产出的受信 DTO 容器。
   */
  if (!isRecord(input)) return validationFailure()

  const allowedKeys = new Set<string>([...MUTABLE_FIELDS, 'expectedVersion'])
  if (Object.keys(input).some(key => !allowedKeys.has(key))) {
    return validationFailure()
  }
  if (!MUTABLE_FIELDS.some(field => hasSubmittedField(input, field))) {
    return validationFailure()
  }

  const expectedVersion = input.expectedVersion
  if (
    typeof expectedVersion !== 'number'
    || !Number.isInteger(expectedVersion)
    || expectedVersion < 1
    || expectedVersion > MAX_INT32
  ) {
    return validationFailure('expectedVersion')
  }

  const patch: Record<string, unknown> = { expectedVersion }
  for (const field of MUTABLE_FIELDS) {
    if (hasSubmittedField(input, field)) {
      patch[field] = cloneAndFreeze(input[field])
    }
  }
  return Object.freeze(patch) as unknown as NormalizedProductUpdatePatch
}

function sameMoney(
  left: Readonly<{ amount: string | null; currency: string }>,
  right: Readonly<{ amount: string | null; currency: string }>,
): boolean {
  return left.amount === right.amount && left.currency === right.currency
}

/**
 * 在 Product 行锁之后把局部 Patch 合并成完整目标，并交由创建规范化器执行唯一
 * 的金额、状态、供应商和属性校验。返回的 changedFields 已稳定排序，供持久层和
 * 安全审计元数据共同使用。
 */
export function buildProductUpdateTarget(
  current: ProductUpdateCurrent,
  patch: NormalizedProductUpdatePatch,
): ProductUpdateTarget {
  const merged = Object.fromEntries(MUTABLE_FIELDS.map(field => [
    field,
    Object.hasOwn(patch, field) ? patch[field] : current[field],
  ]))
  const command = normalizeProductCreateCommand(merged)
  const normalizedCurrent = normalizeProductCreateCommand(current)

  const changedFields = MUTABLE_FIELDS.filter(field => {
    if (field === 'twdSalePrice' || field === 'myrSalePrice' || field === 'purchaseCost') {
      return !sameMoney(normalizedCurrent[field], command[field])
    }
    if (field === 'attributes') {
      return JSON.stringify(normalizedCurrent.attributes) !== JSON.stringify(command.attributes)
    }
    return normalizedCurrent[field] !== command[field]
  }).sort()

  return Object.freeze({
    command,
    changedFields: Object.freeze(changedFields),
  })
}
