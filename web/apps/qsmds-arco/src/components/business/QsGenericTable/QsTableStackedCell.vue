<script setup lang="ts">
defineOptions({ name: 'QsTableStackedCell' })
</script>

<template>
  <!--
    使用 inline-grid 让组件跟随 FaTable 单元格当前的左、中、右对齐方式；组件只负责
    稳定的纵向节奏，不感知订单、金额或状态等具体业务语义。
  -->
  <div
    data-slot="qs-table-stacked-cell"
    class="align-middle gap-1 inline-grid min-w-0"
  >
    <slot />
  </div>
</template>
