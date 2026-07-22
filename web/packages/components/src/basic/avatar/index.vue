<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { takeGraphemes } from '#utils'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

defineOptions({
  name: 'BuiltInAvatar',
})

const props = defineProps<{
  src: string
  fallback?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Avatar :class="props.class">
    <AvatarImage :src="src" />
    <AvatarFallback class="inline-flex">
      <slot>
        {{ takeGraphemes(fallback ?? '', 2) }}
      </slot>
    </AvatarFallback>
  </Avatar>
</template>
