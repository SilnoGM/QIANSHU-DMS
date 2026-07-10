<script setup lang="ts">
import { computed, ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaMention from '../index.vue'

const message = ref('')
const mentions = ref<string[]>([])

const people = [
  { value: 'linyue', label: '林岳' },
  { value: 'olivia', label: 'Olivia Chen' },
  { value: 'jayden', label: 'Jayden Wu' },
  { value: 'cici', label: 'Cici Xu' },
  { value: 'mika', label: 'Mika Tan', disabled: true },
]

const selectedPeople = computed(() => {
  return people.filter(item => mentions.value.includes(item.value))
})
</script>

<template>
  <div class="space-y-4">
    <FaMention
      v-model="message"
      v-model:value="mentions"
      label="项目讨论"
      placeholder="输入 @ 选择协作者，例如 @lin"
      :items="people"
    />
    <div class="p-4 border rounded-lg border-dashed bg-muted/20 space-y-3">
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground tracking-wide uppercase">
          当前输入
        </div>
        <div class="text-sm min-h-6">
          {{ message || '暂无内容' }}
        </div>
      </div>
      <div class="space-y-2">
        <div class="text-xs text-muted-foreground tracking-wide uppercase">
          命中的提及值
        </div>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="item in selectedPeople"
            :key="item.value"
            class="text-xs text-secondary-foreground px-2 py-0.5 rounded-full bg-secondary inline-flex items-center"
          >
            {{ item.label }} · {{ item.value }}
          </span>
          <span
            v-if="selectedPeople.length === 0"
            class="text-sm text-muted-foreground"
          >
            还没有选择任何成员
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
