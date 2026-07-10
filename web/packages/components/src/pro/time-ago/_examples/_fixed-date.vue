<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTimeAgo from '../index.vue'
</script>

<template>
  <p>距离 2020/10/17 ：</p>
  <FaTimeAgo :date="new Date('2020/10/17')" />
</template>
