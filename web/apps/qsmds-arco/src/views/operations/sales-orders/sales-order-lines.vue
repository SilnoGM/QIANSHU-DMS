<script setup lang="ts">
import type {
  SalesOrderFieldErrors,
  SalesOrderLineFormModel,
} from './sales-order-create.logic'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { ProductPageLoader } from '@/components/business/QsProductSelector/types'

import QsOrderProductLineEditor from '@/components/business/QsOrderProductLineEditor/index.vue'

defineOptions({ name: 'SalesOrderLines' })

withDefaults(defineProps<{
  currency: 'TWD' | 'MYR'
  currencies: readonly CurrencyDescriptor[]
  disabled?: boolean
  fieldErrors?: SalesOrderFieldErrors
  loadProducts: ProductPageLoader
  modelValue: readonly SalesOrderLineFormModel[]
}>(), {
  disabled: false,
  fieldErrors: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [value: SalesOrderLineFormModel[]]
}>()

const labels = {
  referenceUnitPrice: '标准价',
  actualUnitPrice: '本单售价',
  actualSubtotal: '本单售价小计',
  referenceTotal: '标准价汇总',
  actualTotal: '本单售价汇总',
  catalogProduct: '数据库产品',
  temporaryProduct: '临时产品',
  temporaryProductNo: '仅本订单',
} as const

/**
 * 通用编辑器模型与销售创建会话保持结构兼容；销售适配层只负责领域类型边界，
 * 最终 DTO 构建仍由 sales-order-create.logic.ts 执行并忽略 mainImage。
 */
function handleUpdate(value: readonly OrderProductLineModel[]): void {
  emit('update:modelValue', value.map(line => ({ ...line })))
}
</script>

<template>
  <QsOrderProductLineEditor
    :model-value="modelValue"
    :currency="currency"
    :currencies="currencies"
    :disabled="disabled"
    :field-errors="fieldErrors"
    :labels="labels"
    :load-products="loadProducts"
    show-discount-rate
    @update:model-value="handleUpdate"
  />
</template>
