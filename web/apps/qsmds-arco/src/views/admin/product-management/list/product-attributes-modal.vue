<script setup lang="ts">
import type { ProductListItemViewModel } from './product-list.logic'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

const props = defineProps<{
  modelValue: boolean
  product: ProductListItemViewModel | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const title = computed(() => props.product === null
  ? '产品属性'
  : `${props.product.name} · 产品属性`)

function updateVisible(value: boolean): void {
  emit('update:modelValue', value)
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="title"
    description="按产品原始顺序展示全部属性，属性内容仅供查看。"
    size="lg"
    @update:model-value="updateVisible"
  >
    <dl v-if="product" class="m-0 border border-border rounded-lg divide-border divide-y">
      <div
        v-for="(attribute, index) in product.attributes"
        :key="`${index}-${attribute.title}`"
        class="p-4 gap-2 grid sm:grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)]"
      >
        <dt class="qs-type-compact-label break-words">
          {{ attribute.title }}
        </dt>
        <dd class="qs-type-body m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ attribute.value }}
        </dd>
      </div>
    </dl>
    <FaEmpty
      v-else
      icon="i-lucide:list-tree"
      title="暂无产品属性"
      description="当前产品没有可展示的属性。"
      class="py-8"
    />

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="close"
      >
        关闭属性
      </FaButton>
    </template>
  </QsGenericModal>
</template>
