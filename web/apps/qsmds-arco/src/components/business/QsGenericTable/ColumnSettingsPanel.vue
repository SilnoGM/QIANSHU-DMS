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
  <div class="w-[min(28rem,calc(100vw-2rem))]">
    <div class="pb-3 border-b border-border flex gap-3 items-start justify-between">
      <div>
        <h3 class="text-sm font-semibold m-0">
          列显示、固定与对齐
        </h3>
        <p class="text-xs text-muted-foreground leading-5 m-0 mt-1">
          调整立即生效，行号列保持锁定。
        </p>
      </div>
      <FaButton variant="ghost" size="sm" @click="emit('reset')">
        恢复默认
      </FaButton>
    </div>

    <div class="max-h-[22rem] overflow-y-auto">
      <div class="text-[11px] text-muted-foreground px-1 py-2 border-b border-border bg-popover gap-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center top-0 sticky z-1">
        <span>显示列</span>
        <span class="text-center w-[5.5rem]">固定</span>
        <span class="text-center w-[5.5rem]">对齐</span>
      </div>

      <div class="px-1 py-2 border-b border-border/70 gap-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center">
        <div class="flex gap-2 min-w-0 items-center">
          <FaCheckbox :model-value="true" disabled />
          <span class="text-sm font-medium truncate"># 行号</span>
          <FaIcon name="i-lucide:lock-keyhole" class="text-muted-foreground shrink-0 size-3.5" />
        </div>

        <div class="flex-center w-[5.5rem]" aria-label="行号固定位置">
          <FaTooltip text="固定在左侧（锁定）" :delay="300">
            <span class="text-muted-foreground border border-border rounded-md bg-muted/30 flex-center size-7">
              <FaIcon name="i-lucide:panel-left" class="size-3.5" />
            </span>
          </FaTooltip>
        </div>
        <div class="flex-center w-[5.5rem]" aria-label="行号对齐方式">
          <FaTooltip text="左对齐（锁定）" :delay="300">
            <span class="text-muted-foreground border border-border rounded-md bg-muted/30 flex-center size-7">
              <FaIcon name="i-lucide:align-left" class="size-3.5" />
            </span>
          </FaTooltip>
        </div>
      </div>

      <div
        v-for="item in items"
        :key="item.id"
        class="px-1 py-2 border-b border-border/70 gap-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center last-border-b-0"
      >
        <label class="flex gap-2 min-w-0 cursor-pointer items-center">
          <FaCheckbox
            :model-value="item.visible"
            @update:model-value="value => updateVisible(item.id, value)"
          />
          <span class="text-sm truncate" :title="item.title">{{ item.title }}</span>
        </label>

        <div class="p-0.5 border border-border rounded-md bg-muted/30 flex w-[5.5rem] items-center" :aria-label="`${item.title}固定位置`">
          <FaTooltip text="固定在左侧" :delay="300" :disabled="!item.visible">
            <FaButton
              variant="ghost"
              size="sm"
              class="p-0 size-7"
              :class="item.fixed === 'left' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-label="`${item.title}：固定在左侧`"
              :aria-pressed="item.fixed === 'left'"
              @click="emit('update', item.id, { fixed: 'left' })"
            >
              <FaIcon name="i-lucide:panel-left" class="size-3.5" />
            </FaButton>
          </FaTooltip>
          <FaTooltip text="不固定" :delay="300" :disabled="!item.visible">
            <FaButton
              variant="ghost"
              size="sm"
              class="p-0 size-7"
              :class="!item.fixed ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-label="`${item.title}：不固定`"
              :aria-pressed="!item.fixed"
              @click="emit('update', item.id, { fixed: undefined })"
            >
              <FaIcon name="i-lucide:pin-off" class="size-3.5" />
            </FaButton>
          </FaTooltip>
          <FaTooltip text="固定在右侧" :delay="300" :disabled="!item.visible">
            <FaButton
              variant="ghost"
              size="sm"
              class="p-0 size-7"
              :class="item.fixed === 'right' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-label="`${item.title}：固定在右侧`"
              :aria-pressed="item.fixed === 'right'"
              @click="emit('update', item.id, { fixed: 'right' })"
            >
              <FaIcon name="i-lucide:panel-right" class="size-3.5" />
            </FaButton>
          </FaTooltip>
        </div>

        <div class="p-0.5 border border-border rounded-md bg-muted/30 flex w-[5.5rem] items-center" :aria-label="`${item.title}对齐方式`">
          <FaTooltip text="左对齐" :delay="300" :disabled="!item.visible">
            <FaButton
              variant="ghost"
              size="sm"
              class="p-0 size-7"
              :class="item.align === 'left' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-label="`${item.title}：左对齐`"
              :aria-pressed="item.align === 'left'"
              @click="emit('update', item.id, { align: 'left' })"
            >
              <FaIcon name="i-lucide:align-left" class="size-3.5" />
            </FaButton>
          </FaTooltip>
          <FaTooltip text="居中对齐" :delay="300" :disabled="!item.visible">
            <FaButton
              variant="ghost"
              size="sm"
              class="p-0 size-7"
              :class="item.align === 'center' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-label="`${item.title}：居中对齐`"
              :aria-pressed="item.align === 'center'"
              @click="emit('update', item.id, { align: 'center' })"
            >
              <FaIcon name="i-lucide:align-center" class="size-3.5" />
            </FaButton>
          </FaTooltip>
          <FaTooltip text="右对齐" :delay="300" :disabled="!item.visible">
            <FaButton
              variant="ghost"
              size="sm"
              class="p-0 size-7"
              :class="item.align === 'right' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'"
              :disabled="!item.visible"
              :aria-label="`${item.title}：右对齐`"
              :aria-pressed="item.align === 'right'"
              @click="emit('update', item.id, { align: 'right' })"
            >
              <FaIcon name="i-lucide:align-right" class="size-3.5" />
            </FaButton>
          </FaTooltip>
        </div>
      </div>
    </div>
  </div>
</template>
