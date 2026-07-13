<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaMention from '../index.vue'

const subject = ref('')
const linkedIssues = ref<string[]>([])

const issues = [
  { value: 'FE-128', label: 'FE-128 登录页联调' },
  { value: 'FE-204', label: 'FE-204 权限菜单重构' },
  { value: 'OPS-32', label: 'OPS-32 发布流水线巡检' },
  { value: 'UX-19', label: 'UX-19 暗色主题验收' },
]
</script>

<template>
  <div class="space-y-4">
    <FaMention
      v-model="subject"
      v-model:value="linkedIssues"
      input-as="input"
      trigger="#"
      label="更新标题"
      placeholder="输入 # 关联任务，例如 #FE"
      :items="issues"
    />
    <div class="flex flex-wrap gap-2">
      <span
        v-for="issue in linkedIssues"
        :key="issue"
        class="text-xs text-foreground px-2 py-0.5 border rounded-full bg-background inline-flex items-center"
      >
        {{ issue }}
      </span>
      <span
        v-if="linkedIssues.length === 0"
        class="text-sm text-muted-foreground"
      >
        尚未关联任务
      </span>
    </div>
  </div>
</template>
