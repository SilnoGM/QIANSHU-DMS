<script setup lang="ts">
import type {
  RegionScope,
  RegionScopeTreeNode,
} from './regions.logic'

import {
  regionDisplayStatusLabel,
  regionScopeKey,
  ROOT_SCOPE_ID,
} from './regions.logic'

defineOptions({ name: 'RegionScopeTree' })

const props = withDefaults(defineProps<{
  error?: null | string
  loading?: boolean
  modelValue: RegionScope
  nodes: RegionScopeTreeNode[]
  requestId?: string
}>(), {
  error: null,
  loading: false,
  requestId: undefined,
})

const emit = defineEmits<{
  'retry': []
  'select': [scope: RegionScope]
  'update:modelValue': [scope: RegionScope]
}>()

interface TreeController {
  expand: (nodeIds?: string[]) => void
  setSelection: (id: string) => void
}

interface FaTreeNode {
  [key: string]: unknown
  checked?: boolean
  children?: FaTreeNode[]
  disabled?: boolean
  label: string
}

interface ScopeTreeViewNode extends FaTreeNode {
  children?: ScopeTreeViewNode[]
  disabled: false
  id: string
  label: string
  scope: RegionScope
  searchText: string
  status: RegionScopeTreeNode['status']
}

const treeRef = ref<TreeController>()
let synchronizingSelection = false

const treeData = computed<ScopeTreeViewNode[]>(() => props.nodes.map(toTreeViewNode))

function toTreeViewNode(node: RegionScopeTreeNode): ScopeTreeViewNode {
  return {
    ...(node.children === undefined
      ? {}
      : { children: node.children.map(toTreeViewNode) }),
    disabled: false,
    id: node.id,
    label: node.label,
    scope: node.scope,
    searchText: node.searchText,
    status: node.status,
  }
}

function isScopeTreeViewNode(node: FaTreeNode): node is ScopeTreeViewNode {
  return typeof node.id === 'string'
    && typeof node.searchText === 'string'
    && typeof node.scope === 'object'
    && node.scope !== null
}

function filterNode(query: string, node: FaTreeNode): boolean {
  const normalizedQuery = query
    .normalize('NFC')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
  return normalizedQuery === ''
    || (
      isScopeTreeViewNode(node)
      && node.searchText.includes(normalizedQuery)
    )
}

function handleSelection(node: FaTreeNode | null): void {
  if (
    synchronizingSelection
    || node === null
    || !isScopeTreeViewNode(node)
  ) {
    return
  }
  emit('update:modelValue', node.scope)
  emit('select', node.scope)
}

/**
 * FaTree 在 navigation 首次异步到达后才真正挂载，因此不能只在 wrapper mounted 时
 * 展开虚拟根。treeData 每次替换时重新展开根节点，并在同一 nextTick 内恢复当前选中项。
 */
async function synchronizeTreeState(expandRoot: boolean): Promise<void> {
  await nextTick()
  if (treeRef.value === undefined) {
    return
  }
  if (expandRoot) {
    treeRef.value.expand([ROOT_SCOPE_ID])
  }
  synchronizingSelection = true
  treeRef.value.setSelection(regionScopeKey(props.modelValue))
  synchronizingSelection = false
}

onMounted(() => {
  void synchronizeTreeState(true)
})

watch(
  () => props.modelValue,
  () => {
    void synchronizeTreeState(false)
  },
  { deep: true },
)

watch(
  treeData,
  () => {
    void synchronizeTreeState(true)
  },
  { deep: true },
)
</script>

<template>
  <section class="min-w-0" aria-label="地区范围导航" :aria-busy="loading">
    <div class="mb-3 flex gap-3 items-start justify-between">
      <div class="min-w-0">
        <h2 class="qs-type-compact-title m-0">
          地区范围
        </h2>
        <p class="qs-type-meta mb-0 mt-1">
          选择全部地区、国家/地区或省/州
        </p>
      </div>
      <FaIcon
        v-if="loading"
        name="i-lucide:loader-circle"
        class="text-muted-foreground mt-0.5 shrink-0 size-4 animate-spin"
        aria-label="正在加载地区范围"
      />
    </div>

    <FaAlert
      v-if="error"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="地区范围加载失败"
      class="mb-3"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">
            requestId: {{ requestId }}
          </code>
          <FaButton variant="outline" size="sm" class="w-fit" @click="emit('retry')">
            重试加载
          </FaButton>
        </div>
      </template>
    </FaAlert>

    <div
      v-if="loading && treeData[0]?.children?.length === 0"
      class="gap-2 grid"
      role="status"
      aria-label="正在加载地区范围"
    >
      <div
        v-for="index in 5"
        :key="index"
        class="region-scope-loading-placeholder rounded-md bg-muted h-8 animate-pulse"
      />
    </div>

    <FaEmpty
      v-else-if="treeData[0]?.children?.length === 0 && !error"
      icon="i-lucide:map"
      title="暂无地区范围"
      description="数据库中尚未维护国家或地区。"
      class="min-h-48"
    />

    <FaTree
      v-else
      ref="treeRef"
      :data="treeData"
      node-key="id"
      filterable
      filter-placeholder="搜索国家、省州或 Code"
      :filter-method="filterNode"
      tree-class="pb-2"
      @selection-change="handleSelection"
    >
      <template #default="{ node }">
        <div class="py-0.5 flex gap-2 min-w-0 items-center justify-between">
          <div class="flex gap-2 min-w-0 items-center">
            <FaIcon
              :name="node.id === ROOT_SCOPE_ID
                ? 'i-lucide:globe-2'
                : node.scope.kind === 'COUNTRY_REGION'
                  ? 'i-lucide:flag'
                  : 'i-lucide:map-pin'"
              class="text-muted-foreground shrink-0 size-4"
            />
            <span class="truncate">{{ node.label }}</span>
          </div>
          <FaTag
            v-if="node.status !== 'EFFECTIVE'"
            variant="outline"
            class="text-muted-foreground qs-type-status-tag border-border bg-muted shrink-0"
          >
            {{ regionDisplayStatusLabel(node.status) }}
          </FaTag>
        </div>
      </template>
    </FaTree>
  </section>
</template>

<style scoped>
@media (width <= 767px) {
  :deep([role="treeitem"] > div) {
    min-height: 2.75rem;
  }

  /*
   * FaTree 的展开图标视觉尺寸保持紧凑，通过伪元素把独立点击命中区扩到 44px。
   * 伪元素仍属于原 button，不会把展开动作误合并到整行选择动作。
   */
  :deep([role="treeitem"] > div > button)::before {
    position: absolute;
    inset: -0.875rem;
    content: "";
  }
}

@media (prefers-reduced-motion: reduce) {
  .region-scope-loading-placeholder {
    animation: none !important;
  }

  :deep([role="treeitem"] *),
  .animate-spin {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
