<script setup lang="ts">
import type { FlattenedItem } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { TreeItem, TreeRoot, TreeVirtualizer } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { cn } from '#utils'
import Button from '../../basic/button/index.vue'
import Checkbox from '../../basic/checkbox/index.vue'
import Icon from '../../basic/icon/index.vue'
import Input from '../../basic/input/index.vue'

export interface TreeNode extends Record<string, any> {
  label: string
  children?: TreeNode[]
  checked?: boolean
  disabled?: boolean
}

export interface TreeProps {
  data: TreeNode[]
  checkable?: boolean
  filterable?: boolean
  virtualList?: boolean
  treeClass?: HTMLAttributes['class']
  filterPlaceholder?: string
  /**
   * 节点唯一标识的属性名
   * 如果提供此属性，将使用节点数据中对应的字段作为唯一键
   * 例如：node-key="id" 将使用节点的 id 属性作为唯一键
   * 如果不提供，将自动生成基于路径的唯一键
   */
  nodeKey?: string
  /**
   * 是否默认展开所有节点
   */
  defaultExpandAll?: boolean
  /**
   * 自定义过滤方法
   * @param query 搜索查询字符串
   * @param node 树形节点
   * @returns 是否匹配搜索条件
   *
   * 如果不提供此属性，组件将默认使用 label 字段进行模糊查询
   * 如果提供此属性，将优先使用自定义过滤逻辑，同时保持默认的 label 查询作为后备
   */
  filterMethod?: (query: string, node: TreeNode) => boolean
  class?: HTMLAttributes['class']
}

defineOptions({
  name: 'BuiltInTree',
})

const props = withDefaults(defineProps<TreeProps>(), {
  checkable: false,
  filterable: false,
  virtualList: false,
  filterPlaceholder: '搜索...',
  defaultExpandAll: false,
})

const emit = defineEmits<{
  selectionChange: [node: TreeNode | null]
  checkChange: [nodes: TreeNode[]]
}>()

const nodeKeyMap = new WeakMap<TreeNode, string>()
const keyNodeMap = new Map<string, TreeNode>()

const selectedId = ref<string | null>(null)
const expandedIds = ref<string[]>([])
const checkSelection = ref<TreeNode[]>([])
const searchQuery = ref('')
const hasInitializedExpandedState = ref(false)

function registerNode(node: TreeNode, key: string, replaceKeyNode = true) {
  nodeKeyMap.set(node, key)
  if (replaceKeyNode) {
    keyNodeMap.set(key, node)
  }
}

function generateNodeKey(node: TreeNode, parentKey = '', index: number): string {
  if (props.nodeKey && node[props.nodeKey] != null && node[props.nodeKey] !== '') {
    return String(node[props.nodeKey])
  }
  return parentKey ? `${parentKey}-${index}` : `${index}`
}

function syncNodeKeys(nodes: TreeNode[], parentKey: string | null = null) {
  nodes.forEach((node, index) => {
    const key = generateNodeKey(node, parentKey ?? '', index)
    registerNode(node, key, true)
    if (node.children?.length) {
      syncNodeKeys(node.children, key)
    }
  })
}

function getNodeKey(node: TreeNode): string {
  return nodeKeyMap.get(node) || ''
}

function getNodeByKey(key: string): TreeNode | null {
  return keyNodeMap.get(key) ?? null
}

function getChildren(node: TreeNode) {
  return node.children
}

function collectNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap(node => [
    node,
    ...(node.children?.length ? collectNodes(node.children) : []),
  ])
}

function syncCheckedFlags(nodes: TreeNode[]) {
  const checkedKeys = new Set(nodes.map(node => getNodeKey(node)))

  const traverse = (items: TreeNode[]) => {
    items.forEach((node) => {
      node.checked = checkedKeys.has(getNodeKey(node))
      if (node.children?.length) {
        traverse(node.children)
      }
    })
  }

  traverse(props.data)
}

function matchesNode(query: string, node: TreeNode): boolean {
  if (props.filterMethod && props.filterMethod(query, node)) {
    return true
  }
  return node.label.toLowerCase().includes(query.toLowerCase())
}

function buildFilteredTree(nodes: TreeNode[], query: string, expandedKeys: Set<string>): TreeNode[] {
  if (!query) {
    return nodes
  }

  return nodes
    .map((node) => {
      const key = getNodeKey(node)
      const children = node.children?.length
        ? buildFilteredTree(node.children, query, expandedKeys)
        : []
      const matched = matchesNode(query, node)

      if (!matched && children.length === 0) {
        return null
      }

      if (node.children?.length && (matched || children.length > 0)) {
        expandedKeys.add(key)
      }

      if (!node.children?.length || children.length === node.children.length) {
        return node
      }

      const cloned = {
        ...node,
        children,
      }
      registerNode(cloned, key, false)
      return cloned
    })
    .filter((node): node is TreeNode => node !== null)
}

const filteredResult = computed(() => {
  const query = searchQuery.value.trim()
  const expandedKeys = new Set<string>()
  const items = buildFilteredTree(props.data, query, expandedKeys)
  return {
    items,
    expandedKeys: [...expandedKeys],
    query,
  }
})

const filteredData = computed(() => filteredResult.value.items)

watch(
  () => props.data,
  (newData) => {
    keyNodeMap.clear()
    syncNodeKeys(newData)

    if (props.checkable) {
      checkSelection.value = collectNodes(newData).filter(node => node.checked && !node.disabled)
      syncCheckedFlags(checkSelection.value)
    }

    if (!hasInitializedExpandedState.value) {
      if (props.defaultExpandAll) {
        expandedIds.value = getAllParentIds(newData)
      }
      hasInitializedExpandedState.value = true
    }
    else {
      const validKeys = new Set(keyNodeMap.keys())
      expandedIds.value = expandedIds.value.filter(key => validKeys.has(key))
    }

    if (selectedId.value && !keyNodeMap.has(selectedId.value)) {
      selectedId.value = null
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => filteredResult.value,
  ({ query, expandedKeys }) => {
    if (!query) {
      return
    }

    const next = new Set(expandedIds.value)
    let changed = false
    expandedKeys.forEach((key) => {
      if (!next.has(key)) {
        next.add(key)
        changed = true
      }
    })

    if (changed) {
      expandedIds.value = [...next]
    }
  },
  { immediate: true },
)

const selectedNode = computed<TreeNode | undefined>(() => {
  if (!selectedId.value) {
    return undefined
  }
  return getNodeByKey(selectedId.value) ?? undefined
})

const treeRootClass = computed(() => cn(
  'space-y-1',
  props.virtualList && 'relative max-h-80 overflow-auto',
  props.treeClass,
))

function getAllParentIds(nodes: TreeNode[]): string[] {
  const ids: string[] = []
  nodes.forEach((node) => {
    if (node.children?.length) {
      const key = getNodeKey(node)
      if (key) {
        ids.push(key)
      }
      ids.push(...getAllParentIds(node.children))
    }
  })
  return ids
}

function setSelection(id: string | null, shouldEmit = true) {
  selectedId.value = id
  if (shouldEmit) {
    emit('selectionChange', id ? getNodeByKey(id) : null)
  }
}

function handleRootModelUpdate(node: TreeNode | TreeNode[] | null) {
  if (props.checkable) {
    const next = Array.isArray(node) ? node : []
    checkSelection.value = next
    syncCheckedFlags(next)
    emit('checkChange', next)
    return
  }
  setSelection(node ? getNodeKey(node as TreeNode) : null)
}

function handleExpandedUpdate(value: string[]) {
  expandedIds.value = value
}

function handleRowClick(item: FlattenedItem<TreeNode>) {
  if (item.value.disabled) {
    return
  }

  if (props.checkable) {
    return
  }

  setSelection(item._id)
}

function handleFlattenedRowClick(item: FlattenedItem<Record<string, any>>) {
  handleRowClick(item as FlattenedItem<TreeNode>)
}

function expand(nodeIds?: string[]) {
  if (nodeIds?.length) {
    const next = new Set(expandedIds.value)
    nodeIds.forEach((id) => {
      next.add(id)
    })
    expandedIds.value = [...next]
    return
  }

  expandedIds.value = getAllParentIds(props.data)
}

function collapse(nodeIds?: string[]) {
  if (nodeIds?.length) {
    const next = new Set(expandedIds.value)
    nodeIds.forEach((id) => {
      next.delete(id)
    })
    expandedIds.value = [...next]
    return
  }

  expandedIds.value = []
}

function checkAll(checked: boolean) {
  if (!props.checkable) {
    return
  }

  const next = checked ? collectNodes(props.data).filter(node => !node.disabled) : []
  checkSelection.value = next
  syncCheckedFlags(next)
  emit('checkChange', next)
}

function setSelectionById(id: string) {
  setSelection(id)
}

function clearSelection() {
  setSelection(null)
}

defineExpose({
  expand,
  collapse,
  checkAll,
  setSelection: setSelectionById,
  clearSelection,
})
</script>

<template>
  <div :class="cn('w-full', props.class)">
    <div v-if="filterable" class="mb-4 w-full relative">
      <Icon name="i-lucide:search" class="text-muted-foreground h-4 w-4 left-3 top-1/2 absolute -translate-y-1/2" />
      <Input v-model="searchQuery" :placeholder="filterPlaceholder" class="ps-8 w-full" />
    </div>
    <TreeRoot
      as="ul"
      :items="filteredData"
      :get-key="getNodeKey"
      :get-children="getChildren"
      :model-value="checkable ? checkSelection : selectedNode"
      :multiple="checkable ? true : undefined"
      :propagate-select="checkable ? true : undefined"
      :bubble-select="checkable ? true : undefined"
      :expanded="expandedIds"
      :class="treeRootClass"
      @update:model-value="handleRootModelUpdate"
      @update:expanded="handleExpandedUpdate"
    >
      <template #default="{ flattenItems }">
        <TreeVirtualizer
          v-if="virtualList"
          :estimate-size="36"
        >
          <template #default="{ item }">
            <TreeItem
              :key="item._id"
              v-bind="item.bind"
              as="li"
              class="list-none w-full"
            >
              <template #default="{ isExpanded, isSelected, isIndeterminate, handleSelect, handleToggle }">
                <div
                  :class="
                    cn(
                      'relative flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                      isSelected && !checkable && 'bg-accent text-accent-foreground',
                      !isSelected && !checkable && 'hover:bg-accent hover:text-accent-foreground',
                      item.value.disabled && 'cursor-not-allowed opacity-50',
                      !item.value.disabled && 'cursor-pointer',
                    )
                  "
                  :style="{ paddingInlineStart: `${Math.max(item.level - 1, 0) + 2}rem` }"
                  @click.stop="props.checkable ? handleSelect() : handleFlattenedRowClick(item)"
                >
                  <Button
                    v-if="item.hasChildren"
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    class="size-4 transition-transform top-1/2 absolute -translate-y-1/2"
                    :style="{ insetInlineStart: `${Math.max(item.level - 1, 0) + 0.5}rem` }"
                    @click.stop="handleToggle"
                  >
                    <Icon
                      name="i-lucide:chevron-down"
                      class="size-3 transition-transform"
                      :class="!isExpanded && 'rotate--90 rtl:rotate-90'"
                    />
                  </Button>

                  <Checkbox
                    v-if="checkable"
                    :model-value="isIndeterminate ? 'indeterminate' : isSelected"
                    :disabled="item.value.disabled"
                    class="flex-shrink-0"
                    @update:model-value="handleSelect"
                    @click.stop
                  />

                  <div class="text-sm text-foreground flex-1 min-w-0">
                    <slot
                      :node="item.value"
                      :expanded="isExpanded"
                    >
                      {{ item.value.label }}
                    </slot>
                  </div>
                </div>
              </template>
            </TreeItem>
          </template>
        </TreeVirtualizer>

        <template v-else>
          <TreeItem
            v-for="item in flattenItems"
            :key="item._id"
            v-bind="item.bind"
            as="li"
            class="list-none w-full"
          >
            <template #default="{ isExpanded, isSelected, isIndeterminate, handleSelect, handleToggle }">
              <div
                :class="
                  cn(
                    'relative flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    isSelected && !checkable && 'bg-accent text-accent-foreground',
                    !isSelected && !checkable && 'hover:bg-accent hover:text-accent-foreground',
                    item.value.disabled && 'cursor-not-allowed opacity-50',
                    !item.value.disabled && 'cursor-pointer',
                  )
                "
                :style="{ paddingInlineStart: `${Math.max(item.level - 1, 0) + 2}rem` }"
                @click.stop="props.checkable ? handleSelect() : handleFlattenedRowClick(item)"
              >
                <Button
                  v-if="item.hasChildren"
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  class="size-4 transition-transform top-1/2 absolute -translate-y-1/2"
                  :style="{ insetInlineStart: `${Math.max(item.level - 1, 0) + 0.5}rem` }"
                  @click.stop="handleToggle"
                >
                  <Icon
                    name="i-lucide:chevron-down"
                    class="size-3 transition-transform"
                    :class="!isExpanded && 'rotate--90 rtl:rotate-90'"
                  />
                </Button>

                <Checkbox
                  v-if="checkable"
                  :model-value="isIndeterminate ? 'indeterminate' : isSelected"
                  :disabled="item.value.disabled"
                  class="flex-shrink-0"
                  @update:model-value="handleSelect"
                  @click.stop
                />

                <div class="text-sm text-foreground flex-1 min-w-0">
                  <slot
                    :node="item.value"
                    :expanded="isExpanded"
                  >
                    {{ item.value.label }}
                  </slot>
                </div>
              </div>
            </template>
          </TreeItem>
        </template>
      </template>
    </TreeRoot>
  </div>
</template>
