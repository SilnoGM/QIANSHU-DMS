<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import MoneyInputShowcase from './components/MoneyInputShowcase.vue'

defineOptions({ name: 'ComponentLibraryMoneyInput' })

const principles = [
  {
    title: '字符串贯穿链路',
    description: '表单、API 与金额显示共享十进制字符串，不把精确金额降级为 JavaScript number。',
    icon: 'i-lucide:braces',
  },
  {
    title: '金额币种分别保存',
    description: '金额保持原字符串；币种默认 CNY，并通过右侧下拉独立选择，不执行隐式汇率换算。',
    icon: 'i-lucide:coins',
  },
  {
    title: '严格校验后计算',
    description: '先拒绝展示符号、科学计数法和超精度文本，再交给 Decimal 比较或汇总。',
    icon: 'i-lucide:shield-check',
  },
  {
    title: '非法数据明确失败',
    description: '空值使用 null；非法金额携带稳定错误码，列汇总不会将其静默当作零。',
    icon: 'i-lucide:triangle-alert',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="金额输入"
    description="独立验收 MoneyInput 的严格金额字符串、默认与可选币种、AmountDisplay 配对和 Decimal 精确汇总。"
    section-label="MoneyInput"
    headline="金额与币种分离，精度贯穿录入到展示"
    summary="组件以 FaInput 为内核；金额使用 string 或 null，币种使用独立命名模型，decimal.js 仅承担精确比较、规范化与同币种汇总。"
    route-path="/component-library/basic/money-input"
    icon="i-lucide:hand-coins"
    :principles="principles"
    stage-label="金额输入组件已展示"
    empty-description="金额输入组件示例尚未接入。"
  >
    <MoneyInputShowcase />
  </ComponentCatalogPage>
</template>
