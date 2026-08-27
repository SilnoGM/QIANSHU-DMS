<script setup lang="ts">
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { ProductSelectorCurrency } from '@/components/business/QsProductSelector/types'

import QsOrderProductLineEditor from '@/components/business/QsOrderProductLineEditor/index.vue'
import { dictionaryCatalogProviderKey } from '@/dictionary-catalog/injection'
import {
  createOrderProductFixtureEditorLines,
  createOrderProductFixtureLoader,
  createOrderProductFixtureProvider,
  ORDER_PRODUCT_FIXTURE_CURRENCIES,
} from '../fixtures/order-product.fixture'

defineOptions({ name: 'OrderProductLineEditorShowcase' })

provide(dictionaryCatalogProviderKey, createOrderProductFixtureProvider())
const currency = ref<ProductSelectorCurrency>('TWD')
const lines = ref<readonly OrderProductLineModel[]>(createOrderProductFixtureEditorLines('TWD'))
// Showcase 需要模拟正式订单页提供的 FaForm 上下文，否则编辑器内部的 FaFormItem 会在 setup 阶段拒绝渲染。
// 使用 reactive 包装现有 lines ref，可让 FaForm 始终读取当前示例明细，同时保持组件原有 v-model 演示方式不变。
const formModel = reactive({ lines })
const loader = createOrderProductFixtureLoader()
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

function switchCurrency(nextCurrency: ProductSelectorCurrency): void {
  currency.value = nextCurrency
  lines.value = createOrderProductFixtureEditorLines(nextCurrency)
}

function clearLines(): void {
  lines.value = []
}

function restoreLines(): void {
  lines.value = createOrderProductFixtureEditorLines(currency.value)
}
</script>

<template>
  <section class="p-5 border border-border rounded-xl bg-background sm:p-7" aria-label="订单产品明细编辑器示例">
    <div class="mb-5 flex flex-wrap gap-2 items-center justify-between">
      <div class="flex flex-wrap gap-2" aria-label="示例币种">
        <FaButton type="button" :variant="currency === 'TWD' ? 'default' : 'outline'" @click="switchCurrency('TWD')">
          TWD 示例
        </FaButton>
        <FaButton type="button" :variant="currency === 'MYR' ? 'default' : 'outline'" @click="switchCurrency('MYR')">
          MYR 示例
        </FaButton>
      </div>
      <div class="flex flex-wrap gap-2">
        <FaButton type="button" variant="outline" @click="clearLines">
          验收空表
        </FaButton>
        <FaButton type="button" variant="outline" @click="restoreLines">
          恢复示例明细
        </FaButton>
      </div>
    </div>
    <FaForm :model="formModel" as="div">
      <QsOrderProductLineEditor
        v-model="lines"
        :currency="currency"
        :currencies="ORDER_PRODUCT_FIXTURE_CURRENCIES"
        :labels="labels"
        :load-products="loader"
      />
    </FaForm>
  </section>
</template>
