<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTimeAgo from '../index.vue'
</script>

<template>
  <FaTimeAgo :date="new Date()" />
</template>
