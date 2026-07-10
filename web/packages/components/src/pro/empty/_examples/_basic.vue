<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaEmpty from '../index.vue'
</script>

<template>
  <FaEmpty icon="i-lucide:folder-open" title="没有项目" description="您尚未创建任何项目，请从创建第一个项目开始">
    <div class="flex gap-2">
      <FaButton>
        创建项目
      </FaButton>
      <FaButton variant="outline">
        导入项目
      </FaButton>
    </div>
    <FaButton variant="link" class="text-muted-foreground" size="sm">
      了解更多 <FaIcon name="i-lucide:arrow-up-right" />
    </FaButton>
  </FaEmpty>
</template>
