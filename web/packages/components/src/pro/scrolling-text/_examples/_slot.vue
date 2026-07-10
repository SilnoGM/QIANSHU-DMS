<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaScrollingText from '../index.vue'

const notices = [
  { tag: '紧急', text: '系统将于今晚 22:00 进行维护升级', type: 'error' },
  { tag: '新功能', text: '支持批量导出数据，欢迎体验', type: 'success' },
  { tag: '提示', text: '请及时更新您的账户安全信息', type: 'warning' },
]
</script>

<template>
  <FaScrollingText :items="notices.map(n => n.text)">
    <template #item="{ index }">
      <div class="py-1 flex gap-2 w-full items-center">
        <span
          class="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
          :class="{
            'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400': notices[index].type === 'error',
            'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400': notices[index].type === 'success',
            'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400': notices[index].type === 'warning',
          }"
        >
          {{ notices[index].tag }}
        </span>
        <span class="text-sm truncate">{{ notices[index].text }}</span>
      </div>
    </template>
  </FaScrollingText>
</template>
