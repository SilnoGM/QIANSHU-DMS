<script setup lang="ts">
import type { Direction } from 'reka-ui'
import type { HTMLAttributes, Ref } from 'vue'
import type { MentionItemRegistration, MentionRange } from './types'
import { useTextDirection, useVModel } from '@vueuse/core'
import { Primitive } from 'reka-ui'
import { computed, provide, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { mentionContextKey } from './context'
import { filterMentionItems, removeMentionRanges } from './mention-utils'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  value?: string[]
  defaultValue?: string[]
  open?: boolean
  defaultOpen?: boolean
  inputValue?: string
  trigger?: string
  dir?: Direction
  disabled?: boolean
  exactMatch?: boolean
  loop?: boolean
  modal?: boolean
  readonly?: boolean
  required?: boolean
  name?: string
  onFilter?: (options: string[], term: string) => string[]
}>(), {
  defaultOpen: false,
  trigger: '@',
  disabled: false,
  exactMatch: false,
  loop: false,
  modal: false,
  readonly: false,
  required: false,
})

const emit = defineEmits<{
  'update:value': [value: string[]]
  'update:open': [value: boolean]
  'update:inputValue': [value: string]
}>()

defineSlots<{
  default?: (props: {
    open: boolean
    inputValue: string
    value: string[]
    searchTerm: string
    visibleItems: MentionItemRegistration[]
    highlightedItem: MentionItemRegistration | null
  }) => any
}>()

const rootRef = useTemplateRef<HTMLElement>('rootRef')
const inputRef = shallowRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
const listRef = shallowRef<HTMLElement | null>(null)
const virtualAnchor = shallowRef<any>(null)
const searchTerm = shallowRef('')
const highlightedId = shallowRef<string | null>(null)
const registeredItems = shallowRef<MentionItemRegistration[]>([])
const mentions = shallowRef<MentionRange[]>([])
const isPasting = shallowRef(false)

const open = useVModel(props, 'open', emit, {
  passive: true,
  defaultValue: props.defaultOpen,
}) as Ref<boolean>

const value = useVModel(props, 'value', emit, {
  passive: true,
  defaultValue: props.defaultValue ? [...props.defaultValue] : [],
}) as Ref<string[]>

const inputValue = useVModel(props, 'inputValue', emit, {
  passive: true,
  defaultValue: '',
}) as Ref<string>

const documentDir = useTextDirection({
  observe: true,
})

const dir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))
const disabled = computed(() => props.disabled)
const readonly = computed(() => props.readonly)
const loop = computed(() => props.loop)
const modal = computed(() => props.modal)
const trigger = computed(() => props.trigger)

const inputId = useId()
const labelId = useId()
const listId = useId()

const visibleItemValues = computed(() => {
  return new Set(filterMentionItems(
    registeredItems.value,
    searchTerm.value,
    props.exactMatch,
    props.onFilter,
  ))
})

const visibleItems = computed(() => {
  return registeredItems.value.filter(item => visibleItemValues.value.has(item.value))
})

const visibleEnabledItems = computed(() => {
  return visibleItems.value.filter(item => !item.disabled)
})

const highlightedItem = computed(() => {
  return registeredItems.value.find(item => item.id === highlightedId.value) ?? null
})

function closeMenu() {
  open.value = false
  highlightedId.value = null
  virtualAnchor.value = null
  searchTerm.value = ''
}

function setOpen(nextOpen: boolean) {
  if (nextOpen && searchTerm.value && visibleItems.value.length === 0) {
    return
  }

  open.value = nextOpen

  if (nextOpen) {
    highlightedId.value = visibleEnabledItems.value[0]?.id ?? null
    return
  }

  highlightedId.value = null
  virtualAnchor.value = null
}

function setSearchTerm(nextSearchTerm: string) {
  searchTerm.value = nextSearchTerm
}

function setVirtualAnchor(anchor: any) {
  virtualAnchor.value = anchor
}

function setHighlightedId(id: string | null) {
  highlightedId.value = id
}

function moveHighlight(direction: 'next' | 'prev' | 'first' | 'last') {
  const items = visibleEnabledItems.value

  if (items.length === 0) {
    highlightedId.value = null
    return
  }

  const currentIndex = items.findIndex(item => item.id === highlightedId.value)

  if (direction === 'first') {
    highlightedId.value = items[0]?.id ?? null
    return
  }

  if (direction === 'last') {
    highlightedId.value = items.at(-1)?.id ?? null
    return
  }

  const fallbackIndex = direction === 'next' ? 0 : items.length - 1

  if (currentIndex === -1) {
    highlightedId.value = items[fallbackIndex]?.id ?? null
    return
  }

  const delta = direction === 'next' ? 1 : -1
  let nextIndex = currentIndex + delta

  if (loop.value) {
    nextIndex = (nextIndex + items.length) % items.length
  }
  else {
    nextIndex = Math.max(0, Math.min(items.length - 1, nextIndex))
  }

  highlightedId.value = items[nextIndex]?.id ?? null
}

function upsertItem(item: MentionItemRegistration) {
  const currentItems = registeredItems.value
  const index = currentItems.findIndex(current => current.id === item.id)

  if (index === -1) {
    registeredItems.value = [...currentItems, item]
    return
  }

  const currentItem = currentItems[index]

  if (
    currentItem
    && currentItem.ref === item.ref
    && currentItem.value === item.value
    && currentItem.label === item.label
    && currentItem.disabled === item.disabled
  ) {
    return
  }

  registeredItems.value = currentItems.map((current, currentIndex) => {
    return currentIndex === index ? item : current
  })
}

function removeItem(id: string) {
  registeredItems.value = registeredItems.value.filter(item => item.id !== id)
}

function isItemVisible(itemValue: string) {
  return visibleItemValues.value.has(itemValue)
}

function getEnabledItems() {
  return registeredItems.value.filter(item => !item.disabled)
}

function setMentions(
  updater: MentionRange[] | ((prev: MentionRange[]) => MentionRange[]),
) {
  mentions.value = typeof updater === 'function'
    ? updater(mentions.value)
    : updater
}

function removeMentions(ranges: MentionRange[]) {
  mentions.value = removeMentionRanges(mentions.value, ranges)
}

function addMention(payloadValue: string, triggerIndex: number) {
  const inputElement = inputRef.value

  if (!inputElement) {
    return
  }

  const mentionItem = getEnabledItems().find(item => item.value === payloadValue)

  if (!mentionItem) {
    return
  }

  const mentionLabel = mentionItem.label ?? payloadValue
  const mentionText = `${trigger.value}${mentionLabel}`
  const beforeTrigger = inputElement.value.slice(0, triggerIndex)
  const insertionPoint = inputElement.selectionStart ?? triggerIndex
  const afterSearchText = inputElement.value.slice(insertionPoint)
  const nextInputValue = `${beforeTrigger}${mentionText} ${afterSearchText}`
  const insertionLength = mentionText.length + 1
  const nextMention: MentionRange = {
    value: payloadValue,
    label: mentionLabel,
    start: triggerIndex,
    end: triggerIndex + mentionText.length,
  }

  mentions.value = [
    ...mentions.value.map((mention) => {
      if (mention.start >= insertionPoint) {
        return {
          ...mention,
          start: mention.start + insertionLength,
          end: mention.end + insertionLength,
        }
      }

      return mention
    }),
    nextMention,
  ]

  inputElement.value = nextInputValue
  inputValue.value = nextInputValue
  value.value = [...value.value, payloadValue]

  const nextCursorPosition = triggerIndex + mentionText.length + 1
  inputElement.setSelectionRange(nextCursorPosition, nextCursorPosition)
  inputElement.focus()
  closeMenu()
}

watch(
  () => open.value,
  (isOpen) => {
    if (!isOpen) {
      highlightedId.value = null
      virtualAnchor.value = null
      return
    }

    highlightedId.value = visibleEnabledItems.value[0]?.id ?? null
  },
)

watch(
  () => [searchTerm.value, visibleItems.value.length],
  ([term, itemCount]) => {
    if (open.value && term && itemCount === 0) {
      closeMenu()
    }
  },
)

watch(
  () => visibleEnabledItems.value.map(item => item.id).join(','),
  () => {
    if (!open.value) {
      return
    }

    if (!highlightedId.value || !visibleEnabledItems.value.some(item => item.id === highlightedId.value)) {
      highlightedId.value = visibleEnabledItems.value[0]?.id ?? null
    }
  },
)

provide(mentionContextKey, {
  open,
  value,
  inputValue,
  searchTerm,
  trigger,
  highlightedId,
  highlightedItem,
  mentions,
  visibleItems,
  visibleEnabledItems,
  dir,
  disabled,
  readonly,
  loop,
  modal,
  inputId,
  labelId,
  listId,
  rootRef,
  inputRef,
  listRef,
  virtualAnchor,
  isPasting,
  closeMenu,
  setOpen,
  setSearchTerm,
  setVirtualAnchor,
  setHighlightedId,
  moveHighlight,
  upsertItem,
  removeItem,
  isItemVisible,
  getEnabledItems,
  addMention,
  setMentions,
  removeMentions,
})
</script>

<template>
  <Primitive
    ref="rootRef"
    data-slot="mention-root"
    as="div"
    :class="props.class"
  >
    <slot
      :open="open"
      :input-value="inputValue"
      :value="value"
      :search-term="searchTerm"
      :visible-items="visibleItems"
      :highlighted-item="highlightedItem"
    />
    <input
      v-for="(itemValue, index) in value"
      :key="`${itemValue}-${index}`"
      type="hidden"
      :name="props.name"
      :value="itemValue"
      :disabled="disabled"
      :readonly="readonly"
      :required="props.required && index === 0"
    >
  </Primitive>
</template>
