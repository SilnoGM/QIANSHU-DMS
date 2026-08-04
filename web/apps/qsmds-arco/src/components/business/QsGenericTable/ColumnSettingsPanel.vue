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
      <FaButton variant="ghost" size="sm" class="min-h-11 md:min-h-8" @click="emit('reset')">
        恢复默认
      </FaButton>
    </div>

    <div class="max-h-[22rem] overflow-y-auto">
      <div class="text-[11px] text-muted-foreground px-1 py-2 border-b border-border bg-popover gap-2 hidden items-center top-0 sticky z-1 md:grid md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <span>显示列</span>
        <span class="text-center w-[5.5rem]">固定</span>
        <span class="text-center w-[5.5rem]">对齐</span>
      </div>

      <div class="px-1 py-2 border-b border-border/70 gap-3 grid grid-cols-2 items-center md:gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div class="flex gap-2 col-span-2 min-h-11 min-w-0 items-center md:col-span-1 md:min-h-0">
          <FaCheckbox :model-value="true" disabled />
          <span class="text-sm font-medium truncate"># 行号</span>
          <FaIcon name="i-lucide:lock-keyhole" class="text-muted-foreground shrink-0 size-3.5" />
        </div>

        <div class="min-w-0 md:w-[5.5rem]">
          <span class="text-[11px] text-muted-foreground mb-1 block md:hidden">固定</span>
          <div class="flex-center w-full" aria-label="行号固定位置">
            <FaTooltip text="固定在左侧（锁定）" :delay="300">
              <span class="text-muted-foreground border border-border rounded-md bg-muted/30 flex-center h-11 w-full md:size-7">
                <FaIcon name="i-lucide:panel-left" class="size-3.5" />
              </span>
            </FaTooltip>
          </div>
        </div>
        <div class="min-w-0 md:w-[5.5rem]">
          <span class="text-[11px] text-muted-foreground mb-1 block md:hidden">对齐</span>
          <div class="flex-center w-full" aria-label="行号对齐方式">
            <FaTooltip text="左对齐（锁定）" :delay="300">
              <span class="text-muted-foreground border border-border rounded-md bg-muted/30 flex-center h-11 w-full md:size-7">
                <FaIcon name="i-lucide:align-left" class="size-3.5" />
              </span>
            </FaTooltip>
          </div>
        </div>
      </div>

      <div
        v-for="item in items"
        :key="item.id"
        class="px-1 py-2 border-b border-border/70 gap-3 grid grid-cols-2 items-center last-border-b-0 md:gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]"
      >
        <FaCheckbox
          :model-value="item.visible"
          class="col-span-2 min-w-0 md:col-span-1"
          item-class="size-5 md:size-4"
          label-class="min-h-11 min-w-0 flex flex-1 items-center md:min-h-0"
          @update:model-value="value => updateVisible(item.id, value)"
        >
          <span class="text-sm truncate" :title="item.title">{{ item.title }}</span>
        </FaCheckbox>

        <div class="min-w-0 md:w-[5.5rem]">
          <span class="text-[11px] text-muted-foreground mb-1 block md:hidden">固定</span>
          <div class="p-0.5 border border-border rounded-md bg-muted/30 flex min-w-0 w-full items-center" :aria-label="`${item.title}固定位置`">
            <FaTooltip text="固定在左侧" :delay="300" :disabled="!item.visible">
              <FaButton
                variant="ghost"
                size="sm"
                class="p-0 flex-1 h-11 min-w-11 md:flex-none md:size-7 md:min-w-0"
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
                class="p-0 flex-1 h-11 min-w-11 md:flex-none md:size-7 md:min-w-0"
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
                class="p-0 flex-1 h-11 min-w-11 md:flex-none md:size-7 md:min-w-0"
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
        </div>

        <div class="min-w-0 md:w-[5.5rem]">
          <span class="text-[11px] text-muted-foreground mb-1 block md:hidden">对齐</span>
          <div class="p-0.5 border border-border rounded-md bg-muted/30 flex min-w-0 w-full items-center" :aria-label="`${item.title}对齐方式`">
            <FaTooltip text="左对齐" :delay="300" :disabled="!item.visible">
              <FaButton
                variant="ghost"
                size="sm"
                class="p-0 flex-1 h-11 min-w-11 md:flex-none md:size-7 md:min-w-0"
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
                class="p-0 flex-1 h-11 min-w-11 md:flex-none md:size-7 md:min-w-0"
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
                class="p-0 flex-1 h-11 min-w-11 md:flex-none md:size-7 md:min-w-0"
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
  </div>
</template>
