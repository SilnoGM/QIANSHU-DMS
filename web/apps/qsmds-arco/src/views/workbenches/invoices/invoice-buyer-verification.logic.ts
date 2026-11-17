/**
 * 开票主体核验的查询值选择：优先统一编号，其次抬头名称。
 *
 * 统一编号为占位 `00000000`（个人抬头）或为空时，用抬头名称去工商登记查询；
 * 两者都为空返回空串，由调用方阻止打开查询页。
 */
export function resolveVerificationQuery(buyerName: string, buyerTaxId: string): string {
  const taxId = buyerTaxId.trim()
  if (taxId !== '' && taxId !== '00000000') {
    return taxId
  }
  return buyerName.trim()
}

/** 核验开关是否可点击：抬头非空且统一编号是 8 位数字。 */
export function canVerifyBuyer(buyerName: string, buyerTaxId: string): boolean {
  return buyerName.trim() !== '' && /^\d{8}$/u.test(buyerTaxId.trim())
}
