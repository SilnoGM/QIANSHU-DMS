<script setup lang="ts">
import type { QsPersonDisplaySize } from './types'
import {
  getPersonDisplayFallback,
  normalizePersonDisplayName,
} from './logic'

defineOptions({ name: 'QsPersonDisplay' })

const props = withDefaults(defineProps<{
  avatarUrl?: null | string
  displayName: string
  size?: QsPersonDisplaySize
}>(), {
  avatarUrl: null,
  size: 'md',
})

interface PersonDisplaySizeConfig {
  avatar: string
  gap: string
  name: string
}

const SIZE_CONFIG: Record<QsPersonDisplaySize, PersonDisplaySizeConfig> = {
  sm: { avatar: 'size-6 text-xs', gap: 'gap-2', name: 'text-xs' },
  md: { avatar: 'size-8 text-sm', gap: 'gap-2.5', name: 'text-sm' },
  lg: { avatar: 'size-10 text-base', gap: 'gap-3', name: 'text-base' },
}

const normalizedName = computed(() => normalizePersonDisplayName(props.displayName))
const fallback = computed(() => getPersonDisplayFallback(props.displayName))
const sizeConfig = computed(() => SIZE_CONFIG[props.size])
</script>

<template>
  <span
    data-slot="qs-person-display"
    class="inline-flex min-w-0 items-center"
    :class="sizeConfig.gap"
  >
    <FaAvatar
      :src="avatarUrl ?? ''"
      :fallback="fallback"
      class="text-muted-foreground font-medium rounded-full bg-muted"
      :class="sizeConfig.avatar"
    />
    <!-- 名称宽度由调用方容器决定；受限时单行截断，悬停仍可读取完整内容。 -->
    <FaTooltip :text="normalizedName">
      <span
        data-slot="qs-person-display-name"
        class="font-medium min-w-0 truncate"
        :class="sizeConfig.name"
      >
        {{ normalizedName }}
      </span>
    </FaTooltip>
  </span>
</template>
