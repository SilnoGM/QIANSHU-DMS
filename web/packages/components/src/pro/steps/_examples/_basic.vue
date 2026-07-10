<script setup lang="ts">
import type { StepsItem } from '../index.vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaSteps from '../index.vue'

const steps: StepsItem[] = [
  { id: 'account', title: '账号信息', description: '填写登录账号' },
  { id: 'profile', title: '完善资料', description: '补充姓名与部门' },
  { id: 'permission', title: '分配权限', description: '选择角色和菜单' },
  { id: 'done', title: '完成', description: '确认并提交' },
]
</script>

<template>
  <FaSteps :model-value="2" :steps="steps" />
</template>
