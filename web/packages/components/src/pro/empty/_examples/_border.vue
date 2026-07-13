<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaEmpty from '../index.vue'
</script>

<template>
  <FaEmpty icon="i-lucide:cloud" title="云盘为空" description="将文件上传到云盘，随时随地访问" class="border border-dashed">
    <FaButton variant="outline" size="sm">
      上传文件
    </FaButton>
  </FaEmpty>
</template>
