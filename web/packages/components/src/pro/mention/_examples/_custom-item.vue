<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaMention from '../index.vue'

const content = ref('')
const mentions = ref<string[]>([])

const reviewers = [
  { value: 'lucas', label: 'Lucas He' },
  { value: 'nora', label: 'Nora Lin' },
  { value: 'stella', label: 'Stella Yang' },
  { value: 'harper', label: 'Harper Qiu' },
]

const directory: Record<string, { email: string, role: string }> = {
  lucas: {
    email: 'lucas.he@fantastic.dev',
    role: 'Frontend',
  },
  nora: {
    email: 'nora.lin@fantastic.dev',
    role: 'Design',
  },
  stella: {
    email: 'stella.yang@fantastic.dev',
    role: 'QA',
  },
  harper: {
    email: 'harper.qiu@fantastic.dev',
    role: 'PM',
  },
}

function getInitials(label: string) {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}
</script>

<template>
  <div class="space-y-4">
    <FaMention
      v-model="content"
      v-model:value="mentions"
      label="Code Review"
      placeholder="在评论里 @ reviewer"
      :items="reviewers"
    >
      <template #item="{ item, selected, highlighted }">
        <div class="flex gap-3 w-full items-center">
          <div
            class="text-[11px] font-semibold border rounded-full flex-center size-8 transition-colors"
            :class="highlighted ? 'border-primary/40 bg-primary/12 text-primary' : 'border-border bg-background text-foreground'"
          >
            {{ getInitials(item.label ?? item.value) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {{ item.label ?? item.value }}
            </div>
            <div class="text-xs text-muted-foreground truncate">
              {{ directory[item.value]?.role }} · {{ directory[item.value]?.email }}
            </div>
          </div>
          <span
            v-if="selected"
            class="text-xs text-secondary-foreground px-2 py-0.5 rounded-full bg-secondary inline-flex items-center"
          >
            已选
          </span>
        </div>
      </template>
    </FaMention>
    <div class="text-sm text-muted-foreground p-4 border rounded-lg bg-card">
      自定义 `#item` 插槽后，可以保留基础键盘导航和插入逻辑，只重绘候选项外观。
    </div>
  </div>
</template>
