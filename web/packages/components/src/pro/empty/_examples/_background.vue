<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaEmpty from '../index.vue'
</script>

<template>
  <FaEmpty icon="i-lucide:bell" title="无通知" description="您已收到所有通知。新通知将出现在这里" class="h-full from-muted/50 to-transparent from-30% bg-gradient-to-b">
    <FaButton variant="outline" size="sm">
      <FaIcon name="i-lucide:refresh-ccw" />
      刷新
    </FaButton>
  </FaEmpty>
</template>
