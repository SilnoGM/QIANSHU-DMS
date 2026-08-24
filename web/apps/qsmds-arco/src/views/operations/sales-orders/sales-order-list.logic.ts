export interface SalesOrderCustomerCopySource {
  readonly customerName: string
  readonly customerPhone: string
  readonly customerFullAddress: string
}

export function buildSalesOrderCustomerCopyText(
  customer: SalesOrderCustomerCopySource,
): string {
  // 复制内容保持固定三行；只移除业务明确指定的“中国台湾”，不改变地址中的其他文字或空格。
  const copyAddress = customer.customerFullAddress.replaceAll('中国台湾', '')
  return [
    `客户姓名：${customer.customerName}`,
    `客户电话：${customer.customerPhone}`,
    `客户地址：${copyAddress}`,
  ].join('\n')
}
