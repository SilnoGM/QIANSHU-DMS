/**
 * 台湾工商登记查询链接：`https://company.g0v.ronny.tw/id/<统一编号>`。
 *
 * 主机是写死的 https 常量，不接受调用方传入 origin；编号作为路径段整体编码。
 * 该链接只在新标签页打开，前端不发任何请求。
 */
export const COMPANY_LOOKUP_ORIGIN = 'https://company.g0v.ronny.tw'

/** 可查询的统编：8 位数字且不是个人占位 00000000（后者没有企业登记记录）。 */
export function isCompanyLookupTaxId(taxId: string): boolean {
  const trimmed = taxId.trim()
  return /^\d{8}$/u.test(trimmed) && trimmed !== '00000000'
}

export function buildCompanyLookupUrl(taxId: string): string {
  const trimmed = taxId.trim()
  return trimmed === '' ? COMPANY_LOOKUP_ORIGIN : `${COMPANY_LOOKUP_ORIGIN}/id/${encodeURIComponent(trimmed)}`
}
