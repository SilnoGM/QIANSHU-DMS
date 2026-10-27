<script setup lang="ts">
import type { PartConfiguration, PartConfiguratorProps } from './types'
import { computed, ref, useId, watch } from 'vue'
import {
  appendPartConfiguration,
  formatPartLabel,
  getPartAllocationState,
  getPendingPartProducts,
  MAX_PART_CONFIGURATIONS,
  MAX_PART_ITEMS,
  parsePartQuantity,
  removePartConfiguration,
  removePartConfigurationItem,
} from './logic'
import PartProductSummary from './PartProductSummary.vue'

defineOptions({ name: 'QsPartConfigurator' })
const props = withDefaults(defineProps<PartConfiguratorProps>(), { disabled: false, readonly: false })
const emit = defineEmits<{
  'update:modelValue': [parts: readonly PartConfiguration[]]
  'warning': [message: string]
}>()
const { t } = useI18n()
const instanceId = useId()
const selectedKeys = ref<string[]>([])
const quantities = ref<Record<string, string>>({})
const openPartKey = ref<string | null>(null)
const visiblePartLimit = ref(50)
const editable = computed(() => !props.disabled && !props.readonly)
const allocation = computed(() => getPartAllocationState(props.products, props.modelValue))
const pendingProducts = computed(() => getPendingPartProducts(props.products, props.modelValue))
const productByKey = computed(() => new Map(props.products.map(product => [product.key, product])))
const visibleParts = computed(() => props.modelValue.slice(0, visiblePartLimit.value))
const itemCount = computed(() => props.modelValue.reduce((count, part) => count + part.items.length, 0))
const itemLimitReached = computed(() => itemCount.value + Math.max(1, selectedKeys.value.length) > MAX_PART_ITEMS)
const selectedItems = computed(() => selectedKeys.value.map(productKey => ({
  productKey,
  quantity: parsePartQuantity(quantityDraft(productKey)) ?? 0,
})))
const canCreate = computed(() => editable.value
  && allocation.value.errors.length === 0
  && props.modelValue.length < MAX_PART_CONFIGURATIONS
  && !itemLimitReached.value
  && selectedItems.value.length > 0
  && selectedItems.value.every(item => item.quantity > 0 && item.quantity <= remaining(item.productKey)))
const allPendingSelected = computed(() => pendingProducts.value.length > 0
  && pendingProducts.value.every(product => selectedKeys.value.includes(product.key)))

function remaining(key: string): number {
  return allocation.value.remainingByProduct.get(key) ?? 0
}

function quantityDraft(key: string): string {
  return quantities.value[key] ?? '1'
}

function quantityInvalid(key: string): boolean {
  const quantity = parsePartQuantity(quantityDraft(key))
  return remaining(key) > 0 && (quantity === null || quantity > remaining(key))
}

function toggleProduct(key: string, selected: boolean | 'indeterminate' | null | undefined): void {
  if (!editable.value || remaining(key) <= 0) {
    return
  }
  selectedKeys.value = selected === true
    ? [...new Set([...selectedKeys.value, key])]
    : selectedKeys.value.filter(item => item !== key)
}

function updateQuantity(key: string, quantity: string | number | undefined): void {
  if (editable.value) {
    quantities.value = { ...quantities.value, [key]: String(quantity ?? '') }
  }
}

function resetDrafts(keys: readonly string[]): void {
  quantities.value = Object.fromEntries(Object.entries(quantities.value).filter(([key]) => !keys.includes(key)))
}

// 全选只改勾选状态，不改写用户已填或默认的本次装入数量。
function toggleSelectAll(): void {
  if (!editable.value || pendingProducts.value.length === 0) {
    return
  }
  selectedKeys.value = allPendingSelected.value
    ? []
    : pendingProducts.value.map(product => product.key)
}

function createPart(): void {
  if (!editable.value) {
    return
  }
  const result = appendPartConfiguration(props.products, props.modelValue, selectedItems.value)
  if (!result.ok) {
    emit('warning', result.message)
    return
  }
  resetDrafts(selectedKeys.value)
  selectedKeys.value = []
  emit('update:modelValue', result.parts)
}

function removePart(key: string): void {
  if (editable.value) {
    resetDrafts(props.modelValue.find(part => part.key === key)?.items.map(item => item.productKey) ?? [])
    emit('update:modelValue', removePartConfiguration(props.modelValue, key))
  }
}

function removeItem(partKey: string, productKey: string): void {
  if (editable.value) {
    resetDrafts([productKey])
    emit('update:modelValue', removePartConfigurationItem(props.modelValue, partKey, productKey))
  }
}

function togglePart(key: string): void {
  openPartKey.value = openPartKey.value === key ? null : key
}

// 只清理内部临时选择；上游配置发生超量、产品删除等变化时必须由父级显式处理。
watch(allocation, () => {
  selectedKeys.value = selectedKeys.value.filter(key => productByKey.value.has(key) && remaining(key) > 0)
  if (!props.modelValue.some(part => part.key === openPartKey.value)) {
    openPartKey.value = null
  }
})
</script>

<template>
  <section data-slot="qs-part-configurator" :aria-label="t('partConfigurator.configurator')" class="min-w-0 space-y-5">
    <FaAlert v-if="allocation.errors.length > 0" variant="destructive" :title="t('partConfigurator.invalid')" :description="allocation.errors.join('；')" />

    <section v-if="!readonly" :aria-label="t('partConfigurator.products')" class="space-y-3">
      <div>
        <h3 class="text-base font-semibold m-0">
          {{ t('partConfigurator.products') }}
        </h3>
        <p class="text-xs text-muted-foreground leading-5 mb-0 mt-1">
          {{ t('partConfigurator.selectionHelp') }}
        </p>
      </div>
      <p v-if="pendingProducts.length === 0 && allocation.errors.length === 0" class="text-sm text-muted-foreground py-3" role="status">
        {{ t('partConfigurator.allocated') }}
      </p>
      <FaCard v-for="product in pendingProducts" :key="product.key" class="py-0 gap-0 shadow-none" content-class="p-4" data-slot="part-product" :data-product-key="product.key">
        <div class="flex gap-3 items-start">
          <FaCheckbox
            :model-value="selectedKeys.includes(product.key)"
            :disabled="disabled || remaining(product.key) <= 0"
            class="mt-4 shrink-0"
            label-class="sr-only"
            data-slot="part-select"
            @update:model-value="toggleProduct(product.key, $event)"
          >
            {{ t('partConfigurator.selectProduct', { name: product.name }) }}
          </FaCheckbox>
          <div class="flex flex-1 flex-col gap-4 min-w-0 sm:flex-row sm:items-start">
            <PartProductSummary :product="product" class="flex-1" />
            <div class="flex shrink-0 gap-5 items-start sm:justify-end">
              <div class="min-w-16 space-y-2">
                <p class="text-xs text-muted-foreground m-0">
                  {{ t('partConfigurator.remaining') }}
                </p>
                <p class="text-sm font-semibold m-0" :class="remaining(product.key) < 0 ? 'text-destructive' : 'text-foreground'">
                  {{ remaining(product.key) }}
                </p>
              </div>
              <div class="w-36 space-y-1.5">
                <label :for="`${instanceId}-${product.key}`" class="text-xs text-muted-foreground block">{{ t('partConfigurator.loadQuantity') }}</label>
                <FaInput
                  :id="`${instanceId}-${product.key}`"
                  :model-value="quantityDraft(product.key)"
                  :disabled="disabled || remaining(product.key) <= 0"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  data-part-quantity
                  :aria-label="t('partConfigurator.inputQuantity', { name: product.name })"
                  :aria-invalid="quantityInvalid(product.key)"
                  :aria-describedby="quantityInvalid(product.key) ? `${instanceId}-${product.key}-error` : undefined"
                  class="w-full"
                  @update:model-value="updateQuantity(product.key, $event)"
                />
                <p v-if="quantityInvalid(product.key)" :id="`${instanceId}-${product.key}-error`" class="text-xs text-destructive m-0" role="alert">
                  {{ t('partConfigurator.invalidQuantity', { maximum: remaining(product.key) }) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </FaCard>
      <div class="flex flex-wrap gap-3 items-center">
        <FaButton type="button" :disabled="!canCreate" data-action="create-part" @click="createPart">
          <FaIcon name="i-lucide:package-plus" class="size-4" aria-hidden="true" />
          {{ t('partConfigurator.create') }}
        </FaButton>
        <FaButton v-if="pendingProducts.length > 0" type="button" variant="outline" :disabled="!editable" data-action="select-all" @click="toggleSelectAll">
          <FaIcon name="i-lucide:list-checks" class="size-4" aria-hidden="true" />
          {{ t(allPendingSelected ? 'partConfigurator.clearSelection' : 'partConfigurator.selectAll') }}
        </FaButton>
        <span class="text-xs text-muted-foreground" aria-live="polite">{{ t('partConfigurator.selected', { count: selectedKeys.length }) }}</span>
        <span v-if="modelValue.length >= MAX_PART_CONFIGURATIONS" class="text-xs text-muted-foreground">{{ t('partConfigurator.limit', { count: MAX_PART_CONFIGURATIONS }) }}</span>
        <span v-if="itemLimitReached" class="text-xs text-muted-foreground">{{ t('partConfigurator.itemLimit', { count: MAX_PART_ITEMS }) }}</span>
      </div>
    </section>

    <section :aria-label="t('partConfigurator.parts')" class="space-y-3">
      <div class="flex gap-2 items-baseline justify-between">
        <h3 class="text-base font-semibold m-0">
          {{ t('partConfigurator.parts') }}
        </h3>
        <span class="text-xs text-muted-foreground" aria-live="polite">{{ t('partConfigurator.partCount', { count: modelValue.length }) }}</span>
      </div>
      <p v-if="modelValue.length === 0" class="text-sm text-muted-foreground py-6 text-center border border-border rounded-lg border-dashed">
        {{ t('partConfigurator.empty') }}<span class="text-xs mt-1 block">{{ t(readonly ? 'partConfigurator.readonlyEmpty' : 'partConfigurator.emptyHelp') }}</span>
      </p>
      <FaCard v-for="(part, index) in visibleParts" :key="part.key" class="py-0 gap-0 shadow-none" content-class="p-0" data-slot="part-card" :data-part-key="part.key">
        <div class="p-2 flex gap-1 items-start">
          <FaButton
            type="button"
            variant="ghost"
            class="px-2 py-2 text-left flex-1 h-auto min-w-0 justify-start"
            :aria-expanded="openPartKey === part.key"
            :aria-controls="`${instanceId}-part-${part.key}`"
            @click="togglePart(part.key)"
          >
            <FaIcon :name="openPartKey === part.key ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'" class="mt-0.5 shrink-0 size-4 self-start" aria-hidden="true" />
            <span class="flex-1 min-w-0 block">
              <span class="text-sm font-semibold block">{{ formatPartLabel(index) }}</span>
              <span class="text-xs text-muted-foreground font-normal mt-1 block whitespace-normal break-words">{{ t('partConfigurator.pendingMark') }}</span>
              <span class="text-xs text-muted-foreground font-normal mt-1 block">{{ t('partConfigurator.partStats', { types: part.items.length, quantity: part.items.reduce((total, item) => total + item.quantity, 0) }) }}</span>
            </span>
          </FaButton>
          <FaButton v-if="!readonly" type="button" variant="ghost" size="icon" :disabled="disabled" :aria-label="t('partConfigurator.removePart', { label: formatPartLabel(index) })" class="text-muted-foreground shrink-0 hover:text-destructive" @click="removePart(part.key)">
            <FaIcon name="i-lucide:trash-2" class="size-4" aria-hidden="true" />
          </FaButton>
        </div>
        <FaCollapsible :model-value="openPartKey === part.key">
          <!-- 仅挂载当前展开货件的内容，大批货件保持标题列表，不复制所有产品 DOM。 -->
          <div v-if="openPartKey === part.key" :id="`${instanceId}-part-${part.key}`" class="px-4 border-t border-border divide-border divide-y">
            <div v-for="item in part.items" :key="item.productKey" class="py-4 flex flex-wrap gap-3 items-start">
              <PartProductSummary :product="productByKey.get(item.productKey)" class="flex-1 min-w-40" />
              <div class="text-right shrink-0 min-w-24">
                <p class="text-xs text-muted-foreground m-0">
                  {{ t('partConfigurator.loadedQuantity') }}
                </p>
                <p class="text-sm font-semibold mb-0 mt-1">
                  {{ item.quantity }}
                </p>
              </div>
              <FaButton v-if="!readonly" type="button" variant="ghost" size="icon" :disabled="disabled" :aria-label="t('partConfigurator.removeItem', { label: formatPartLabel(index), name: productByKey.get(item.productKey)?.name || t('partConfigurator.missingProduct') })" class="text-muted-foreground shrink-0 hover:text-destructive" @click="removeItem(part.key, item.productKey)">
                <FaIcon name="i-lucide:x" class="size-4" aria-hidden="true" />
              </FaButton>
            </div>
          </div>
        </FaCollapsible>
      </FaCard>
      <FaButton v-if="visibleParts.length < modelValue.length" type="button" variant="outline" class="w-full" @click="visiblePartLimit += 50">
        {{ t('partConfigurator.showMore', { count: modelValue.length - visibleParts.length }) }}
      </FaButton>
    </section>
  </section>
</template>
