<script setup lang="ts">
import type {
  MoneyDiscountRate,
  MoneyDiscountRateTrend,
} from '../../base/MoneyInput/logic'
import type { ProductSelectionChange } from '../QsProductSelector/types'
import type {
  OrderProductLineEditorProps,
  OrderProductLineModel,
} from './types'

import AmountDisplay from '../../base/AmountDisplay/index.vue'
import MoneyInput from '../../base/MoneyInput/index.vue'
import { resolveMoneyDiscountRate } from '../../base/MoneyInput/logic'
import QsProductSelector from '../QsProductSelector/index.vue'
import {
  applyProductSelectionChanges,
  calculateOrderProductLineTotals,
  createTemporaryOrderProductLine,
  MAXIMUM_QUANTITY,
} from './logic'

defineOptions({ name: 'QsOrderProductLineEditor' })

const props = withDefaults(defineProps<OrderProductLineEditorProps>(), {
  catalogLineInitialActualUnitPriceAmount: '0.00',
  catalogProductAddable: true,
  customProductAddable: true,
  customReferenceUnitPriceEditable: false,
  disabled: false,
  fieldErrors: () => ({}),
  fixedProductSupplierValue: undefined,
  maximumLines: 100,
  maximumQuantityByKey: () => ({}),
  minimumQuantityByKey: () => ({}),
  removalDisabledByKey: () => ({}),
  nameEditableByKey: () => ({}),
  lineConstraintDescriptionByKey: () => ({}),
  productSelectionDescription: undefined,
  readOnlyLines: () => ([]),
  showDiscountRate: false,
  temporaryLineInitialActualUnitPriceAmount: '0.00',
})

const emit = defineEmits<{
  'quantityMinimumReached': [lineKey: string, minimumQuantity: number]
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
  emit('update:modelValue', [
    ...cloneLines(),
    createTemporaryOrderProductLine(
      undefined,
      props.temporaryLineInitialActualUnitPriceAmount,
    ),
  ])
}

function applySelection(changes: readonly ProductSelectionChange[]): void {
  const removesLockedLine = changes.some(change => (
    change.kind === 'REMOVE' && props.removalDisabledByKey[change.lineKey] === true
  ))
  if (removesLockedLine) {
    selectionError.value = '存在有效采购单的产品不能删除或更换产品身份'
    return
  }
  const result = applyProductSelectionChanges(
    props.modelValue,
    changes,
    props.maximumLines,
    props.catalogLineInitialActualUnitPriceAmount,
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
  const line = props.modelValue[index]
  if (props.disabled || line === undefined || props.removalDisabledByKey[line.key] === true) {
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

/**
 * 行级领域错误由销售、采购页面计算，编辑器只负责把精确字段错误放回对应输入框。
 * 使用稳定字段路径可以同时服务可见提示、无障碍关联和页面的首错聚焦。
 */
function lineFieldError(index: number, field: string): string | undefined {
  return props.fieldErrors[`lines.${index}.${field}`]
}

function lineFieldErrorId(index: number, field: string): string {
  return `order-product-line-${index}-${field}-error`
}

function lineMaximumQuantity(line: OrderProductLineModel): number | undefined {
  const maximumQuantity = props.maximumQuantityByKey[line.key]
  return typeof maximumQuantity === 'number'
    && Number.isSafeInteger(maximumQuantity)
    && maximumQuantity > 0
    ? maximumQuantity
    : undefined
}

function lineMinimumQuantity(line: OrderProductLineModel): number {
  const minimumQuantity = props.minimumQuantityByKey[line.key]
  return typeof minimumQuantity === 'number'
    && Number.isSafeInteger(minimumQuantity)
    && minimumQuantity > 0
    ? minimumQuantity
    : 1
}

function hasExplicitMinimumQuantity(line: OrderProductLineModel): boolean {
  const minimumQuantity = props.minimumQuantityByKey[line.key]
  return typeof minimumQuantity === 'number'
    && Number.isSafeInteger(minimumQuantity)
    && minimumQuantity > 0
}

function parsedLineQuantity(line: OrderProductLineModel): number | null {
  if (!/^[1-9]\d*$/u.test(line.quantity)) {
    return null
  }
  const quantity = Number(line.quantity)
  return Number.isSafeInteger(quantity) && quantity <= MAXIMUM_QUANTITY
    ? quantity
    : null
}

/**
 * 已采购数量是领域硬下限，但减少按钮仍保持可点击，才能在用户再次尝试越界时
 * 给出明确反馈。普通新增行没有显式下限，降至 1 后继续减少仍沿用原来的静默行为。
 */
function decreaseLineQuantity(index: number): void {
  const line = props.modelValue[index]
  if (props.disabled || line === undefined) {
    return
  }
  const quantity = parsedLineQuantity(line)
  if (quantity === null) {
    return
  }
  const minimumQuantity = lineMinimumQuantity(line)
  if (quantity <= minimumQuantity) {
    if (hasExplicitMinimumQuantity(line)) {
      emit('quantityMinimumReached', line.key, minimumQuantity)
    }
    return
  }
  patchLine(index, { quantity: String(quantity - 1) })
}

function increaseLineQuantity(index: number): void {
  const line = props.modelValue[index]
  if (props.disabled || line === undefined) {
    return
  }
  const quantity = parsedLineQuantity(line)
  const maximumQuantity = lineMaximumQuantity(line) ?? MAXIMUM_QUANTITY
  if (quantity === null || quantity >= maximumQuantity) {
    return
  }
  patchLine(index, { quantity: String(quantity + 1) })
}

function lineDiscountRate(line: OrderProductLineModel): MoneyDiscountRate | null {
  if (line.lineType !== 'CATALOG') {
    return null
  }

  return resolveMoneyDiscountRate(
    line.actualUnitPriceAmount,
    line.standardUnitPriceAmount,
  )
}

function discountRateTextClass(trend: MoneyDiscountRateTrend | undefined): string {
  if (trend === 'below') {
    return 'text-destructive'
  }
  if (trend === 'above') {
    return 'text-primary'
  }
  return 'text-foreground'
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
      <div v-if="catalogProductAddable || customProductAddable" class="flex flex-col gap-2 sm:flex-row">
        <FaButton
          v-if="catalogProductAddable"
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="disabled"
          @click="openSelector"
        >
          <FaIcon name="i-lucide:database" aria-hidden="true" />添加数据库产品
        </FaButton>
        <FaButton
          v-if="customProductAddable"
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
      <table data-slot="order-product-line-table" class="text-sm min-w-[128rem] w-full border-collapse">
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
            <th scope="col" data-column="reference-unit-price" class="font-medium p-3 w-44">
              {{ labels.referenceUnitPrice }}
            </th>
            <th scope="col" class="font-medium p-3 w-72">
              {{ labels.actualUnitPrice }}
            </th>
            <th v-if="showDiscountRate" scope="col" class="font-medium p-3 w-28">
              折扣率
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
          <tr v-if="modelValue.length === 0 && readOnlyLines.length === 0">
            <td :colspan="showDiscountRate ? 11 : 10" class="p-0">
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
            :class="lineConstraintDescriptionByKey[line.key] ? 'bg-amber-500/[0.025]' : ''"
          >
            <!-- FaFormItem 固定预留错误提示高度；可编辑字段下移半个提示行，使输入框
                 与只读文字保持视觉居中，同时仍把校验信息留在输入框下方。 -->
            <td class="p-3 whitespace-nowrap">
              {{ line.lineType === 'CATALOG' ? labels.catalogProduct : labels.temporaryProduct }}
            </td>
            <td class="font-mono p-3 whitespace-nowrap">
              {{ line.lineType === 'CATALOG' ? line.productNo : labels.temporaryProductNo }}
            </td>
            <td class="p-3">
              <FaFormItem
                v-if="line.lineType === 'CUSTOM' || nameEditableByKey[line.key]"
                :name="`lines.${index}.name`"
                :label="`第 ${index + 1} 行产品名称`"
                required
                :auto-bind="false"
                class="top-2 relative"
                label-class="sr-only"
              >
                <FaTooltip :text="line.name" :disabled="line.name === ''">
                  <FaInput
                    :model-value="line.name"
                    :aria-describedby="lineFieldError(index, 'name') ? lineFieldErrorId(index, 'name') : undefined"
                    :aria-invalid="Boolean(lineFieldError(index, 'name'))"
                    :aria-label="`第 ${index + 1} 行产品名称`"
                    maxlength="128"
                    class="w-full"
                    :disabled="disabled"
                    placeholder="输入产品名称"
                    @update:model-value="patchLine(index, { name: String($event ?? '') })"
                  />
                </FaTooltip>
              </FaFormItem>
              <p
                v-if="lineFieldError(index, 'name')"
                :id="lineFieldErrorId(index, 'name')"
                class="text-xs text-destructive m-0 mt-1"
                role="alert"
              >
                {{ lineFieldError(index, 'name') }}
              </p>
              <FaTooltip v-if="line.lineType !== 'CUSTOM' && !nameEditableByKey[line.key]" :text="line.name" :disabled="line.name === ''">
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
            <td data-column="reference-unit-price" class="p-3 whitespace-nowrap">
              <FaFormItem
                v-if="line.lineType === 'CUSTOM' && customReferenceUnitPriceEditable"
                :name="`lines.${index}.standardUnitPriceAmount`"
                :label="`第 ${index + 1} 行${labels.referenceUnitPrice}`"
                required
                :auto-bind="false"
                class="top-2 relative"
                label-class="sr-only"
              >
                <MoneyInput
                  :model-value="line.standardUnitPriceAmount"
                  :aria-describedby="lineFieldError(index, 'standardUnitPriceAmount') ? lineFieldErrorId(index, 'standardUnitPriceAmount') : undefined"
                  :aria-invalid="Boolean(lineFieldError(index, 'standardUnitPriceAmount'))"
                  :aria-label="`第 ${index + 1} 行${labels.referenceUnitPrice}`"
                  :currency="currency"
                  :currencies="currencies"
                  min="0"
                  :disabled="disabled"
                  input-class="text-primary !font-bold"
                  name="standardUnitPriceAmount"
                  @update:model-value="patchLine(index, { standardUnitPriceAmount: $event })"
                />
              </FaFormItem>
              <AmountDisplay
                v-else-if="line.lineType === 'CATALOG' && line.standardUnitPriceAmount !== null"
                :value="line.standardUnitPriceAmount"
                :currency="currency"
                :currencies="currencies"
                class="text-primary font-bold"
              />
              <span v-else-if="line.lineType === 'CATALOG'" class="text-muted-foreground">暂无</span>
              <span v-else class="text-muted-foreground">—</span>
              <p
                v-if="lineFieldError(index, 'standardUnitPriceAmount')"
                :id="lineFieldErrorId(index, 'standardUnitPriceAmount')"
                class="text-xs text-destructive m-0 mt-1 whitespace-normal"
                role="alert"
              >
                {{ lineFieldError(index, 'standardUnitPriceAmount') }}
              </p>
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.actualUnitPriceAmount`"
                :label="`第 ${index + 1} 行${labels.actualUnitPrice}`"
                required
                :auto-bind="false"
                class="top-2 relative"
                label-class="sr-only"
              >
                <MoneyInput
                  :model-value="line.actualUnitPriceAmount"
                  :aria-describedby="lineFieldError(index, 'actualUnitPriceAmount') ? lineFieldErrorId(index, 'actualUnitPriceAmount') : undefined"
                  :aria-invalid="Boolean(lineFieldError(index, 'actualUnitPriceAmount'))"
                  :aria-label="`第 ${index + 1} 行${labels.actualUnitPrice}`"
                  :currency="currency"
                  :currencies="currencies"
                  min="0"
                  :disabled="disabled"
                  input-class="text-destructive !font-bold"
                  name="actualUnitPriceAmount"
                  @update:model-value="patchLine(index, { actualUnitPriceAmount: $event })"
                />
              </FaFormItem>
              <p
                v-if="lineFieldError(index, 'actualUnitPriceAmount')"
                :id="lineFieldErrorId(index, 'actualUnitPriceAmount')"
                class="text-xs text-destructive m-0 mt-1"
                role="alert"
              >
                {{ lineFieldError(index, 'actualUnitPriceAmount') }}
              </p>
            </td>
            <td v-if="showDiscountRate" class="p-3 whitespace-nowrap">
              <span :class="discountRateTextClass(lineDiscountRate(line)?.trend)">
                {{ lineDiscountRate(line)?.formattedValue ?? '—' }}
              </span>
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.quantity`"
                :label="`第 ${index + 1} 行产品数量`"
                required
                :auto-bind="false"
                class="top-2 relative"
                label-class="sr-only"
              >
                <FaInput
                  type="number"
                  :min="lineMinimumQuantity(line)"
                  :max="lineMaximumQuantity(line)"
                  step="1"
                  inputmode="numeric"
                  :model-value="line.quantity"
                  :aria-describedby="lineFieldError(index, 'quantity') ? lineFieldErrorId(index, 'quantity') : undefined"
                  :aria-invalid="Boolean(lineFieldError(index, 'quantity'))"
                  :aria-label="`第 ${index + 1} 行产品数量`"
                  :disabled="disabled"
                  class="order-product-quantity-input w-full"
                  input-class="text-center"
                  @update:model-value="patchLine(index, { quantity: String($event ?? '') })"
                  @keydown.down.prevent="decreaseLineQuantity(index)"
                  @keydown.up.prevent="increaseLineQuantity(index)"
                >
                  <template #start>
                    <FaButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="rounded-none size-8"
                      :disabled="disabled"
                      :aria-label="`减少第 ${index + 1} 行产品数量`"
                      @click="decreaseLineQuantity(index)"
                    >
                      <FaIcon name="i-lucide:minus" aria-hidden="true" />
                    </FaButton>
                  </template>
                  <template #end>
                    <FaButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="rounded-none size-8"
                      :disabled="disabled"
                      :aria-label="`增加第 ${index + 1} 行产品数量`"
                      @click="increaseLineQuantity(index)"
                    >
                      <FaIcon name="i-lucide:plus" aria-hidden="true" />
                    </FaButton>
                  </template>
                </FaInput>
              </FaFormItem>
              <p
                v-if="lineFieldError(index, 'quantity')"
                :id="lineFieldErrorId(index, 'quantity')"
                class="text-xs text-destructive m-0 mt-1"
                role="alert"
              >
                {{ lineFieldError(index, 'quantity') }}
              </p>
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
                class="top-2 relative"
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
              <FaTooltip
                v-if="removalDisabledByKey[line.key]"
                :text="lineConstraintDescriptionByKey[line.key] || '该产品不能删除'"
              >
                <span
                  tabindex="0"
                  class="text-amber-700 outline-none rounded-full inline-flex size-9 items-center justify-center dark:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-500"
                  :aria-label="lineConstraintDescriptionByKey[line.key] || '该产品不能删除'"
                >
                  <FaIcon name="i-lucide:lock-keyhole" aria-hidden="true" />
                </span>
              </FaTooltip>
              <FaButton
                v-else
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
          <!-- 历史已采购行与 modelValue 物理隔离并统一后置：它们只说明销售来源的
               已处理数量，不参与当前采购单编辑、金额汇总或提交事件。 -->
          <tr
            v-for="line in readOnlyLines"
            :key="line.key"
            data-readonly-line
            class="text-muted-foreground align-middle border-b border-border bg-muted/55 last:border-b-0"
            :aria-label="`${line.statusLabel}：${line.name}`"
          >
            <td class="p-3 whitespace-nowrap">
              {{ line.lineType === 'CATALOG' ? labels.catalogProduct : labels.temporaryProduct }}
            </td>
            <td class="font-mono p-3 whitespace-nowrap">
              {{ line.lineType === 'CATALOG' ? line.productNo : labels.temporaryProductNo }}
            </td>
            <td class="p-3">
              <FaTooltip :text="line.name" :disabled="line.name === ''">
                <span tabindex="0" class="max-w-80 block truncate">{{ line.name }}</span>
              </FaTooltip>
            </td>
            <td class="p-3">
              <div class="border border-border rounded-lg bg-background/70 flex size-14 items-center justify-center overflow-hidden">
                <img
                  v-if="line.lineType === 'CATALOG' && line.mainImage && !failedImages.has(line.key)"
                  :src="line.mainImage.contentUrl"
                  :alt="line.name"
                  class="opacity-70 size-full object-cover grayscale"
                  loading="lazy"
                  @error="markImageFailed(line.key)"
                >
                <FaIcon
                  v-else-if="line.lineType === 'CATALOG'"
                  name="i-lucide:image"
                  class="text-muted-foreground size-5"
                  aria-label="暂无产品主图"
                />
                <span v-else aria-label="临时产品无主图">—</span>
              </div>
            </td>
            <td data-column="reference-unit-price" class="p-3 whitespace-nowrap">
              <AmountDisplay
                :value="line.standardUnitPriceAmount"
                :currency="currency"
                :currencies="currencies"
                class="text-muted-foreground"
              />
            </td>
            <td class="p-3 whitespace-nowrap">
              <AmountDisplay
                :value="line.actualUnitPriceAmount"
                :currency="currency"
                :currencies="currencies"
                class="text-muted-foreground"
              />
            </td>
            <td v-if="showDiscountRate" class="p-3 whitespace-nowrap">
              —
            </td>
            <td class="font-mono p-3 whitespace-nowrap">
              {{ line.quantity }}
            </td>
            <td class="p-3 whitespace-nowrap">
              <AmountDisplay
                :value="line.actualSubtotalAmount"
                :currency="currency"
                :currencies="currencies"
                class="text-muted-foreground"
              />
            </td>
            <td class="p-3">
              <FaTooltip :text="line.description" :disabled="line.description === ''">
                <span tabindex="0" class="max-w-64 block truncate">
                  {{ line.description || '—' }}
                </span>
              </FaTooltip>
            </td>
            <td class="p-3 text-right whitespace-nowrap">
              <span class="font-medium inline-flex gap-1.5 items-center">
                <span>{{ line.statusLabel }}</span>
                <FaTooltip :text="line.statusDescription">
                  <span
                    tabindex="0"
                    role="img"
                    :aria-label="line.statusDescription"
                    class="outline-none rounded-full inline-flex size-5 cursor-help items-center justify-center focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <FaIcon name="i-lucide:info" class="size-4" aria-hidden="true" />
                  </span>
                </FaTooltip>
              </span>
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
      v-if="catalogProductAddable"
      v-model="selectorOpen"
      :currency="currency"
      :existing-lines="existingCatalogLines"
      :load-products="loadProducts"
      :disabled="disabled"
      :description="productSelectionDescription"
      :fixed-supplier-value="fixedProductSupplierValue"
      @confirm="applySelection"
    />
  </section>
</template>

<style scoped>
.order-product-quantity-input :deep(input[type="number"]) {
  appearance: textfield;
}

.order-product-quantity-input :deep(input[type="number"]::-webkit-inner-spin-button),
.order-product-quantity-input :deep(input[type="number"]::-webkit-outer-spin-button) {
  margin: 0;
  appearance: none;
}
</style>
