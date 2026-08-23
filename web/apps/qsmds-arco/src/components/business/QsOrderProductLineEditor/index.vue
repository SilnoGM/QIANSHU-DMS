<script setup lang="ts">
import type { ProductSelectionChange } from '../QsProductSelector/types'
import type {
  OrderProductLineEditorProps,
  OrderProductLineModel,
} from './types'

import AmountDisplay from '../../base/AmountDisplay/index.vue'
import MoneyInput from '../../base/MoneyInput/index.vue'
import QsProductSelector from '../QsProductSelector/index.vue'
import {
  applyProductSelectionChanges,
  calculateOrderProductLineTotals,
  createTemporaryOrderProductLine,
} from './logic'

defineOptions({ name: 'QsOrderProductLineEditor' })

const props = withDefaults(defineProps<OrderProductLineEditorProps>(), {
  disabled: false,
  fieldErrors: () => ({}),
  maximumLines: 100,
})

const emit = defineEmits<{
  'update:modelValue': [value: readonly OrderProductLineModel[]]
}>()

const selectorOpen = ref(false)
const selectionError = ref('')
const failedImages = shallowRef<ReadonlySet<string>>(new Set())

const existingCatalogLines = computed(() => props.modelValue.flatMap(line => (
  line.lineType === 'CATALOG'
  && line.productId !== null
  && line.productNo !== null
    ? [{
        key: line.key,
        productId: line.productId,
        productNo: line.productNo,
        name: line.name,
        quantity: line.quantity,
      }]
    : []
)))
const precision = computed(() => (
  props.currencies.find(item => item.code === props.currency)?.minorUnit ?? 4
))
const totals = computed(() => calculateOrderProductLineTotals(
  props.modelValue,
  precision.value,
))

function cloneLines(): OrderProductLineModel[] {
  return props.modelValue.map(line => ({ ...line }))
}

function openSelector(): void {
  // 即使明细已达到上限，也必须允许打开选择器删除已有数据库产品或增加数量；
  // 行数上限只约束最终确认后的新增结果。
  if (props.disabled) {
    return
  }
  selectionError.value = ''
  selectorOpen.value = true
}

function addTemporaryLine(): void {
  if (props.disabled || props.modelValue.length >= props.maximumLines) {
    return
  }
  selectionError.value = ''
  emit('update:modelValue', [...cloneLines(), createTemporaryOrderProductLine()])
}

function applySelection(changes: readonly ProductSelectionChange[]): void {
  const result = applyProductSelectionChanges(
    props.modelValue,
    changes,
    props.maximumLines,
  )
  if (!result.ok) {
    selectionError.value = result.message
    return
  }
  selectionError.value = ''
  emit('update:modelValue', result.lines)
}

function patchLine(index: number, patch: Partial<OrderProductLineModel>): void {
  if (props.disabled || props.modelValue[index] === undefined) {
    return
  }
  emit('update:modelValue', props.modelValue.map((line, currentIndex) => (
    currentIndex === index ? { ...line, ...patch } : { ...line }
  )))
}

function removeLine(index: number): void {
  if (props.disabled) {
    return
  }
  emit('update:modelValue', props.modelValue
    .filter((_line, currentIndex) => currentIndex !== index)
    .map(line => ({ ...line })))
}

function markImageFailed(key: string): void {
  failedImages.value = new Set([...failedImages.value, key])
}

function lineActualSubtotal(line: OrderProductLineModel): string | null {
  return calculateOrderProductLineTotals([line], precision.value).actualTotal
}
</script>

<template>
  <section aria-labelledby="order-product-line-editor-title" class="min-w-0">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="order-product-line-editor-title" class="text-base font-semibold m-0">
          产品明细
        </h2>
        <p class="text-sm text-muted-foreground m-0 mt-1">
          {{ labels.catalogProduct }}选择不限制币种；{{ labels.referenceUnitPrice }}按 {{ currency }} 显示，无则需手填{{ labels.actualUnitPrice }}。
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="disabled"
          @click="openSelector"
        >
          <FaIcon name="i-lucide:database" aria-hidden="true" />添加数据库产品
        </FaButton>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="disabled || modelValue.length >= maximumLines"
          @click="addTemporaryLine"
        >
          <FaIcon name="i-lucide:package-plus" aria-hidden="true" />添加临时产品
        </FaButton>
      </div>
    </div>

    <p v-if="fieldErrors.lines" class="text-sm text-destructive mb-3" role="alert">
      {{ fieldErrors.lines }}
    </p>
    <p v-if="selectionError" class="text-sm text-destructive mb-3" role="alert">
      {{ selectionError }}
    </p>

    <div class="border border-border rounded-xl bg-background overflow-x-auto">
      <table class="text-sm min-w-[120rem] w-full border-collapse">
        <caption class="sr-only">
          订单产品明细
        </caption>
        <thead class="bg-muted/45">
          <tr class="text-left border-b border-border">
            <th scope="col" class="font-medium p-3 w-32">
              产品来源
            </th>
            <th scope="col" class="font-medium p-3 w-44">
              产品编号
            </th>
            <th scope="col" class="font-medium p-3 w-80">
              产品名称
            </th>
            <th scope="col" class="font-medium p-3 w-28">
              产品主图
            </th>
            <th scope="col" class="font-medium p-3 w-44">
              {{ labels.referenceUnitPrice }}
            </th>
            <th scope="col" class="font-medium p-3 w-72">
              {{ labels.actualUnitPrice }}
            </th>
            <th scope="col" class="font-medium p-3 w-32">
              产品数量
            </th>
            <th scope="col" class="font-medium p-3 w-48">
              {{ labels.actualSubtotal }}
            </th>
            <th scope="col" class="font-medium p-3 min-w-64">
              备注
            </th>
            <th scope="col" class="font-medium p-3 text-right w-20">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="modelValue.length === 0">
            <td colspan="10" class="p-0">
              <FaEmpty
                icon="i-lucide:shopping-basket"
                title="暂无产品明细"
                description="请添加数据库产品或临时产品。"
                class="py-12"
              />
            </td>
          </tr>
          <tr
            v-for="(line, index) in modelValue"
            :key="line.key"
            class="align-middle border-b border-border last:border-b-0"
          >
            <td class="p-3 whitespace-nowrap">
              {{ line.lineType === 'CATALOG' ? labels.catalogProduct : labels.temporaryProduct }}
            </td>
            <td class="font-mono p-3 whitespace-nowrap">
              {{ line.lineType === 'CATALOG' ? line.productNo : labels.temporaryProductNo }}
            </td>
            <td class="p-3">
              <FaFormItem
                v-if="line.lineType === 'CUSTOM'"
                :name="`lines.${index}.name`"
                :label="`第 ${index + 1} 行产品名称`"
                required
                :auto-bind="false"
                label-class="sr-only"
              >
                <FaTooltip :text="line.name" :disabled="line.name === ''">
                  <FaInput
                    :model-value="line.name"
                    maxlength="128"
                    class="w-full"
                    :disabled="disabled"
                    placeholder="输入临时产品名称"
                    @update:model-value="patchLine(index, { name: String($event ?? '') })"
                  />
                </FaTooltip>
              </FaFormItem>
              <FaTooltip v-else :text="line.name" :disabled="line.name === ''">
                <span tabindex="0" class="max-w-80 block truncate">{{ line.name }}</span>
              </FaTooltip>
            </td>
            <td class="p-3">
              <div class="border border-border rounded-lg bg-muted/30 flex size-14 items-center justify-center overflow-hidden">
                <img
                  v-if="line.lineType === 'CATALOG' && line.mainImage && !failedImages.has(line.key)"
                  :src="line.mainImage.contentUrl"
                  :alt="line.name"
                  class="size-full object-cover"
                  loading="lazy"
                  @error="markImageFailed(line.key)"
                >
                <FaIcon
                  v-else-if="line.lineType === 'CATALOG'"
                  name="i-lucide:image"
                  class="text-muted-foreground size-5"
                  aria-label="暂无产品主图"
                />
                <span v-else class="text-muted-foreground" aria-label="临时产品无主图">—</span>
              </div>
            </td>
            <td class="p-3 whitespace-nowrap">
              <AmountDisplay
                v-if="line.lineType === 'CATALOG' && line.standardUnitPriceAmount !== null"
                :value="line.standardUnitPriceAmount"
                :currency="currency"
                :currencies="currencies"
                class="text-primary font-bold"
              />
              <span v-else-if="line.lineType === 'CATALOG'" class="text-muted-foreground">暂无</span>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.actualUnitPriceAmount`"
                :label="`第 ${index + 1} 行${labels.actualUnitPrice}`"
                required
                :auto-bind="false"
                label-class="sr-only"
              >
                <MoneyInput
                  :model-value="line.actualUnitPriceAmount"
                  :currency="currency"
                  :currencies="currencies"
                  min="0"
                  :disabled="disabled"
                  input-class="text-destructive !font-bold"
                  name="actualUnitPriceAmount"
                  @update:model-value="patchLine(index, { actualUnitPriceAmount: $event })"
                />
              </FaFormItem>
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.quantity`"
                :label="`第 ${index + 1} 行产品数量`"
                required
                :auto-bind="false"
                label-class="sr-only"
              >
                <FaInput
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  :model-value="line.quantity"
                  :disabled="disabled"
                  class="w-full"
                  @update:model-value="patchLine(index, { quantity: String($event ?? '') })"
                />
              </FaFormItem>
            </td>
            <td class="qs-type-data-emphasis p-3 whitespace-nowrap">
              <AmountDisplay
                :value="lineActualSubtotal(line)"
                :currency="currency"
                :currencies="currencies"
                class="text-destructive font-bold"
              />
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.description`"
                :label="`第 ${index + 1} 行备注`"
                :auto-bind="false"
                label-class="sr-only"
              >
                <FaTooltip :text="line.description" :disabled="line.description === ''">
                  <FaInput
                    :model-value="line.description"
                    maxlength="1000"
                    class="w-full"
                    :disabled="disabled"
                    placeholder="可选"
                    @update:model-value="patchLine(index, { description: String($event ?? '') })"
                  />
                </FaTooltip>
              </FaFormItem>
            </td>
            <td class="p-3 text-right">
              <FaButton
                type="button"
                variant="ghost"
                size="icon"
                :disabled="disabled"
                :aria-label="`删除第 ${index + 1} 行${line.name || '产品'}`"
                @click="removeLine(index)"
              >
                <FaIcon name="i-lucide:trash-2" aria-hidden="true" />
              </FaButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 汇总属于整张订单，不跟随明细表横向滚动；保持纯文字层级，避免再形成第二层面板。 -->
    <div class="mt-4 px-1 text-right flex flex-col gap-2 items-end" aria-label="产品金额汇总">
      <div class="flex gap-2 whitespace-nowrap items-baseline justify-end">
        <span class="text-xs text-primary font-semibold">{{ labels.referenceTotal }}：</span>
        <AmountDisplay
          :value="totals.standardTotal"
          :currency="currency"
          :currencies="currencies"
          class="text-lg text-primary font-bold"
        />
      </div>
      <p
        v-if="totals.missingStandardPriceCount > 0"
        class="text-xs text-muted-foreground m-0"
      >
        其中 {{ totals.missingStandardPriceCount }} 项暂无 {{ currency }} 标准价，未计入汇总。
      </p>
      <div class="flex gap-2 whitespace-nowrap items-baseline justify-end">
        <span class="text-xs text-destructive font-semibold">{{ labels.actualTotal }}：</span>
        <AmountDisplay
          :value="totals.actualTotal"
          :currency="currency"
          :currencies="currencies"
          class="text-lg text-destructive font-bold"
        />
      </div>
    </div>

    <QsProductSelector
      v-model="selectorOpen"
      :currency="currency"
      :existing-lines="existingCatalogLines"
      :load-products="loadProducts"
      :disabled="disabled"
      @confirm="applySelection"
    />
  </section>
</template>
