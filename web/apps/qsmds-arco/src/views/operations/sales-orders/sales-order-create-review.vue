<script setup lang="ts">
import type { DescriptionItem } from '@fantastic-admin/components'
import type { SalesOrderFormModel } from './sales-order-create.logic'

import { calculateSalesOrderLineSubtotal } from './sales-order-create.logic'

const props = defineProps<{
  model: SalesOrderFormModel
  issuerLabel: string
  fullAddress: string
  lineSubtotalAmount: string | null
  amountPrecision: number
}>()

const documentTypeLabels = {
  DEPOSIT_VOUCHER: '定金凭证',
  DELIVERY_RECEIPT: '签收单',
  OTHER: '其他',
} as const

function displayText(value: string): string {
  return value.trim() || '未填写'
}

function displayMoney(value: string | null): string {
  return value === null || value.trim() === ''
    ? '未填写'
    : `${props.model.currencyCode} ${value}`
}

const basicItems = computed<DescriptionItem[]>(() => [
  { label: '订单编号', value: '正式保存后由 SALES_ORDER 规则派发' },
  { label: '出单日期', value: props.model.orderDate },
  { label: '出单人', value: props.issuerLabel },
  { label: '订单币种', value: props.model.currencyCode },
])

const customerItems = computed<DescriptionItem[]>(() => [
  { label: '客户姓名', value: displayText(props.model.customerName) },
  { label: '客户电话', value: displayText(props.model.customerPhone) },
  {
    label: '三级地区',
    value: props.model.regionNames.length === 0
      ? '未选择'
      : props.model.regionNames.join(' / '),
  },
  { label: '完整地址', value: props.fullAddress || '未填写' },
])

const lineItems = computed<DescriptionItem[]>(() => props.model.lines.map((line, index) => {
  const productName = [line.productNo, line.name.trim()]
    .filter(value => value !== null && value !== '')
    .join(' · ') || '未选择产品'
  const standardPrice = line.lineType === 'CATALOG'
    ? displayMoney(line.standardUnitPriceAmount)
    : '不适用'
  const subtotal = calculateSalesOrderLineSubtotal([line], props.amountPrecision)

  return {
    key: `line-${index}`,
    label: `明细 ${index + 1}（${line.lineType === 'CATALOG' ? '数据库产品' : '仅本订单'}）`,
    value: `${productName}；标准价 ${standardPrice}；真实售价 ${displayMoney(line.actualUnitPriceAmount)} × ${line.quantity || '未填写'}；小计 ${displayMoney(subtotal)}`,
  }
}))

const salesItems = computed<DescriptionItem[]>(() => [
  { label: '产品明细汇总', value: displayMoney(props.lineSubtotalAmount) },
  { label: '手填销售总价', value: displayMoney(props.model.agreedTotalAmount) },
  { label: '约定定金', value: displayMoney(props.model.depositDueAmount) },
  { label: '约定尾款', value: displayMoney(props.model.balanceDueAmount) },
])

const documentItems = computed<DescriptionItem[]>(() => {
  const items: DescriptionItem[] = [
    { label: '凭证数量', value: props.model.documents.length },
  ]
  for (const [index, document] of props.model.documents.entries()) {
    const title = document.title.trim()
    items.push({
      key: `document-${index}`,
      label: `凭证 ${index + 1}（${documentTypeLabels[document.documentType]}）`,
      value: title === '' || title === document.originalFilename
        ? document.originalFilename
        : `${title}；原始文件 ${document.originalFilename}`,
    })
  }
  return items
})

const remarkItems = computed<DescriptionItem[]>(() => [
  { label: '订单备注', value: displayText(props.model.remark) },
])
</script>

<template>
  <FaCard
    title="核对并提交"
    description="请逐项核对；正式保存后才会派发订单编号。"
    content-class="space-y-6"
    data-testid="sales-order-create-review"
  >
    <section aria-labelledby="sales-order-review-basic">
      <h3 id="sales-order-review-basic" class="text-sm font-semibold m-0 mb-3">
        订单基础信息
      </h3>
      <FaDescriptions :items="basicItems" :column="1" border size="sm" label-width="8.5rem" />
    </section>

    <section aria-labelledby="sales-order-review-customer">
      <h3 id="sales-order-review-customer" class="text-sm font-semibold m-0 mb-3">
        客户与地址
      </h3>
      <FaDescriptions :items="customerItems" :column="1" border size="sm" label-width="8.5rem" />
    </section>

    <section aria-labelledby="sales-order-review-lines">
      <h3 id="sales-order-review-lines" class="text-sm font-semibold m-0 mb-3">
        产品明细
      </h3>
      <FaDescriptions :items="lineItems" :column="1" border size="sm" label-width="8.5rem" />
    </section>

    <section aria-labelledby="sales-order-review-sales">
      <h3 id="sales-order-review-sales" class="text-sm font-semibold m-0 mb-3">
        销售与付款约定
      </h3>
      <FaDescriptions :items="salesItems" :column="1" border size="sm" label-width="8.5rem" />
    </section>

    <section aria-labelledby="sales-order-review-documents">
      <h3 id="sales-order-review-documents" class="text-sm font-semibold m-0 mb-3">
        订单凭证
      </h3>
      <FaDescriptions :items="documentItems" :column="1" border size="sm" label-width="8.5rem" />
    </section>

    <section aria-labelledby="sales-order-review-remark">
      <h3 id="sales-order-review-remark" class="text-sm font-semibold m-0 mb-3">
        订单备注
      </h3>
      <FaDescriptions :items="remarkItems" :column="1" border size="sm" label-width="8.5rem" />
    </section>
  </FaCard>
</template>
