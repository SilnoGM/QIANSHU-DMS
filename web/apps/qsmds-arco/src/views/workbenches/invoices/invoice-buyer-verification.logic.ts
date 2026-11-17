import { isCompanyLookupTaxId } from './invoice-company-lookup.logic'

/**
 * 开票主体核验的适用范围：真实统编才需要核验；个人抬头 `00000000` 在
 * 工商登记里没有记录，既不展示查询入口，也不作为提交前置。
 */
export function isBuyerVerificationRequired(buyerTaxId: string): boolean {
  return isCompanyLookupTaxId(buyerTaxId)
}

/** 核验开关是否可点击：抬头非空且统编可用于查询。 */
export function canVerifyBuyer(buyerName: string, buyerTaxId: string): boolean {
  return buyerName.trim() !== '' && isBuyerVerificationRequired(buyerTaxId)
}
