<script setup lang="ts">
import type { ProductCreateAttributeRow, ProductCreateFieldErrors } from './product-create.logic'

import {
  appendProductAttribute,
  MAX_PRODUCT_ATTRIBUTES,
  moveProductAttribute,
  removeProductAttribute,
  updateProductAttribute,
} from './product-create.logic'

defineOptions({ name: 'ProductAttributesEditor' })

const props = withDefaults(defineProps<{
  disabled?: boolean
  fieldErrors?: ProductCreateFieldErrors
  modelValue: readonly ProductCreateAttributeRow[]
}>(), {
  disabled: false,
  fieldErrors: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [value: ProductCreateAttributeRow[]]
}>()

const rootRef = useTemplateRef<HTMLElement>('rootRef')
const idPrefix = `product-attributes-${useId().replaceAll(':', '')}`

function fieldPath(index: number, field: 'title' | 'value'): string {
  return `attributes.${index}.${field}`
}

function fieldError(index: number, field: 'title' | 'value'): string | undefined {
  return props.fieldErrors[fieldPath(index, field)]
}

function attributeInputId(index: number, field: 'title' | 'value'): string {
  return `${idPrefix}-${index}-${field}`
}

function attributeDescriptionId(index: number, field: 'title' | 'value'): string {
  return `${attributeInputId(index, field)}-feedback`
}

function addAttribute(): void {
  if (props.disabled) {
    return
  }
  const next = appendProductAttribute(props.modelValue)
  if (next !== props.modelValue) {
    emit('update:modelValue', [...next])
  }
}

function updateAttribute(
  index: number,
  field: 'title' | 'value',
  value: unknown,
): void {
  if (props.disabled) {
    return
  }
  const next = updateProductAttribute(
    props.modelValue,
    index,
    field,
    typeof value === 'string' ? value : '',
  )
  if (next !== props.modelValue) {
    emit('update:modelValue', [...next])
  }
}

function moveAttribute(index: number, direction: 'down' | 'up'): void {
  if (props.disabled) {
    return
  }
  const next = moveProductAttribute(props.modelValue, index, direction)
  if (next !== props.modelValue) {
    emit('update:modelValue', [...next])
  }
}

function removeAttribute(index: number): void {
  if (props.disabled) {
    return
  }
  const next = removeProductAttribute(props.modelValue, index)
  if (next !== props.modelValue) {
    emit('update:modelValue', [...next])
  }
}

/**
 * Server Attribute 路径只能由白名单 parser 产生。组件不把路径拼进
 * selector，而是遍历自己生成的 data 标记，避免 DOM selector 注入。
 */
function focusField(path: string): boolean {
  const container = [...(rootRef.value?.querySelectorAll<HTMLElement>(
    '[data-product-attribute-field]',
  ) ?? [])].find(element => element.dataset.productAttributeField === path)
  const input = container?.querySelector<HTMLInputElement>('input, textarea')
  if (container === undefined || input === null || input === undefined) {
    return false
  }
  const reduceMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  ).matches ?? false
  container.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'center',
  })
  input.focus({ preventScroll: true })
  return true
}

defineExpose({ focusField })
</script>

<template>
  <section ref="rootRef" aria-labelledby="product-attributes-title" class="min-w-0">
    <div class="flex flex-wrap gap-3 items-start justify-between">
      <div class="min-w-0">
        <h3 id="product-attributes-title" class="text-base font-semibold m-0">
          产品属性（{{ modelValue.length }}/{{ MAX_PRODUCT_ATTRIBUTES }}）
        </h3>
        <p class="text-sm text-muted-foreground leading-6 m-0 mt-1">
          属性按当前顺序保存；标题可重复，但标题与值都不能为空。
        </p>
      </div>
      <FaButton
        type="button"
        variant="outline"
        class="shrink-0 min-h-11 sm:min-h-9"
        :disabled="disabled || modelValue.length >= MAX_PRODUCT_ATTRIBUTES"
        aria-label="新增一项产品属性"
        @click="addAttribute"
      >
        <FaIcon name="i-lucide:plus" aria-hidden="true" />
        新增属性
      </FaButton>
    </div>

    <p
      v-if="modelValue.length === 0"
      class="text-sm text-muted-foreground m-0 mt-4 py-6 text-center border border-border rounded-lg bg-muted/20"
    >
      暂无产品属性，可按需添加。
    </p>

    <ol v-else class="m-0 mt-4 p-0 list-none space-y-4">
      <li
        v-for="(attribute, index) in modelValue"
        :key="attribute.key"
        class="p-4 border border-border rounded-lg bg-muted/20 min-w-0"
      >
        <div class="gap-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div
            class="min-w-0"
            :data-product-attribute-field="fieldPath(index, 'title')"
          >
            <label :for="attributeInputId(index, 'title')" class="text-sm font-medium">
              第 {{ index + 1 }} 项·属性标题
            </label>
            <FaInput
              :id="attributeInputId(index, 'title')"
              :model-value="attribute.title"
              :aria-describedby="attributeDescriptionId(index, 'title')"
              :aria-invalid="Boolean(fieldError(index, 'title'))"
              autocomplete="off"
              class="mt-2 w-full"
              :disabled="disabled"
              maxlength="64"
              placeholder="例如：颜色"
              @update:model-value="updateAttribute(index, 'title', $event)"
            />
            <p
              v-if="fieldError(index, 'title')"
              :id="attributeDescriptionId(index, 'title')"
              class="text-xs text-destructive m-0 mt-1"
              role="alert"
            >
              {{ fieldError(index, 'title') }}
            </p>
            <p
              v-else
              :id="attributeDescriptionId(index, 'title')"
              class="text-xs text-muted-foreground m-0 mt-1"
            >
              最多 64 个字符
            </p>
          </div>

          <div
            class="min-w-0"
            :data-product-attribute-field="fieldPath(index, 'value')"
          >
            <label :for="attributeInputId(index, 'value')" class="text-sm font-medium">
              第 {{ index + 1 }} 项·属性值
            </label>
            <FaInput
              :id="attributeInputId(index, 'value')"
              :model-value="attribute.value"
              :aria-describedby="attributeDescriptionId(index, 'value')"
              :aria-invalid="Boolean(fieldError(index, 'value'))"
              autocomplete="off"
              class="mt-2 w-full"
              :disabled="disabled"
              maxlength="512"
              placeholder="例如：墨黑"
              @update:model-value="updateAttribute(index, 'value', $event)"
            />
            <p
              v-if="fieldError(index, 'value')"
              :id="attributeDescriptionId(index, 'value')"
              class="text-xs text-destructive m-0 mt-1"
              role="alert"
            >
              {{ fieldError(index, 'value') }}
            </p>
            <p
              v-else
              :id="attributeDescriptionId(index, 'value')"
              class="text-xs text-muted-foreground m-0 mt-1"
            >
              最多 512 个字符
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2 justify-end">
          <FaButton
            type="button"
            variant="ghost"
            size="icon"
            class="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
            :aria-label="`上移第 ${index + 1} 项属性`"
            :disabled="disabled || index === 0"
            @click="moveAttribute(index, 'up')"
          >
            <FaIcon name="i-lucide:arrow-up" aria-hidden="true" />
          </FaButton>
          <FaButton
            type="button"
            variant="ghost"
            size="icon"
            class="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
            :aria-label="`下移第 ${index + 1} 项属性`"
            :disabled="disabled || index === modelValue.length - 1"
            @click="moveAttribute(index, 'down')"
          >
            <FaIcon name="i-lucide:arrow-down" aria-hidden="true" />
          </FaButton>
          <FaButton
            type="button"
            variant="ghost"
            size="icon"
            class="text-destructive min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
            :aria-label="`删除第 ${index + 1} 项属性`"
            :disabled="disabled"
            @click="removeAttribute(index)"
          >
            <FaIcon name="i-lucide:trash-2" aria-hidden="true" />
          </FaButton>
        </div>
      </li>
    </ol>
  </section>
</template>
