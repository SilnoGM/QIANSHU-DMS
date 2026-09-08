<script setup lang="ts">
import type { PartConfiguration, PartConfiguratorProduct } from '@/components/business/QsPartConfigurator/types'
import productFrontSrc from '@/assets/images/component-library/image-group/product-front.svg?url'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPartConfigurator from '@/components/business/QsPartConfigurator/index.vue'
import { validatePartConfigurations } from '@/components/business/QsPartConfigurator/logic'

defineOptions({ name: 'PartConfiguratorShowcase' })
const toast = useQsToast()
const parts = ref<readonly PartConfiguration[]>([])
const readonly = ref(false)
const disabled = ref(false)
const products: readonly PartConfiguratorProduct[] = [{
  key: 'fixture-part-product-a',
  productNo: 'SKU-TRAVEL-A',
  name: '城市旅行收纳包 A',
  description: '总数量 5，可先装入 2，再将剩余 3 与产品 B 合件。',
  quantity: 5,
  mainImage: { id: 'fixture-part-image-a', contentUrl: productFrontSrc },
}, {
  key: 'fixture-part-product-b',
  productNo: null,
  name: '本单防潮包装 B',
  description: '总数量 3，用于演示不同产品合并装件以及删除单项后的数量归还。',
  quantity: 3,
  mainImage: null,
}]
const validation = computed(() => validatePartConfigurations(products, parts.value))

function showSplitExample(): void {
  parts.value = [{
    key: '00000000-0000-4000-8000-000000000001',
    items: [{ productKey: products[0]!.key, quantity: 2 }],
  }, {
    key: '00000000-0000-4000-8000-000000000002',
    items: [{ productKey: products[0]!.key, quantity: 3 }, { productKey: products[1]!.key, quantity: 3 }],
  }]
}
</script>

<template>
  <section aria-label="货件配置器示例" class="p-4 border border-border rounded-xl bg-background sm:p-6">
    <div class="mb-6 flex flex-wrap gap-2">
      <FaButton type="button" variant="outline" @click="parts = []">
        清空并重新配置
      </FaButton>
      <FaButton type="button" variant="outline" @click="showSplitExample">
        载入 A5 拆分与合件示例
      </FaButton>
      <FaButton type="button" :variant="readonly ? 'default' : 'outline'" :aria-pressed="readonly" @click="readonly = !readonly">
        {{ readonly ? '返回编辑模式' : '查看只读核对模式' }}
      </FaButton>
      <FaButton type="button" :variant="disabled ? 'default' : 'outline'" :aria-pressed="disabled" @click="disabled = !disabled">
        {{ disabled ? '恢复操作' : '禁用操作' }}
      </FaButton>
    </div>
    <QsPartConfigurator v-model="parts" :products="products" :readonly="readonly" :disabled="disabled" @warning="toast.warning($event)" />
    <p class="text-sm mb-0 mt-5" :class="validation.valid ? 'text-primary' : 'text-muted-foreground'" aria-live="polite">
      {{ validation.valid ? '配置完整，全部产品数量已装入货件。' : `尚有 ${validation.remainingQuantity} 件产品未装入货件。` }}
    </p>
  </section>
</template>
