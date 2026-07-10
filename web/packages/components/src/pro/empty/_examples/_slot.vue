<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaAvatar from '../../../basic/avatar/index.vue'
import FaButton from '../../../basic/button/index.vue'
import FaEmpty from '../index.vue'
</script>

<template>
  <FaEmpty>
    <template #icon>
      <FaAvatar src="https://github.com/hooray.png" class="size-20 grayscale" />
    </template>
    <template #title>
      <div class="text-xl">
        用户离线
      </div>
    </template>
    <template #description>
      <div>该用户目前离线</div>
      <div>您可以留言通知他或稍后再试</div>
    </template>
    <FaButton>
      留言
    </FaButton>
  </FaEmpty>
</template>
