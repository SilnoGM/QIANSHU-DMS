<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  ProductFieldErrors,
  ProductFormModel,
} from './product-form.logic'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { MoneyValidationResult } from '@/components/base/MoneyInput/logic'

import MoneyInput from '@/components/base/MoneyInput/index.vue'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'

import ProductAttributesEditor from './product-attributes-editor.vue'
import ProductTaxonomySelect from './product-taxonomy-select.vue'

export type ProductFormCatalogState = 'empty' | 'error' | 'loading' | 'ready'

export interface ProductTaxonomyHeadOption {
  readonly id: string
  readonly name: string
}

export interface ProductTaxonomyCategoryOption {
  readonly id: string
  readonly name: string
  readonly supplierValue: string
  readonly productHeads: readonly ProductTaxonomyHeadOption[]
}

export interface ProductFormExpose {
  applyFieldErrors: (
    errors: ProductFieldErrors,
    focusFirst?: boolean,
  ) => Promise<void>
  focusFirstError: () => Promise<boolean>
  resetValidation: () => void
}

interface ProductAttributesEditorExpose {
  focusField: (path: string) => boolean
}

defineOptions({ name: 'ProductForm' })

const props = withDefaults(defineProps<{
  canCreateTaxonomy?: boolean
  currencyCatalogState?: ProductFormCatalogState
  disabled?: boolean
  fieldErrors?: ProductFieldErrors
  modelValue: ProductFormModel
  myrCurrencies: readonly CurrencyDescriptor[]
  mode?: 'create' | 'edit'
  productNo?: string
  purchaseCurrencies: readonly CurrencyDescriptor[]
  showActions?: boolean
  submitting?: boolean
  supplierCatalogState?: ProductFormCatalogState
  taxonomyCatalogState?: ProductFormCatalogState
  taxonomyOptions?: readonly ProductTaxonomyCategoryOption[]
  twdCurrencies: readonly CurrencyDescriptor[]
}>(), {
  canCreateTaxonomy: true,
  currencyCatalogState: 'ready',
  disabled: false,
  fieldErrors: () => ({}),
  mode: 'create',
  productNo: undefined,
  showActions: true,
  submitting: false,
  supplierCatalogState: 'ready',
  taxonomyCatalogState: 'ready',
  taxonomyOptions: () => [],
})

const emit = defineEmits<{
  cancel: []
  retryCurrencyCatalog: []
  retrySupplierCatalog: []
  retryTaxonomyCatalog: []
  submit: []
  patch: [value: Partial<ProductFormModel>]
}>()

const formRef = useTemplateRef<FormExpose<ProductFormModel>>('formRef')
const attributesRef = useTemplateRef<ProductAttributesEditorExpose>('attributesRef')
const localMoneyErrors = ref<ProductFieldErrors>({})
const twdCurrency = ref('TWD')
const myrCurrency = ref('MYR')

const SIMPLE_FIELD_ORDER = Object.freeze([
  'supplierValue',
  'categoryName',
  'productHeadName',
  'name',
  'twdSalePrice.amount',
  'twdSalePrice.currency',
  'myrSalePrice.amount',
  'myrSalePrice.currency',
  'purchaseCost.amount',
  'purchaseCost.currency',
  'idempotencyKey',
])

const submitLocked = computed(() => props.disabled || props.submitting)
const visibleFieldErrors = computed<ProductFieldErrors>(() => ({
  ...props.fieldErrors,
  ...localMoneyErrors.value,
}))
const fixedCurrencyUnavailable = computed(() => (
  props.currencyCatalogState === 'ready'
  && (
    props.twdCurrencies.length !== 1
    || props.myrCurrencies.length !== 1
    || props.purchaseCurrencies.length === 0
  )
))
const isEdit = computed(() => props.mode === 'edit')
const scopedTaxonomyOptions = computed(() => (
  props.taxonomyOptions.filter(category => (
    category.supplierValue === props.modelValue.supplierValue
  ))
))
const categoryOptions = computed(() => (
  scopedTaxonomyOptions.value.map(category => category.name)
))
const productHeadOptions = computed(() => (
  scopedTaxonomyOptions.value.find(category => (
    category.name === props.modelValue.categoryName
  ))?.productHeads.map(head => head.name) ?? []
))
const statusLabel = computed(() => (
  props.modelValue.status === 'ACTIVE' ? '启用' : '停用'
))
const statusClass = computed(() => (
  props.modelValue.status === 'ACTIVE'
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-border bg-muted text-muted-foreground'
))
const taxonomyDisabled = computed(() => (
  submitLocked.value || props.taxonomyCatalogState === 'loading'
))

function updateModel(patch: Partial<ProductFormModel>): void {
  if (submitLocked.value) {
    return
  }
  /*
   * FaInput 的 passive v-model 会在 watcher 阶段向上提交。这里只报告当前字段
   * 补丁，由页面基于自己的最新 formModel 合并，避免子组件从陈旧 props 复制
   * 整个对象并覆盖同一批次内已经到达的金额或属性更新。
   */
  emit('patch', patch)
}

function handleSupplierUpdate(value: string | null): void {
  updateModel({
    categoryName: null,
    productHeadName: null,
    supplierValue: value,
  })
}

function handleCategoryUpdate(value: string | null): void {
  const nextHeads = scopedTaxonomyOptions.value.find(category => (
    category.name === value
  ))?.productHeads.map(head => head.name) ?? []
  const keepHead = value !== null
    && props.modelValue.productHeadName !== null
    && nextHeads.includes(props.modelValue.productHeadName)
  updateModel({
    categoryName: value,
    productHeadName: keepHead ? props.modelValue.productHeadName : null,
  })
}

function handleProductHeadUpdate(value: string | null): void {
  updateModel({ productHeadName: value })
}

function handleMoneyValidation(
  field: 'myrSalePrice.amount' | 'purchaseCost.amount' | 'twdSalePrice.amount',
  result: MoneyValidationResult,
): void {
  const next = { ...localMoneyErrors.value }
  if (result.valid) {
    delete next[field]
  }
  else {
    next[field] = result.message
  }
  localMoneyErrors.value = next
  void applyFieldErrors(visibleFieldErrors.value, false)
}

function resolveRegisteredField(path: string): string | undefined {
  if (path === 'twdSalePrice.amount' || path === 'twdSalePrice.currency') {
    return 'twdSalePriceAmount'
  }
  if (path === 'myrSalePrice.amount' || path === 'myrSalePrice.currency') {
    return 'myrSalePriceAmount'
  }
  if (path === 'purchaseCost.amount' || path === 'purchaseCost.currency') {
    return 'purchaseCostAmount'
  }
  if (path === 'idempotencyKey' || path.startsWith('attributes.')) {
    return undefined
  }
  return path
}

function orderedErrorPaths(errors: ProductFieldErrors): readonly string[] {
  const paths = Object.keys(errors)
  const simple = SIMPLE_FIELD_ORDER.filter(path => paths.includes(path))
  const attributes = paths
    .filter(path => /^attributes\.(?:\d|[1-4]\d)\.(?:title|value)$/u.test(path))
    .sort((left, right) => {
      const leftIndex = Number(left.split('.')[1])
      const rightIndex = Number(right.split('.')[1])
      return leftIndex - rightIndex || left.localeCompare(right, 'en')
    })
  return [...simple, ...attributes]
}

async function applyFieldErrors(
  errors: ProductFieldErrors,
  focusFirst = true,
): Promise<void> {
  formRef.value?.clearValidate()
  const groupedMessages = new Map<string, string>()
  for (const path of orderedErrorPaths(errors)) {
    const registeredField = resolveRegisteredField(path)
    const message = errors[path]
    if (
      registeredField !== undefined
      && message !== undefined
      && !groupedMessages.has(registeredField)
    ) {
      groupedMessages.set(registeredField, message)
    }
  }
  for (const [field, message] of groupedMessages) {
    formRef.value?.setFieldError(field, message)
  }
  if (focusFirst) {
    await focusFirstErrorFor(errors)
  }
}

async function focusFirstErrorFor(
  errors: ProductFieldErrors,
): Promise<boolean> {
  const [firstPath] = orderedErrorPaths(errors)
  if (firstPath === undefined) {
    return false
  }
  // 错误节点由 Vue 在下一帧渲染，必须等待后再滚动和聚焦。
  await nextTick()
  if (firstPath.startsWith('attributes.')) {
    return attributesRef.value?.focusField(firstPath) ?? false
  }
  const registeredField = resolveRegisteredField(firstPath)
  return registeredField === undefined
    ? false
    : (formRef.value?.scrollToField(registeredField) ?? false)
}

function focusFirstError(): Promise<boolean> {
  return focusFirstErrorFor(visibleFieldErrors.value)
}

function resetValidation(): void {
  localMoneyErrors.value = {}
  formRef.value?.clearValidate()
}

function submit(): void {
  if (!submitLocked.value) {
    emit('submit')
  }
}

function cancel(): void {
  if (!submitLocked.value) {
    emit('cancel')
  }
}

watch(
  () => props.fieldErrors,
  errors => void applyFieldErrors(errors, Object.keys(errors).length > 0),
  { deep: true, flush: 'post' },
)

defineExpose<ProductFormExpose>({
  applyFieldErrors,
  focusFirstError,
  resetValidation,
})
</script>

<template>
  <FaForm
    ref="formRef"
    :model="modelValue"
    :disabled="submitLocked"
    :aria-busy="submitting ? 'true' : 'false'"
    class="gap-6 grid grid-cols-1 lg:grid-cols-12"
    @submit="submit"
  >
    <FaCard
      title="归属与识别"
      :description="isEdit
        ? '供应商、分类与产品头决定产品的归属；产品编号是只读身份。'
        : '供应商、分类与产品头决定产品归属，产品编号由系统自动派发。'"
      class="min-w-0 lg:col-span-8"
      content-class="gap-4 grid"
    >
      <FaFormItem
        name="supplierValue"
        label="供应商"
        required
        description="必填；分类与产品头选项按该供应商过滤。"
      >
        <QsDictionarySelect
          :model-value="modelValue.supplierValue"
          dictionary-code="service_provider.supplier"
          :disabled="submitLocked"
          placeholder="请选择供应商"
          @update:model-value="handleSupplierUpdate"
        />
      </FaFormItem>

      <p
        v-if="supplierCatalogState === 'loading'"
        class="text-xs text-muted-foreground m-0"
        role="status"
      >
        正在加载供应商资料…
      </p>
      <FaAlert
        v-else-if="supplierCatalogState === 'error'"
        title="供应商资料加载失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            供应商为必填项；请重试后再选择。
          </p>
          <FaButton
            type="button"
            variant="outline"
            class="mt-3 min-h-11 sm:min-h-9"
            :disabled="submitLocked"
            @click="emit('retrySupplierCatalog')"
          >
            重试
          </FaButton>
        </template>
      </FaAlert>
      <FaAlert
        v-else-if="supplierCatalogState === 'empty'"
        title="暂无可用供应商"
        description="没有可用供应商时不能保存产品。"
        variant="destructive"
        role="alert"
      />

      <div class="gap-4 grid sm:grid-cols-2">
        <FaFormItem
          name="categoryName"
          label="分类"
          :required="!isEdit"
          :description="isEdit
            ? '历史产品可暂不填写；填写时需与产品头同时有值。'
            : '先选择供应商，再选择该供应商下的分类。'"
        >
          <ProductTaxonomySelect
            :model-value="modelValue.categoryName"
            :options="categoryOptions"
            :allow-create="canCreateTaxonomy"
            create-label="新建分类"
            placeholder="请选择分类"
            select-label="分类"
            :disabled="taxonomyDisabled || modelValue.supplierValue === null"
            @update:model-value="handleCategoryUpdate"
          />
        </FaFormItem>

        <FaFormItem
          name="productHeadName"
          label="产品头"
          :required="!isEdit"
          :description="modelValue.categoryName === null
            ? '请先选择分类，产品头选项会按分类过滤。'
            : '仅显示当前分类下的产品头，也可新建。'"
        >
          <ProductTaxonomySelect
            :model-value="modelValue.productHeadName"
            :options="productHeadOptions"
            :allow-create="canCreateTaxonomy"
            create-label="新建产品头"
            placeholder="请选择产品头"
            select-label="产品头"
            :disabled="taxonomyDisabled || modelValue.categoryName === null"
            @update:model-value="handleProductHeadUpdate"
          />
        </FaFormItem>
      </div>

      <p
        v-if="taxonomyCatalogState === 'loading'"
        class="text-xs text-muted-foreground m-0"
        role="status"
      >
        正在加载历史分类…
      </p>
      <FaAlert
        v-else-if="taxonomyCatalogState === 'error'"
        title="历史分类加载失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            已有分类与产品头选项需重试后加载；没有分类权限时只能选择已有值。
          </p>
          <FaButton
            type="button"
            variant="outline"
            class="mt-3 min-h-11 sm:min-h-9"
            :disabled="submitLocked"
            @click="emit('retryTaxonomyCatalog')"
          >
            重试分类
          </FaButton>
        </template>
      </FaAlert>
      <p
        v-else-if="taxonomyCatalogState === 'empty'"
        class="text-xs text-muted-foreground m-0"
      >
        暂无分类目录；有新建权限时可直接创建。
      </p>

      <FaFormItem name="name" label="产品名称" required>
        <FaInput
          :model-value="modelValue.name"
          autocomplete="off"
          class="w-full"
          :disabled="submitLocked"
          maxlength="128"
          placeholder="请输入产品名称"
          @update:model-value="updateModel({ name: typeof $event === 'string' ? $event : '' })"
        />
      </FaFormItem>

      <FaFormItem
        name="remark"
        label="产品备注"
        description="可选；最多 512 个字符，用于记录型号说明、适配要求或随附配件。"
      >
        <FaTextarea
          :model-value="modelValue.remark"
          :disabled="submitLocked"
          maxlength="512"
          :rows="3"
          placeholder="填写产品备注（可选）"
          @update:model-value="updateModel({ remark: typeof $event === 'string' ? $event : '' })"
        />
      </FaFormItem>
    </FaCard>

    <FaCard
      title="销售与采购价格"
      description="金额使用十进制字符串校验，切换采购币种不会自动换算金额。"
      class="min-w-0 lg:col-span-8"
      content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
    >
      <p
        v-if="currencyCatalogState === 'loading'"
        class="text-sm text-muted-foreground m-0 md:col-span-2"
        role="status"
      >
        正在加载货币资料…
      </p>
      <FaAlert
        v-else-if="currencyCatalogState === 'error'"
        class="md:col-span-2"
        title="货币资料加载失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            三组价格的币种无法验证，请重试后提交。
          </p>
          <FaButton
            type="button"
            variant="outline"
            class="mt-3 min-h-11 sm:min-h-9"
            :disabled="submitLocked"
            @click="emit('retryCurrencyCatalog')"
          >
            重试货币资料
          </FaButton>
        </template>
      </FaAlert>
      <FaAlert
        v-else-if="currencyCatalogState === 'empty'"
        class="md:col-span-2"
        title="暂无可用货币"
        description="请先在基础资料中启用所需货币。"
        variant="destructive"
        role="alert"
      />
      <FaAlert
        v-else-if="fixedCurrencyUnavailable"
        class="md:col-span-2"
        title="必要货币不可用"
        description="保存产品需要当前有效的 TWD、MYR 以及至少一种采购币种。"
        variant="destructive"
        role="alert"
      />

      <FaFormItem
        name="twdSalePriceAmount"
        label="台币销售价"
        description="可留空；币种固定为 TWD。"
      >
        <MoneyInput
          v-model:currency="twdCurrency"
          :model-value="modelValue.twdSalePriceAmount"
          :currencies="twdCurrencies"
          :disabled="submitLocked"
          min="0"
          @update:model-value="updateModel({ twdSalePriceAmount: $event })"
          @validation="handleMoneyValidation('twdSalePrice.amount', $event)"
        />
      </FaFormItem>

      <FaFormItem
        name="myrSalePriceAmount"
        label="马币销售价"
        description="可留空；币种固定为 MYR。"
      >
        <MoneyInput
          v-model:currency="myrCurrency"
          :model-value="modelValue.myrSalePriceAmount"
          :currencies="myrCurrencies"
          :disabled="submitLocked"
          min="0"
          @update:model-value="updateModel({ myrSalePriceAmount: $event })"
          @validation="handleMoneyValidation('myrSalePrice.amount', $event)"
        />
      </FaFormItem>

      <FaFormItem
        name="purchaseCostAmount"
        label="采购成本价"
        description="可留空；默认 CNY，可选择其他当前有效币种。"
        class="md:col-span-2"
      >
        <MoneyInput
          :model-value="modelValue.purchaseCostAmount"
          :currency="modelValue.purchaseCostCurrency"
          :currencies="purchaseCurrencies"
          :disabled="submitLocked"
          min="0"
          @update:model-value="updateModel({ purchaseCostAmount: $event })"
          @update:currency="updateModel({ purchaseCostCurrency: $event ?? modelValue.purchaseCostCurrency })"
          @validation="handleMoneyValidation('purchaseCost.amount', $event)"
        />
      </FaFormItem>
    </FaCard>

    <FaCard class="min-w-0 lg:col-span-8" content-class="min-w-0">
      <ProductAttributesEditor
        ref="attributesRef"
        :model-value="modelValue.attributes"
        :disabled="submitLocked"
        :field-errors="visibleFieldErrors"
        @update:model-value="updateModel({ attributes: $event })"
      />
    </FaCard>

    <FaCard
      v-if="!isEdit"
      title="媒体资料"
      class="min-w-0 lg:col-span-8"
    >
      <FaAlert
        title="创建后维护媒体"
        description="创建产品后可在编辑页上传和维护图片与视频；本次创建不会携带媒体文件。"
        icon="i-lucide:image-off"
      />
    </FaCard>

    <aside class="min-w-0 lg:col-span-4 lg:row-span-4 lg:col-start-9 lg:row-start-1 lg:self-start">
      <div class="space-y-4 lg:top-4 lg:sticky">
        <FaCard title="保存摘要" description="保存前核对产品身份与归属。">
          <dl class="m-0 gap-3 grid">
            <div>
              <dt class="qs-type-compact-label">
                产品编号
              </dt>
              <dd class="font-mono m-0 mt-1 break-all">
                {{ isEdit ? productNo : 'PRODUCT · AUTO' }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                状态
              </dt>
              <dd class="m-0 mt-1">
                <FaTag variant="outline" class="qs-type-status-tag" :class="statusClass">
                  {{ statusLabel }}
                </FaTag>
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                分类
              </dt>
              <dd class="m-0 mt-1 break-words">
                {{ modelValue.categoryName ?? '未选择' }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                产品头
              </dt>
              <dd class="m-0 mt-1 break-words">
                {{ modelValue.productHeadName ?? '未选择' }}
              </dd>
            </div>
          </dl>
        </FaCard>

        <div
          v-if="showActions"
          class="p-4 border border-border rounded-xl bg-card gap-3 hidden lg:grid"
        >
          <FaButton
            type="submit"
            class="min-h-11 w-full sm:min-h-9"
            :disabled="submitLocked"
            :loading="submitting"
          >
            {{ isEdit ? '保存修改' : '创建产品' }}
          </FaButton>
          <FaButton
            type="button"
            variant="outline"
            class="min-h-11 w-full sm:min-h-9"
            :disabled="submitLocked"
            @click="cancel"
          >
            取消
          </FaButton>
        </div>

        <p class="text-xs text-muted-foreground m-0 px-1">
          产品编号由系统自动派发，审计留痕由系统处理。
        </p>
      </div>
    </aside>

    <FaFixedBar
      v-if="showActions"
      position="bottom"
      class="pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border bg-card lg:hidden"
    >
      <div class="px-4 py-3 flex gap-3 w-full">
        <FaButton
          type="button"
          variant="outline"
          class="flex-1 min-h-11"
          :disabled="submitLocked"
          @click="cancel"
        >
          取消
        </FaButton>
        <FaButton
          type="submit"
          class="flex-1 min-h-11"
          :disabled="submitLocked"
          :loading="submitting"
        >
          {{ isEdit ? '保存修改' : '创建产品' }}
        </FaButton>
      </div>
    </FaFixedBar>
  </FaForm>
</template>
