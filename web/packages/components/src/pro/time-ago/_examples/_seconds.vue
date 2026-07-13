<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTimeAgo from '../index.vue'
</script>

<template>
  <p>显示秒，且更新间隔为1秒</p>
  <FaTimeAgo :date="new Date()" :update-interval="1000" :show-second="true" />
</template>
