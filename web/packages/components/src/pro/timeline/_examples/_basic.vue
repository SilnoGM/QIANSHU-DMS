<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaCard from '../../../basic/card/index.vue'
import FaTimeline from '../index.vue'

const data = [
  { datetime: '2025/03/23', content: '请假申请', name: '张三' },
  { datetime: '2025/03/23', content: '部门主管审批', name: '李四' },
  { datetime: '2025/03/24', content: '人事审批', name: '王五' },
  { datetime: '2025/03/24', content: '完成' },
]
</script>

<template>
  <FaTimeline :data="data">
    <template #default="{ item }">
      <FaCard class="h-full">
        <template #header>
          <div>{{ item.content }}</div>
        </template>
        <template #footer>
          <div v-if="item.name" class="flex-center-end flex-1">
            <div>操作人：{{ item.name }}</div>
          </div>
        </template>
      </FaCard>
    </template>
  </FaTimeline>
</template>
