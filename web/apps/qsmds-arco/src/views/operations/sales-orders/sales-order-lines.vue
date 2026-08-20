<script setup lang="ts">
import type {
  SalesOrderFieldErrors,
  SalesOrderLineFormModel,
  SalesOrderLineType,
} from './sales-order-create.logic'
import type { SalesOrderProductOptionDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import {
  calculateSalesOrderLineSubtotal,
  createCatalogSalesOrderLine,
  createCustomSalesOrderLine,
} from './sales-order-create.logic'

defineOptions({ name: 'SalesOrderLines' })

const props = withDefaults(defineProps<{
  currency: 'TWD' | 'MYR'
  currencies: readonly CurrencyDescriptor[]
  disabled?: boolean
  fieldErrors?: SalesOrderFieldErrors
  modelValue: readonly SalesOrderLineFormModel[]
  productOptions: readonly SalesOrderProductOptionDto[]
}>(), {
  disabled: false,
  fieldErrors: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [value: SalesOrderLineFormModel[]]
}>()

const LINE_TYPE_OPTIONS = [
  { label: '数据库产品', value: 'CATALOG' },
  { label: '仅本订单的临时产品', value: 'CUSTOM' },
]

function replaceLine(index: number, line: SalesOrderLineFormModel): void {
  if (props.disabled) {
    return
  }
  emit('update:modelValue', props.modelValue.map((current, currentIndex) =>
    currentIndex === index ? line : { ...current }))
}

function patchLine(
  index: number,
  patch: Partial<SalesOrderLineFormModel>,
): void {
  const current = props.modelValue[index]
  if (current === undefined) {
    return
  }
  replaceLine(index, { ...current, ...patch })
}

function changeLineType(index: number, value: unknown): void {
  const current = props.modelValue[index]
  if (current === undefined || (value !== 'CATALOG' && value !== 'CUSTOM')) {
    return
  }
  const next = value === 'CATALOG'
    ? createCatalogSalesOrderLine(current.key)
    : createCustomSalesOrderLine(current.key)
  replaceLine(index, next)
}

function productSelectOptions(line: SalesOrderLineFormModel) {
  const options = [{
    disabled: true,
    label: '请选择数据库产品',
    value: `__empty_product_${line.key}`,
  }]
  const source = [...props.productOptions]
  if (
    line.productId !== null
    && !source.some(product => product.id === line.productId)
  ) {
    source.unshift({
      id: line.productId,
      productNo: line.productNo ?? '历史产品',
      name: line.name || '历史产品',
      attributes: [],
      standardUnitPriceAmount: line.standardUnitPriceAmount ?? '0.0000',
      currencyCode: props.currency,
    })
  }
  return [
    ...options,
    ...source.map(product => ({
      label: `${product.productNo} · ${product.name} · 标准价 ${product.standardUnitPriceAmount} ${props.currency}`,
      value: product.id,
    })),
  ]
}

function selectProduct(index: number, value: unknown): void {
  if (typeof value !== 'string') {
    return
  }
  const product = props.productOptions.find(option => option.id === value)
  if (product === undefined) {
    return
  }
  const current = props.modelValue[index]
  if (current === undefined) {
    return
  }
  patchLine(index, {
    productId: product.id,
    productNo: product.productNo,
    name: product.name,
    standardUnitPriceAmount: product.standardUnitPriceAmount,
    // 首次选择以标准价作为可编辑起点；用户仍需确认真实售价。
    actualUnitPriceAmount: current.productId === product.id
      ? current.actualUnitPriceAmount
      : product.standardUnitPriceAmount.replace(/0+$/u, '').replace(/\.$/u, ''),
  })
}

function addLine(type: SalesOrderLineType): void {
  if (props.disabled || props.modelValue.length >= 100) {
    return
  }
  const line = type === 'CATALOG'
    ? createCatalogSalesOrderLine()
    : createCustomSalesOrderLine()
  emit('update:modelValue', [...props.modelValue.map(item => ({ ...item })), line])
}

function removeLine(index: number): void {
  if (props.disabled || props.modelValue.length <= 1) {
    return
  }
  emit('update:modelValue', props.modelValue
    .filter((_line, currentIndex) => currentIndex !== index)
    .map(line => ({ ...line })))
}

function lineTotal(line: SalesOrderLineFormModel): string | null {
  const precision = props.currencies.find(item => item.code === props.currency)?.minorUnit ?? 4
  return calculateSalesOrderLineSubtotal([line], precision)
}
</script>

<template>
  <section aria-labelledby="sales-order-lines-title" class="min-w-0">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="sales-order-lines-title" class="text-base font-semibold m-0">
          产品明细
        </h2>
        <p class="text-sm text-muted-foreground m-0 mt-1">
          数据库产品按 {{ currency }} 标准价过滤；真实售价可在本单调整。数量只允许正整数。
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="disabled || modelValue.length >= 100"
          @click="addLine('CATALOG')"
        >
          <FaIcon name="i-lucide:database" aria-hidden="true" />添加数据库产品
        </FaButton>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="disabled || modelValue.length >= 100"
          @click="addLine('CUSTOM')"
        >
          <FaIcon name="i-lucide:package-plus" aria-hidden="true" />添加仅本订单产品
        </FaButton>
      </div>
    </div>

    <p v-if="fieldErrors.lines" class="text-sm text-destructive mb-3" role="alert">
      {{ fieldErrors.lines }}
    </p>

    <div class="gap-4 grid">
      <article
        v-for="(line, index) in modelValue"
        :key="line.key"
        class="p-4 border border-border rounded-lg bg-background min-w-0"
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-sm font-semibold m-0">
            第 {{ index + 1 }} 行
          </h3>
          <FaButton
            type="button"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :disabled="disabled || modelValue.length <= 1"
            :aria-label="`删除第 ${index + 1} 行产品`"
            @click="removeLine(index)"
          >
            <FaIcon name="i-lucide:trash-2" aria-hidden="true" />删除
          </FaButton>
        </div>

        <div class="gap-4 grid grid-cols-1 md:grid-cols-2">
          <!-- 产品行由本组件显式回写整行快照，关闭 FaFormItem 自动绑定以避免旧快照反向覆盖。 -->
          <FaFormItem :name="`lines.${index}.lineType`" label="产品来源" required :auto-bind="false">
            <FaSelect
              :model-value="line.lineType"
              :options="LINE_TYPE_OPTIONS"
              :disabled="disabled"
              class="w-full"
              @update:model-value="changeLineType(index, $event)"
            />
          </FaFormItem>

          <FaFormItem
            v-if="line.lineType === 'CATALOG'"
            :name="`lines.${index}.productId`"
            label="数据库产品"
            required
            :auto-bind="false"
          >
            <FaSelect
              :model-value="line.productId ?? `__empty_product_${line.key}`"
              :options="productSelectOptions(line)"
              :disabled="disabled"
              class="w-full"
              @update:model-value="selectProduct(index, $event)"
            />
          </FaFormItem>

          <FaFormItem
            v-else
            :name="`lines.${index}.name`"
            label="临时产品名称"
            required
            :auto-bind="false"
          >
            <FaInput
              :model-value="line.name"
              maxlength="128"
              class="w-full"
              :disabled="disabled"
              placeholder="仅保存在本订单快照中"
              @update:model-value="patchLine(index, { name: String($event ?? '') })"
            />
          </FaFormItem>

          <FaFormItem v-if="line.lineType === 'CATALOG'" :name="`lines.${index}.standardUnitPriceAmount`" label="标准价" :auto-bind="false">
            <div class="px-3 border border-border rounded-md bg-muted/30 flex min-h-10 items-center">
              <AmountDisplay
                :value="line.standardUnitPriceAmount"
                :currency="currency"
                :currencies="currencies"
              />
            </div>
          </FaFormItem>

          <FaFormItem
            :name="`lines.${index}.actualUnitPriceAmount`"
            label="真实售价"
            required
            :auto-bind="false"
          >
            <MoneyInput
              :model-value="line.actualUnitPriceAmount"
              :currency="currency"
              :currencies="currencies"
              :disabled="disabled"
              min="0"
              name="actualUnitPriceAmount"
              @update:model-value="patchLine(index, { actualUnitPriceAmount: $event })"
            />
          </FaFormItem>

          <FaFormItem
            :name="`lines.${index}.quantity`"
            label="产品数量"
            required
            :auto-bind="false"
          >
            <FaInput
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              :model-value="line.quantity"
              class="w-full"
              :disabled="disabled"
              @update:model-value="patchLine(index, { quantity: String($event ?? '') })"
            />
          </FaFormItem>

          <FaFormItem v-if="line.lineType === 'CUSTOM'" :name="`lines.${index}.description`" label="临时产品说明" :auto-bind="false">
            <FaTextarea
              :model-value="line.description"
              maxlength="1000"
              class="w-full"
              :disabled="disabled"
              placeholder="可选"
              @update:model-value="patchLine(index, { description: String($event ?? '') })"
            />
          </FaFormItem>

          <div class="p-3 border border-border rounded-lg bg-muted/25 md:col-span-2">
            <span class="text-xs text-muted-foreground">本行小计</span>
            <div class="qs-type-data-emphasis mt-1">
              <AmountDisplay
                :value="lineTotal(line)"
                :currency="currency"
                :currencies="currencies"
              />
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
