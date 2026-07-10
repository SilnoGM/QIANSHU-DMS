<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaIcon from '../../../basic/icon/index.vue'
import FaIconPicker from '../index.vue'
import { icons } from './icons'
</script>

<template>
  <FaIconPicker :icons>
    <template #default="{ icon }">
      <div class="px-3 py-1 border rounded-full flex-center-start inline-flex gap-2 cursor-pointer">
        <FaIcon v-if="icon" :name="icon" />
        <div class="text-sm">
          {{ icon || '请选择' }}
        </div>
      </div>
    </template>
  </FaIconPicker>
</template>
