import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'

export function buildOceanContainerRecipientText(line: Pick<OperationsOceanContainerLineDto, 'recipientName' | 'recipientPhone' | 'recipientAddress' | 'remark'>): string {
  // 业务复制模板固定使用中文；缺失值留空，避免把界面占位符当作真实收件信息。
  return [
    `客户姓名：${line.recipientName?.trim() || ''}`,
    `客户电话：${line.recipientPhone?.trim() || ''}`,
    `收件地址：${line.recipientAddress?.trim() || ''}`,
    `备注：${line.remark?.trim() || ''}`,
  ].join('\n')
}
