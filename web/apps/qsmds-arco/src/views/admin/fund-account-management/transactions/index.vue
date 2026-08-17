<script setup lang="ts">
/**
 * 首期只预留资金账户流水路由。单一空白根节点不会生成开发态 Fragment，确保全局
 * 页面过渡在进入和离开空白页面时都能完成生命周期切换。
 */
defineOptions({ name: 'AdminFundAccountTransactions' })
</script>

<template>
  <div />
</template>
