/**
 * 台湾工商登记查询链接：固定使用 web393 的 https 地址，查询值整体做 URL 编码。
 *
 * 主机是写死的常量，不接受调用方传入 origin，避免任何形式的跳转注入；
 * 该链接只在新标签页打开，前端不发任何请求。
 */
export const COMPANY_LOOKUP_ORIGIN = 'https://www.web393.com'

export function buildCompanyLookupUrl(query: string): string {
  const trimmed = query.trim()
  const base = `${COMPANY_LOOKUP_ORIGIN}/Lq.aspx`
  return trimmed === '' ? base : `${base}?q=${encodeURIComponent(trimmed)}`
}
