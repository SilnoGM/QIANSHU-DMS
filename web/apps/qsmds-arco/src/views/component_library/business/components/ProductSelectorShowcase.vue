<script setup lang="ts">
import type {
  ProductPageLoader,
  ProductSelectionChange,
} from '@/components/business/QsProductSelector/types'

import QsProductSelector from '@/components/business/QsProductSelector/index.vue'
import { dictionaryCatalogProviderKey } from '@/dictionary-catalog/injection'
import {
  createOrderProductFixtureLoader,
  createOrderProductFixtureProvider,
  ORDER_PRODUCT_FIXTURE_EXISTING_LINES,
} from '../fixtures/order-product.fixture'

defineOptions({ name: 'ProductSelectorShowcase' })

provide(dictionaryCatalogProviderKey, createOrderProductFixtureProvider())
const open = ref(false)
const summary = ref('尚未确认产品')
const failNextRequest = ref(false)
const fixtureLoader = createOrderProductFixtureLoader()
const loader: ProductPageLoader = async (query, signal) => {
  if (failNextRequest.value) {
    failNextRequest.value = false
    throw new Error('Fixture request failed')
  }
  return fixtureLoader(query, signal)
}

function armFailure(): void {
  failNextRequest.value = true
  summary.value = '已准备模拟下一次产品查询失败；打开选择器或修改筛选即可验收重试。'
}

function handleConfirm(changes: readonly ProductSelectionChange[]): void {
  const addCount = changes.filter(change => change.kind === 'ADD').length
  const incrementCount = changes.filter(change => change.kind === 'INCREMENT')
    .reduce((total, change) => total + change.delta, 0)
  const removeCount = changes.filter(change => change.kind === 'REMOVE').length
  summary.value = `新增 ${addCount} 项，数量增加 ${incrementCount}，删除 ${removeCount} 项`
}
</script>

<template>
  <section class="p-5 border border-border rounded-xl bg-background sm:p-7" aria-labelledby="product-selector-showcase-title">
    <div class="flex flex-wrap gap-4 items-start justify-between">
      <div>
        <h3 id="product-selector-showcase-title" class="text-xl tracking-tight font-semibold m-0">
          产品选择会话
        </h3>
        <p class="text-sm text-muted-foreground m-0 mt-2">
          内存数据包含 37 个产品、三个供应商和一条已有明细，可验收筛选、滚动分页与数量 +1。
        </p>
      </div>
      <div class="flex flex-wrap gap-2 justify-end">
        <FaButton type="button" variant="outline" @click="armFailure">
          <FaIcon name="i-lucide:triangle-alert" aria-hidden="true" />模拟下一次查询失败
        </FaButton>
        <FaButton type="button" @click="open = true">
          <FaIcon name="i-lucide:package-search" aria-hidden="true" />打开产品选择器
        </FaButton>
      </div>
    </div>
    <p class="text-sm text-primary m-0 mt-5" role="status">
      {{ summary }}
    </p>

    <QsProductSelector
      v-model="open"
      currency="TWD"
      :existing-lines="ORDER_PRODUCT_FIXTURE_EXISTING_LINES"
      :load-products="loader"
      @confirm="handleConfirm"
    />
  </section>
</template>
