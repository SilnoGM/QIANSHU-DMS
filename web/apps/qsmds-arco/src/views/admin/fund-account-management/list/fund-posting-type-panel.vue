<script setup lang="ts">
import type {
  FundPostingRuleLegRequestDto,
  FundPostingTypeDto,
} from '@/api/generated/types.gen'

import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'

import { describeFundRuleTargets } from './fund-configuration.logic'

defineOptions({ name: 'FundPostingTypePanel' })

const props = defineProps<{
  error?: string
  items: readonly FundPostingTypeDto[]
  loading: boolean
  stateKey: number
}>()

const emit = defineEmits<{
  create: []
  edit: [target: FundPostingTypeDto]
  editRule: [target: FundPostingTypeDto]
  publish: [target: FundPostingTypeDto]
  refresh: []
  status: [target: FundPostingTypeDto, action: 'disable' | 'enable']
}>()

const search = ref('')
const filteredItems = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return props.items.filter(item => keyword.length === 0 || (
    item.code.toLocaleLowerCase().includes(keyword)
    || item.name.toLocaleLowerCase().includes(keyword)
  ))
})

const businessCategoryLabels = {
  ADJUSTMENT: '调账',
  COST: '成本',
  NEUTRAL: '非收益成本',
  REVENUE: '收益',
} as const
const amountPolicyLabels = {
  NON_ZERO_SIGNED: '非零，可正可负',
  POSITIVE_ONLY: '必须大于 0',
} as const

function ruleLegs(item: FundPostingTypeDto): readonly FundPostingRuleLegRequestDto[] {
  return item.activeRule?.legs ?? item.draftRule?.legs ?? []
}

function directionLabel(item: FundPostingTypeDto): string {
  const policies = [...new Set(ruleLegs(item).map(leg => leg.directionPolicy))]
  return policies.map((policy) => {
    if (policy === 'CREDIT') {
      return '入账'
    }
    if (policy === 'DEBIT') {
      return '出账'
    }
    return '跟随金额符号'
  }).join(' / ') || '尚未配置'
}

watch(() => props.stateKey, () => {
  search.value = ''
})
</script>

<template>
  <section aria-labelledby="fund-posting-type-heading">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 id="fund-posting-type-heading" class="text-base m-0">
          业务类型
        </h3>
        <p class="qs-type-meta m-0 mt-1">
          规则先保存为草稿，再经确认发布为生效版本。
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <FaButton variant="outline" class="min-h-11 sm:min-h-9" :disabled="loading" @click="emit('refresh')">
          <FaIcon name="i-lucide:refresh-cw" />刷新
        </FaButton>
        <FaButton class="min-h-11 sm:min-h-9" @click="emit('create')">
          <FaIcon name="i-lucide:plus" />创建类型
        </FaButton>
      </div>
    </div>

    <FaInput v-model="search" type="search" clearable class="mb-4 w-full" placeholder="搜索类型名称或稳定编码">
      <template #start>
        <FaIcon name="i-lucide:search" />
      </template>
    </FaInput>

    <FaAlert v-if="error" variant="destructive" icon="i-lucide:circle-alert" title="业务类型加载失败" class="mb-4">
      <template #description>
        <div class="gap-3 grid">
          <span>{{ error }}</span>
          <FaButton variant="outline" size="sm" class="min-h-11 w-fit sm:min-h-9" @click="emit('refresh')">
            重新读取
          </FaButton>
        </div>
      </template>
    </FaAlert>

    <div v-if="loading" class="py-12 flex gap-2 items-center justify-center" role="status">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />正在读取业务类型…
    </div>
    <FaEmpty v-else-if="filteredItems.length === 0" icon="i-lucide:layers-3" title="暂无业务类型" description="当前搜索条件下没有可展示的业务类型。" class="py-10" />
    <div v-else data-testid="fund-posting-type-list" class="gap-3 grid" role="list">
      <article
        v-for="item in filteredItems"
        :key="item.id"
        class="p-4 border border-border rounded-lg bg-background gap-4 grid"
        role="listitem"
      >
        <header class="pb-3 border-b border-border/70 flex gap-3 min-w-0 items-start justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-data-emphasis break-words">{{ item.name }}</span>
              <FaTag :variant="item.enabled ? 'default' : 'outline'">
                {{ item.enabled ? '启用' : '停用' }}
              </FaTag>
              <FaTag v-if="item.inputMode === 'ADMIN_ADJUSTMENT'" variant="outline">
                系统只读规则
              </FaTag>
            </div>
            <code class="qs-type-meta mt-1 block break-all">{{ item.code }}</code>
          </div>
          <span class="qs-type-meta shrink-0">并发版本 {{ item.version }}</span>
        </header>

        <dl class="m-0 gap-x-5 gap-y-3 grid grid-cols-3 max-[479px]:grid-cols-1 sm:grid-cols-2">
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务分类
            </dt><dd class="qs-type-data m-0">
              {{ businessCategoryLabels[item.businessCategory] }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              金额策略
            </dt><dd class="qs-type-data m-0">
              {{ amountPolicyLabels[item.amountSignPolicy] }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              账户目标
            </dt><dd class="qs-type-data m-0">
              {{ describeFundRuleTargets(ruleLegs(item)) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              收支方式
            </dt><dd class="qs-type-data m-0">
              {{ directionLabel(item) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              生效版本
            </dt><dd class="qs-type-data m-0">
              {{ item.activeRule ? `v${item.activeRule.revision}` : '尚未发布' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              草稿版本
            </dt><dd class="qs-type-data m-0">
              {{ item.draftRule ? `v${item.draftRule.revision}` : '无草稿' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              更新时间
            </dt><dd class="m-0">
              <DateTimeDisplay :value="item.updatedAt" />
            </dd>
          </div>
        </dl>

        <div class="pt-3 border-t border-border/70 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="emit('edit', item)">
            <FaIcon name="i-lucide:pencil" />编辑信息
          </FaButton>
          <FaButton v-if="item.inputMode === 'STANDARD'" variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="emit('editRule', item)">
            <FaIcon name="i-lucide:list-tree" />编辑规则草稿
          </FaButton>
          <FaButton v-if="item.draftRule" variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="emit('publish', item)">
            <FaIcon name="i-lucide:send" />发布 v{{ item.draftRule.revision }}
          </FaButton>
          <FaButton v-if="item.enabled" variant="destructive" size="sm" class="min-h-11 sm:min-h-9" @click="emit('status', item, 'disable')">
            <FaIcon name="i-lucide:circle-pause" />停用
          </FaButton>
          <FaButton
            v-else
            size="sm"
            class="min-h-11 sm:min-h-9"
            :disabled="item.activeRule === null"
            :title="item.activeRule === null ? '需要先发布规则版本' : undefined"
            @click="emit('status', item, 'enable')"
          >
            <FaIcon name="i-lucide:circle-play" />启用
          </FaButton>
        </div>
      </article>
    </div>
  </section>
</template>
