<script setup lang="ts">
// 版本号与登录页同源：构建期由 vite define 注入的应用版本，避免两处显示分叉。
const appVersion = `V${__SYSTEM_INFO__.pkg.version}`
</script>

<template>
  <div>
    <FaPageMain>
      <h1 class="qs-type-page-title m-0">
        欢迎使用千树数据管理平台 {{ appVersion }} 预览版
      </h1>
    </FaPageMain>
  </div>
</template>
