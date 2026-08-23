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

function productComboboxOptions(line: SalesOrderLineFormModel) {
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
  return source.map(product => ({
    label: `${product.productNo} · ${product.name} · 标准价 ${product.standardUnitPriceAmount} ${props.currency}`,
    value: product.id,
  }))
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
  if (props.disabled) {
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

    <!-- 可编辑业务字段留在领域组件内；语义化 table 负责稳定列关系，外层只承担窄屏横向滚动。 -->
    <div class="border border-border rounded-lg bg-background overflow-x-auto">
      <table class="text-sm min-w-[96rem] w-full border-collapse">
        <caption class="sr-only">
          销售订单产品明细
        </caption>
        <thead class="bg-muted/45">
          <tr class="text-left border-b border-border">
            <th scope="col" class="font-medium p-3 w-40">
              产品来源
            </th>
            <th scope="col" class="font-medium p-3 min-w-72">
              产品／名称
            </th>
            <th scope="col" class="font-medium p-3 w-44">
              产品编号
            </th>
            <th scope="col" class="font-medium p-3 w-44">
              标准价
            </th>
            <th scope="col" class="font-medium p-3 w-52">
              真实售价
            </th>
            <th scope="col" class="font-medium p-3 w-32">
              产品数量
            </th>
            <th scope="col" class="font-medium p-3 min-w-64">
              产品说明
            </th>
            <th scope="col" class="font-medium p-3 w-44">
              本行小计
            </th>
            <th scope="col" class="font-medium p-3 text-right w-24">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="modelValue.length === 0">
            <td colspan="9" class="p-0">
              <FaEmpty
                icon="i-lucide:shopping-basket"
                title="暂无产品明细"
                description="请添加数据库产品或仅本订单产品。"
                class="py-12"
              />
            </td>
          </tr>
          <tr
            v-for="(line, index) in modelValue"
            :key="line.key"
            class="align-top border-b border-border last:border-b-0"
          >
            <!-- 行内字段仍保留真实 label 与表单错误定位，只在视觉上由表头统一表达字段名。 -->
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.lineType`"
                :label="`第 ${index + 1} 行产品来源`"
                required
                :auto-bind="false"
                label-class="sr-only"
              >
                <FaSelect
                  :model-value="line.lineType"
                  :options="LINE_TYPE_OPTIONS"
                  :disabled="disabled"
                  class="w-full"
                  @update:model-value="changeLineType(index, $event)"
                />
              </FaFormItem>
            </td>
            <td class="p-3">
              <FaFormItem
                v-if="line.lineType === 'CATALOG'"
                :name="`lines.${index}.productId`"
                label="数据库产品"
                required
                :auto-bind="false"
                label-class="sr-only"
              >
                <FaCombobox
                  :model-value="line.productId ?? undefined"
                  :options="productComboboxOptions(line)"
                  :disabled="disabled"
                  placeholder="输入产品编号或名称筛选"
                  :empty-text="`没有可选的 ${currency} 产品`"
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
                label-class="sr-only"
              >
                <FaInput
                  :model-value="line.name"
                  maxlength="128"
                  class="w-full"
                  :disabled="disabled"
                  placeholder="输入临时产品名称"
                  @update:model-value="patchLine(index, { name: String($event ?? '') })"
                />
              </FaFormItem>
            </td>
            <td class="p-3">
              <span class="flex min-h-9 break-all items-center">
                {{ line.lineType === 'CATALOG' ? (line.productNo || '选择产品后显示') : '仅本订单' }}
              </span>
            </td>
            <td class="p-3">
              <div class="flex min-h-9 items-center">
                <AmountDisplay
                  v-if="line.lineType === 'CATALOG'"
                  :value="line.standardUnitPriceAmount"
                  :currency="currency"
                  :currencies="currencies"
                />
                <span v-else class="text-muted-foreground">—</span>
              </div>
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.actualUnitPriceAmount`"
                label="真实售价"
                required
                :auto-bind="false"
                label-class="sr-only"
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
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.quantity`"
                label="产品数量"
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
                  class="w-full"
                  :disabled="disabled"
                  @update:model-value="patchLine(index, { quantity: String($event ?? '') })"
                />
              </FaFormItem>
            </td>
            <td class="p-3">
              <FaFormItem
                :name="`lines.${index}.description`"
                :label="`第 ${index + 1} 行产品说明`"
                :auto-bind="false"
                label-class="sr-only"
              >
                <FaTextarea
                  :model-value="line.description"
                  maxlength="1000"
                  rows="2"
                  class="min-h-9 w-full"
                  :disabled="disabled"
                  :placeholder="line.lineType === 'CUSTOM' ? '可选' : '可补充本单说明'"
                  @update:model-value="patchLine(index, { description: String($event ?? '') })"
                />
              </FaFormItem>
            </td>
            <td class="p-3">
              <div class="qs-type-data-emphasis flex min-h-9 whitespace-nowrap items-center">
                <AmountDisplay
                  :value="lineTotal(line)"
                  :currency="currency"
                  :currencies="currencies"
                />
              </div>
            </td>
            <td class="p-3 text-right">
              <FaButton
                type="button"
                variant="ghost"
                size="icon"
                class="min-h-9"
                :disabled="disabled"
                :aria-label="`删除第 ${index + 1} 行产品`"
                @click="removeLine(index)"
              >
                <FaIcon name="i-lucide:trash-2" aria-hidden="true" />
              </FaButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
