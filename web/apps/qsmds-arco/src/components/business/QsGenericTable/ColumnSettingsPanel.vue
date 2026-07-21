<script setup lang="ts">
import type { TableAlign, TableColumnFixed } from '@fantastic-admin/components'

import type { QsGenericTableColumnSettingItem } from './logic'

defineOptions({ name: 'QsGenericTableColumnSettingsPanel' })

defineProps<{
  items: readonly QsGenericTableColumnSettingItem[]
}>()

const emit = defineEmits<{
  reset: []
  update: [id: string, patch: { align?: TableAlign, fixed?: TableColumnFixed, visible?: boolean }]
}>()

function updateVisible(id: string, visible: boolean | 'indeterminate' | null | undefined) {
  emit('update', id, { visible: visible === true })
}
</script>

<template>
  <div class="w-[min(26rem,calc(100vw-2rem))]">
    <div class="pb-3 border-b border-border flex gap-3 items-start justify-between">
      <div>
        <h3 class="text-sm font-semibold m-0">
          列显示、固定与对齐
        </h3>
        <p class="text-xs text-muted-foreground leading-5 m-0 mt-1">
          调整立即生效，行号列始终左固定、左对齐。
        </p>
      </div>
      <FaButton variant="ghost" size="sm" @click="emit('reset')">
        恢复默认
      </FaButton>
    </div>

    <div class="py-2 max-h-[22rem] overflow-y-auto">
      <div class="py-2.5 gap-3 grid grid-cols-[minmax(0,1fr)_auto] items-center">
        <div class="flex gap-2 min-w-0 items-center">
          <FaCheckbox :model-value="true" disabled />
          <span class="text-sm font-medium truncate"># 行号</span>
          <FaIcon name="i-lucide:lock-keyhole" class="text-muted-foreground shrink-0 size-3.5" />
        </div>
        <span class="text-xs text-muted-foreground">左固定 · 左对齐</span>
      </div>

      <div
        v-for="item in items"
        :key="item.id"
        class="py-3 border-t border-border/70 gap-2 grid"
      >
        <div class="gap-3 grid grid-cols-[minmax(0,1fr)_auto] items-center">
          <label class="flex gap-2 min-w-0 cursor-pointer items-center">
            <FaCheckbox
              :model-value="item.visible"
              @update:model-value="value => updateVisible(item.id, value)"
            />
            <span class="text-sm truncate">{{ item.title }}</span>
          </label>

          <div class="flex gap-2 items-center">
            <span class="text-xs text-muted-foreground">固定</span>
            <div class="p-0.5 border border-border rounded-md bg-muted/30 flex items-center" :aria-label="`${item.title}固定位置`">
              <FaButton
                variant="ghost"
                size="sm"
                class="text-xs px-2 h-7"
                :class="item.fixed === 'left' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
                :disabled="!item.visible"
                :aria-pressed="item.fixed === 'left'"
                @click="emit('update', item.id, { fixed: 'left' })"
              >
                左
              </FaButton>
              <FaButton
                variant="ghost"
                size="sm"
                class="text-xs px-2 h-7"
                :class="!item.fixed ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
                :disabled="!item.visible"
                :aria-pressed="!item.fixed"
                @click="emit('update', item.id, { fixed: undefined })"
              >
                无
              </FaButton>
              <FaButton
                variant="ghost"
                size="sm"
                class="text-xs px-2 h-7"
                :class="item.fixed === 'right' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
                :disabled="!item.visible"
                :aria-pressed="item.fixed === 'right'"
                @click="emit('update', item.id, { fixed: 'right' })"
              >
                右
              </FaButton>
            </div>
          </div>
        </div>

        <div class="ps-7 flex gap-3 items-center justify-between">
          <span class="text-xs text-muted-foreground">对齐方式</span>
          <div class="p-0.5 border border-border rounded-md bg-muted/30 flex items-center" :aria-label="`${item.title}对齐方式`">
            <FaButton
              variant="ghost"
              size="sm"
              class="text-xs px-2.5 h-7"
              :class="item.align === 'left' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-pressed="item.align === 'left'"
              @click="emit('update', item.id, { align: 'left' })"
            >
              左
            </FaButton>
            <FaButton
              variant="ghost"
              size="sm"
              class="text-xs px-2.5 h-7"
              :class="item.align === 'center' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-pressed="item.align === 'center'"
              @click="emit('update', item.id, { align: 'center' })"
            >
              中
            </FaButton>
            <FaButton
              variant="ghost"
              size="sm"
              class="text-xs px-2.5 h-7"
              :class="item.align === 'right' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-pressed="item.align === 'right'"
              @click="emit('update', item.id, { align: 'right' })"
            >
              右
            </FaButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
