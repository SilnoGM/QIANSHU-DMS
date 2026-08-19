<script setup lang="ts">
import type { FundBusinessSourceDto } from '@/api/generated/types.gen'

import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'

defineOptions({ name: 'FundBusinessSourcePanel' })

const props = defineProps<{
  error?: string
  items: readonly FundBusinessSourceDto[]
  loading: boolean
  stateKey: number
}>()

const emit = defineEmits<{
  create: []
  edit: [target: FundBusinessSourceDto]
  refresh: []
  status: [target: FundBusinessSourceDto, action: 'disable' | 'enable']
}>()

const search = ref('')
const filteredItems = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return props.items.filter(item => keyword.length === 0 || (
    item.code.toLocaleLowerCase().includes(keyword)
    || item.name.toLocaleLowerCase().includes(keyword)
  ))
})

watch(() => props.stateKey, () => {
  search.value = ''
})
</script>

<template>
  <section aria-labelledby="fund-business-source-heading">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 id="fund-business-source-heading" class="text-base m-0">
          业务来源
        </h3>
        <p class="qs-type-meta m-0 mt-1">
          来源绑定可信业务域，并限制 allowedPostingTypes 调用范围。
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <FaButton variant="outline" class="min-h-11 sm:min-h-9" :disabled="loading" @click="emit('refresh')">
          <FaIcon name="i-lucide:refresh-cw" />刷新
        </FaButton>
        <FaButton class="min-h-11 sm:min-h-9" @click="emit('create')">
          <FaIcon name="i-lucide:plus" />创建来源
        </FaButton>
      </div>
    </div>

    <FaInput v-model="search" type="search" clearable class="mb-4 w-full" placeholder="搜索来源名称或稳定编码">
      <template #start>
        <FaIcon name="i-lucide:search" />
      </template>
    </FaInput>

    <FaAlert v-if="error" variant="destructive" icon="i-lucide:circle-alert" title="业务来源加载失败" class="mb-4">
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
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />正在读取业务来源…
    </div>
    <FaEmpty v-else-if="filteredItems.length === 0" icon="i-lucide:waypoints" title="暂无业务来源" description="当前搜索条件下没有可展示的业务来源。" class="py-10" />
    <div v-else data-testid="fund-business-source-list" class="gap-3 grid" role="list">
      <article v-for="item in filteredItems" :key="item.id" class="p-4 border border-border rounded-lg bg-background gap-4 grid" role="listitem">
        <header class="pb-3 border-b border-border/70 flex gap-3 min-w-0 items-start justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-data-emphasis break-words">{{ item.name }}</span>
              <FaTag :variant="item.enabled ? 'default' : 'outline'">
                {{ item.enabled ? '启用' : '停用' }}
              </FaTag>
            </div>
            <code class="qs-type-meta mt-1 block break-all">{{ item.code }}</code>
          </div>
          <span class="qs-type-meta shrink-0">并发版本 {{ item.version }}</span>
        </header>

        <div>
          <div class="qs-type-compact-label mb-2">
            允许业务类型
          </div>
          <div v-if="item.allowedPostingTypes.length" class="flex flex-wrap gap-2">
            <FaTag v-for="postingType in item.allowedPostingTypes" :key="postingType.id" variant="outline">
              {{ postingType.name }} · {{ postingType.code }}<span v-if="!postingType.enabled"> · 已停用</span>
            </FaTag>
          </div>
          <span v-else class="qs-type-meta">未授权任何业务类型</span>
        </div>

        <dl class="m-0 gap-x-5 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label mb-1">
              说明
            </dt><dd class="qs-type-body m-0 break-words">
              {{ item.description || '—' }}
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

        <div class="pt-3 border-t border-border/70 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="emit('edit', item)">
            <FaIcon name="i-lucide:pencil" />编辑来源
          </FaButton>
          <FaButton v-if="item.enabled" variant="destructive" size="sm" class="min-h-11 sm:min-h-9" @click="emit('status', item, 'disable')">
            <FaIcon name="i-lucide:circle-pause" />停用
          </FaButton>
          <FaButton v-else size="sm" class="min-h-11 sm:min-h-9" @click="emit('status', item, 'enable')">
            <FaIcon name="i-lucide:circle-play" />启用
          </FaButton>
        </div>
      </article>
    </div>
  </section>
</template>
