<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { MentionOption } from './mention'
import { cn } from '#utils'
import {
  MentionContent,
  MentionInput,
  MentionItem,
  MentionLabel,
  MentionPortal,
  MentionRoot,
} from './mention'

defineOptions({
  name: 'BuiltInMention',
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  items: MentionOption[]
  label?: string
  placeholder?: string
  rows?: number
  inputAs?: 'input' | 'textarea'
  class?: HTMLAttributes['class']
  labelClass?: HTMLAttributes['class']
  inputClass?: HTMLAttributes['class']
  contentClass?: HTMLAttributes['class']
  itemClass?: HTMLAttributes['class']
  trigger?: string
  disabled?: boolean
  readonly?: boolean
  required?: boolean
  name?: string
  exactMatch?: boolean
  loop?: boolean
  modal?: boolean
  defaultOpen?: boolean
}>(), {
  rows: 4,
  inputAs: 'textarea',
  trigger: '@',
  disabled: false,
  readonly: false,
  required: false,
  exactMatch: false,
  loop: false,
  modal: false,
  defaultOpen: false,
})

defineSlots<{
  label?: () => any
  item?: (props: {
    item: MentionOption
    selected: boolean
    highlighted: boolean
    disabled: boolean
  }) => any
}>()

const inputValue = defineModel<string>({
  default: '',
})

const mentionValues = defineModel<string[]>('value', {
  default: () => [],
})

const open = defineModel<boolean>('open', {
  default: false,
})
</script>

<template>
  <MentionRoot
    v-slot="{ highlightedItem }"
    v-bind="$attrs"
    v-model:input-value="inputValue"
    v-model:value="mentionValues"
    v-model:open="open"
    :trigger="props.trigger"
    :disabled="props.disabled"
    :readonly="props.readonly"
    :required="props.required"
    :name="props.name"
    :exact-match="props.exactMatch"
    :loop="props.loop"
    :modal="props.modal"
    :default-open="props.defaultOpen"
    :class="cn('grid gap-2', props.class)"
  >
    <MentionLabel
      v-if="$slots.label || props.label"
      :class="cn('text-foreground', props.labelClass)"
    >
      <slot name="label">
        {{ props.label }}
      </slot>
    </MentionLabel>
    <MentionInput
      :as="props.inputAs"
      :rows="props.rows"
      :placeholder="props.placeholder"
      :class="cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 min-h-24 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        props.inputAs === 'input' ? 'min-h-9 resize-none py-1.5' : '',
        props.inputClass,
      )"
    />
    <MentionPortal>
      <MentionContent
        :class="cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-2000 max-h-72 min-w-[12rem] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
          props.contentClass,
        )"
      >
        <MentionItem
          v-for="item in props.items"
          :key="item.value"
          :value="item.value"
          :label="item.label"
          :disabled="item.disabled"
          :class="cn(
            'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none transition-colors focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            props.itemClass,
          )"
        >
          <slot
            name="item"
            :item="item"
            :selected="mentionValues.includes(item.value)"
            :highlighted="highlightedItem?.value === item.value"
            :disabled="!!item.disabled"
          >
            <span class="truncate">{{ item.label ?? item.value }}</span>
          </slot>
        </MentionItem>
      </MentionContent>
    </MentionPortal>
  </MentionRoot>
</template>
