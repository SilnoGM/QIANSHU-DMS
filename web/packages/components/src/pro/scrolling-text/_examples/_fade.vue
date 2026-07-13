<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaScrollingText from '../index.vue'
</script>

<template>
  <FaScrollingText
    :items="[
      '公告：系统将于今晚 22:00 进行维护升级',
      '新功能：支持批量导出数据，欢迎体验',
      '提示：请及时更新您的账户安全信息',
    ]"
    :visible-count="2"
    animation="fade"
    :transition="300"
    class="text-sm px-3 border rounded-lg h-16"
    item-class="border-b border-dashed last:border-0"
  />
</template>
