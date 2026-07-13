<script setup lang="ts">
import type { AcceptableValue, ComboboxContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { useTextDirection } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
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

export interface ComboboxProps {
  disabled?: boolean
  clearable?: boolean
  position?: ComboboxContentProps['position']
  options: (ComboboxOption | ComboboxGroupOption)[]
  placeholder?: string
  emptyText?: string
  filter?: (searchValue: string, option: ComboboxOption) => boolean
  virtualList?: boolean
  class?: HTMLAttributes['class']
}

defineOptions({
  name: 'BuiltInCombobox',
})

const props = withDefaults(defineProps<ComboboxProps>(), {
  disabled: false,
  clearable: false,
  position: 'popper',
  virtualList: false,
})

const emits = defineEmits<{
  change: [value: AcceptableValue | undefined]
  clear: []
}>()

const value = defineModel<AcceptableValue | undefined>()
const searchValue = ref('')
const isFocused = ref(false)
const isHovered = ref(false)

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

function handleClear() {
  value.value = undefined
  searchValue.value = ''
  emits('clear')
}
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
          v-model="searchValue"
          :display-value="displayValue"
          :placeholder="props.placeholder"
          class="p-0 border-0 bg-transparent flex-1 h-full shadow-none focus-visible:border-transparent focus-visible:ring-0"
          @focus="isFocused = true"
          @blur="isFocused = false"
        />
        <Button
          v-if="showClear"
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
          <template v-for="option in filteredOptions" :key="option.label">
            <ComboboxGroup v-if="isGroup(option)">
              <ComboboxLabel>{{ option.label }}</ComboboxLabel>
              <ComboboxItem
                v-for="item in option.options"
                :key="String(item.value)"
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
