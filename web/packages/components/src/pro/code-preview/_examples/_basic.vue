<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaCodePreview from '../index.vue'

const code = `<template>
  <FaButton>
    保存设置
  </FaButton>
</template>`
</script>

<template>
  <FaCodePreview title="按钮示例" :code="code">
    <FaButton>
      保存设置
    </FaButton>
  </FaCodePreview>
</template>
