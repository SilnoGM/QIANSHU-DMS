<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import PersonalFundAccountCardShowcase from './components/PersonalFundAccountCardShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsPersonalFundAccountCard' })

const principles = [
  {
    title: '纯展示，数据外置',
    description: '账户、加载与错误状态由页面请求 GET /fund-accounts/me 后传入；卡片不读 API、Store 或路由，两个操作只发事件。',
    icon: 'i-lucide:unplug',
  },
  {
    title: '按容器宽度自适应',
    description: '卡片自身是容器：宽屏、窄屏与移动端三档按实际卡片宽度切换，页面侧边栏或抽屉不会让形态判断失真。',
    icon: 'i-lucide:layout-dashboard',
  },
  {
    title: '金额隐私边界',
    description: '隐藏金额时只渲染固定掩码，真实余额不进入 DOM、aria-label 或 title；显隐默认可见且组件不持久化。',
    icon: 'i-lucide:eye-off',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="个人资金账户卡片"
    description="独立验收 QsPersonalFundAccountCard 的宽/窄/移动端形态、金额显隐、空态与加载/失败态。"
    section-label="QsPersonalFundAccountCard"
    headline="一眼看清本人余额与账户状态"
    summary="运营本人账户的概览卡片：左侧余额面板、右侧分成比例与时间指标、两个提款入口。数据来自已实现的本人账户接口，按钮暂以轻提示占位。"
    route-path="/component-library/business/personal-fund-account-card"
    icon="i-lucide:wallet"
    :principles="principles"
    stage-label="卡片已展示"
    empty-description="个人资金账户卡片示例尚未接入。"
  >
    <PersonalFundAccountCardShowcase />
  </ComponentCatalogPage>
</template>
