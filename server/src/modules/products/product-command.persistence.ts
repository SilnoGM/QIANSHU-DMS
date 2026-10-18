import type { Prisma } from '../../generated/prisma/client'
import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import type { NormalizedProductCreateCommand } from './product-command.normalizer'
import {
  PRODUCT_RESPONSE_SELECT,
  type ProductQueryRow,
} from './product-query.mapper'

const PRODUCT_NUMBER_UNIQUE_CONSTRAINT = 'products_product_no_key'

export interface CreateProductRecordInput {
  readonly productNo: string
  readonly actorUserId: string
  readonly command: NormalizedProductCreateCommand
}

/** persistence 只接收规范化输入，并主动复制 JSON 数组，绝不持有调用方对象。 */
export async function createProductRecord(
  transaction: Prisma.TransactionClient,
  input: CreateProductRecordInput,
): Promise<ProductQueryRow> {
  const attributes = input.command.attributes.map(attribute => ({
    title: attribute.title,
    value: attribute.value,
  }))

  return transaction.product.create({
    data: {
      name: input.command.name,
      categoryName: input.command.categoryName,
      productHeadName: input.command.productHeadName,
      productNo: input.productNo,
      status: input.command.status,
      supplierValue: input.command.supplierValue,
      twdSalePriceAmount: input.command.twdSalePrice.amount,
      twdSalePriceCurrency: input.command.twdSalePrice.currency,
      myrSalePriceAmount: input.command.myrSalePrice.amount,
      myrSalePriceCurrency: input.command.myrSalePrice.currency,
      purchaseCostAmount: input.command.purchaseCost.amount,
      purchaseCostCurrency: input.command.purchaseCost.currency,
      attributes,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      version: 1,
    },
    select: PRODUCT_RESPONSE_SELECT,
  })
}

export async function readProductByNumber(
  transaction: Prisma.TransactionClient,
  productNo: string,
): Promise<ProductQueryRow | null> {
  return transaction.product.findUnique({
    where: { productNo },
    select: PRODUCT_RESPONSE_SELECT,
  })
}

/** 只消费结构化 code/constraint/target；驱动 message 永不参与唯一冲突判断。 */
export function isProductNumberUniqueViolation(error: unknown): boolean {
  const facts = readPersistenceErrorFacts(error)
  const uniqueViolation = hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')

  return uniqueViolation && (
    hasPersistenceConstraint(facts, PRODUCT_NUMBER_UNIQUE_CONSTRAINT)
    || hasPersistenceTarget(facts, 'productNo')
  )
}
