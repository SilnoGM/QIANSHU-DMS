<script setup lang="ts">
import type { AcceptableValue, ComboboxContentProps } from 'reka-ui'
import type { HTMLAttributes, InputHTMLAttributes } from 'vue'
import { useTextDirection } from '@vueuse/core'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { cn } from '#utils'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxTrigger,
  ComboboxVirtualizer,
} from './combobox'

export interface ComboboxOption {
  label: string
  value: AcceptableValue
  disabled?: boolean
}

export interface ComboboxGroupOption {
  label: string
  options: ComboboxOption[]
}

type ComboboxInputAttrs = Pick<
  InputHTMLAttributes,
  | 'id'
  | 'tabindex'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-invalid'
  | 'aria-required'
  | 'aria-errormessage'
  | 'aria-busy'
>

export interface ComboboxProps {
  disabled?: boolean
  clearable?: boolean
  clearAriaLabel?: string
  position?: ComboboxContentProps['position']
  options: (ComboboxOption | ComboboxGroupOption)[]
  placeholder?: string
  emptyText?: string
  filter?: (searchValue: string, option: ComboboxOption) => boolean
  inputAttrs?: ComboboxInputAttrs
  triggerAriaLabel?: string
  virtualList?: boolean
  class?: HTMLAttributes['class']
}

defineOptions({
  name: 'BuiltInCombobox',
})

const props = withDefaults(defineProps<ComboboxProps>(), {
  disabled: false,
  clearable: false,
  clearAriaLabel: '清空选择',
  position: 'popper',
  triggerAriaLabel: '展开或收起选项',
  virtualList: false,
})

const emits = defineEmits<{
  blur: [event: FocusEvent]
  change: [value: AcceptableValue | undefined]
  clear: []
  focus: [event: FocusEvent]
}>()

const value = defineModel<AcceptableValue | undefined>()
const searchValue = ref('')
const isFocused = ref(false)
const isHovered = ref(false)
const comboboxInputRef = useTemplateRef('comboboxInputRef')

/*
 * inputAttrs 同时保留类型白名单和运行时白名单。后者防止 JavaScript 调用方
 * 绕过类型后把业务 name、搜索 value、事件或 Reka 自己维护的组合框 ARIA
 * 覆盖到真实 input，确保搜索文本永远不被误当成业务字段提交。
 */
const safeInputAttrs = computed<ComboboxInputAttrs>(() => ({
  'id': props.inputAttrs?.id,
  'tabindex': props.inputAttrs?.tabindex,
  'aria-label': props.inputAttrs?.['aria-label'],
  'aria-labelledby': props.inputAttrs?.['aria-labelledby'],
  'aria-describedby': props.inputAttrs?.['aria-describedby'],
  'aria-invalid': props.inputAttrs?.['aria-invalid'],
  'aria-required': props.inputAttrs?.['aria-required'],
  'aria-errormessage': props.inputAttrs?.['aria-errormessage'],
  'aria-busy': props.inputAttrs?.['aria-busy'],
}))

/*
 * primitive value 由“类型 + 值”区分；对象 value 则只能使用组件实例内的
 * identity。WeakMap 不延长对象生命周期，也避免不同对象都退化成同一个
 * `[object Object]` key。
 */
const objectValueKeys = new WeakMap<object, number>()
let nextObjectValueKey = 0

function getOptionValueKey(optionValue: AcceptableValue): string {
  if (typeof optionValue === 'object' && optionValue !== null) {
    const existingKey = objectValueKeys.get(optionValue)
    if (existingKey !== undefined) {
      return `object:${existingKey}`
    }
    const objectKey = ++nextObjectValueKey
    objectValueKeys.set(optionValue, objectKey)
    return `object:${objectKey}`
  }
  return `${typeof optionValue}:${String(optionValue)}`
}

const dir = useTextDirection({
  observe: true,
})

watch(value, (newValue) => {
  emits('change', newValue)
})

function isGroup(option: ComboboxOption | ComboboxGroupOption): option is ComboboxGroupOption {
  return Object.hasOwn(option, 'options')
}

function flattenOptions(): ComboboxOption[] {
  return props.options.flatMap((option) => {
    if (isGroup(option)) {
      return option.options
    }
    return [option]
  })
}

const flatOptions = computed<ComboboxOption[]>(() => flattenOptions())

const virtualSearchValue = computed(() => {
  const currentLabel = findLabelByValue(value.value)
  return searchValue.value === currentLabel ? '' : searchValue.value
})

const searchKeyword = computed(() => virtualSearchValue.value.trim())

function matchOption(keyword: string, option: ComboboxOption) {
  if (props.filter) {
    return props.filter(keyword, option)
  }

  return option.label.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
}

const filteredFlatOptions = computed(() => {
  const keyword = searchKeyword.value
  if (!keyword) {
    return flatOptions.value
  }

  return flatOptions.value
    .filter(option => matchOption(keyword, option))
})

const filteredVirtualValues = computed<AcceptableValue[]>(() => filteredFlatOptions.value.map(option => option.value))

const filteredOptions = computed<(ComboboxOption | ComboboxGroupOption)[]>(() => {
  const keyword = searchKeyword.value
  if (!keyword) {
    return props.options
  }

  return props.options.reduce<(ComboboxOption | ComboboxGroupOption)[]>((result, option) => {
    if (isGroup(option)) {
      const options = option.options.filter(item => matchOption(keyword, item))
      if (options.length > 0) {
        result.push({
          label: option.label,
          options,
        })
      }
      return result
    }

    if (matchOption(keyword, option)) {
      result.push(option)
    }

    return result
  }, [])
})

const virtualizerKey = computed(() => `${virtualSearchValue.value}:${filteredVirtualValues.value.length}`)
const hasClearValue = computed(() => value.value !== undefined || !!searchValue.value)
const showClear = computed(() => props.clearable && !props.disabled && hasClearValue.value && (isFocused.value || isHovered.value))

function findOptionByValue(val: AcceptableValue | undefined) {
  return flatOptions.value.find(option => option.value === val)
}

function findLabelByValue(val: AcceptableValue | undefined) {
  if (val == null) {
    return ''
  }

  return findOptionByValue(val)?.label ?? String(val)
}

function displayValue(val: AcceptableValue | undefined) {
  return findLabelByValue(val)
}

function handleInputFocus(event: FocusEvent) {
  isFocused.value = true
  emits('focus', event)
}

function handleInputBlur(event: FocusEvent) {
  isFocused.value = false
  emits('blur', event)
}

/** 只操作 ComboboxInput 已公开的真实 input ref，不跨组件查询 DOM。 */
function focus() {
  comboboxInputRef.value?.ref?.focus()
}

/** 与 focus() 对称，供表单和上层领域组件显式释放真实 input 焦点。 */
function blur() {
  comboboxInputRef.value?.ref?.blur()
}

function handleClear() {
  value.value = undefined
  searchValue.value = ''
  emits('clear')
}

defineExpose({
  blur,
  focus,
})
</script>

<template>
  <Combobox
    v-model="value"
    :disabled="disabled"
    :dir="dir === 'ltr' ? 'ltr' : 'rtl'"
    :ignore-filter="true"
    :open-on-focus="true"
    :open-on-click="true"
    :reset-search-term-on-select="true"
    class="inline-block"
  >
    <ComboboxAnchor as-child>
      <div
        :class="cn('relative flex h-9 px-3 py-2 w-[200px] items-center justify-between gap-2 rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] focus-within:outline-none has-disabled:pointer-events-none has-disabled:opacity-50 dark:bg-input/30', props.class)"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <ComboboxInput
          ref="comboboxInputRef"
          v-model="searchValue"
          v-bind="safeInputAttrs"
          :display-value="displayValue"
          :placeholder="props.placeholder"
          class="p-0 border-0 bg-transparent flex-1 h-full shadow-none focus-visible:border-transparent focus-visible:ring-0"
          @focus="handleInputFocus"
          @blur="handleInputBlur"
        />
        <Button
          v-if="showClear"
          :aria-label="clearAriaLabel"
          data-slot="combobox-clear"
          variant="ghost"
          size="icon"
          type="button"
          class="shrink-0 size-6 -mx-1"
          @click="handleClear"
        >
          <Icon name="i-lucide:x" />
        </Button>
        <ComboboxTrigger
          v-else
          :aria-label="triggerAriaLabel"
          as="button"
          type="button"
        />
      </div>
    </ComboboxAnchor>

    <ComboboxContent :position="position" class="z-2000">
      <template v-if="virtualList">
        <ComboboxVirtualizer
          v-if="filteredVirtualValues.length > 0"
          :key="virtualizerKey"
          v-slot="{ option }"
          :options="filteredVirtualValues"
          :text-content="option => findLabelByValue(option)"
        >
          <ComboboxItem
            :value="option"
            :disabled="findOptionByValue(option)?.disabled"
            :text-value="findLabelByValue(option)"
          >
            {{ findLabelByValue(option) }}
          </ComboboxItem>
        </ComboboxVirtualizer>
        <div v-else class="text-sm text-muted-foreground px-2 py-6 text-center">
          <slot name="empty">
            {{ emptyText }}
          </slot>
        </div>
      </template>
      <template v-else>
        <template v-if="filteredOptions.length > 0">
          <template
            v-for="option in filteredOptions"
            :key="isGroup(option) ? `group:${option.label}` : getOptionValueKey(option.value)"
          >
            <ComboboxGroup v-if="isGroup(option)">
              <ComboboxLabel>{{ option.label }}</ComboboxLabel>
              <ComboboxItem
                v-for="item in option.options"
                :key="getOptionValueKey(item.value)"
                :value="item.value"
                :disabled="item.disabled"
                :text-value="item.label"
              >
                {{ item.label }}
              </ComboboxItem>
            </ComboboxGroup>
            <ComboboxItem
              v-else
              :value="option.value"
              :disabled="option.disabled"
              :text-value="option.label"
            >
              {{ option.label }}
            </ComboboxItem>
          </template>
        </template>
        <div v-else class="text-sm text-muted-foreground px-2 py-6 text-center">
          <slot name="empty">
            {{ emptyText }}
          </slot>
        </div>
      </template>
    </ComboboxContent>
  </Combobox>
</template>
