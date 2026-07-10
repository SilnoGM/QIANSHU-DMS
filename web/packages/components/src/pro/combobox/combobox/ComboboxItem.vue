<script setup lang="ts" generic="T extends AcceptableValue = AcceptableValue">
import type { AcceptableValue, ComboboxItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { Check } from '@lucide/vue'
import { ComboboxItem, ComboboxItemIndicator } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<ComboboxItemProps<T> & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <ComboboxItem
    data-slot="combobox-item"
    v-bind="props"
    :class="
      cn(
        'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:bg-accent/70 data-[state=checked]:text-accent-foreground [&_svg:not([class*=text-])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pe-8 ps-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        props.class,
      )
    "
  >
    <span class="flex size-3.5 items-center end-2 justify-center absolute">
      <ComboboxItemIndicator>
        <slot name="indicator-icon">
          <Check class="size-4" />
        </slot>
      </ComboboxItemIndicator>
    </span>

    <slot />
  </ComboboxItem>
</template>
