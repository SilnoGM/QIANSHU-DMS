/** 地址快照按「国家+省+市+详情」拼接，国家名恒为「中国台湾」；这里只处理开头一级。 */
const COUNTRY_PREFIX = /^(?:中国台湾|中國台灣)\s*/u

/**
 * 复制给外部（运营、顺联航群组）时去掉地址开头的国家名，省名和正文保持原样。
 * 只剥离开头一处，正文里的同名文字不动；地址恰好只有国家名时退化为「台湾」，不输出空地址。
 */
export function stripAddressCountryPrefix(address: string | null | undefined): string {
  const value = address?.trim() ?? ''
  if (value === '') {
    return ''
  }
  const stripped = value.replace(COUNTRY_PREFIX, '')
  // 边界：地址只有「中国台湾」时按业务口径只去掉「中国」，保留「台湾」。
  return stripped === '' ? value.replace(/^(?:中国|中國)(?=台湾|台灣)/u, '') : stripped
}
