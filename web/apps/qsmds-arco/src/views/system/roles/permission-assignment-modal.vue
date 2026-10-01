<script setup lang="ts">
import type { PermissionGroup } from '../permissions/catalog'
import type { PermissionScopeFilter } from './permission-assignment.logic'
import type { PermissionDto, RoleDto } from '@/api/generated/types.gen'

import { useResizeObserver } from '@vueuse/core'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { groupPermissions, sanitizePermissionSelection } from '../permissions/catalog'
import {
  assignablePermissionIds,
  buildAssignmentGroups,
  PERMISSION_SCOPE_ALL,
  selectPermissions,
  summarizeGroup,
  summarizeSelection,
  toggleGroupSelection,
} from './permission-assignment.logic'

defineOptions({ name: 'PermissionAssignmentDrawer' })

const props = defineProps<{
  visible: boolean
  role: RoleDto | null
  permissions: PermissionDto[]
  loading: boolean
  errorMessage: string
}>()

const emits = defineEmits<{
  'update:visible': [value: boolean]
  'submit': [roleId: string, permissionIds: string[]]
}>()

const toast = useQsToast()

const selectedIds = ref<string[]>([])
const keyword = ref('')
const scope = ref<PermissionScopeFilter>(PERMISSION_SCOPE_ALL)
const onlySelected = ref(false)
/** 默认全展开，因此这里记录的是被用户收起的组，避免把「展开」当成额外状态维护。 */
const collapsedGroupKeys = ref<string[]>([])
const selectedPanelOpen = ref(false)
const clearConfirmVisible = ref(false)
const highlightedPermissionId = ref<string | null>(null)
const listRef = ref<HTMLElement | null>(null)
const toolbarRef = ref<HTMLElement | null>(null)
/** 吸顶工具栏的边框盒高度（含内边距）与滚动容器上内边距，均用实测值，避免换行或改版后错位。 */
const stickyOffset = ref(0)
const scrollPaddingTop = ref(0)
let highlightTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 抽屉正文由 FaDrawer 统一滚动，sticky 偏移以滚动容器的内容边为基准，
 * 因此工具栏要用负 top 抵消容器内边距，分组头则要减掉同一段内边距才能贴在工具栏下方。
 */
function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current !== null) {
    const overflowY = window.getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return current
    }
    current = current.parentElement
  }
  return null
}

function syncStickyMetrics(): void {
  const toolbar = toolbarRef.value
  if (toolbar === null) {
    return
  }

  stickyOffset.value = Math.round(toolbar.getBoundingClientRect().height)
  const scroller = findScrollContainer(toolbar)
  scrollPaddingTop.value = scroller === null
    ? 0
    : Math.round(Number.parseFloat(window.getComputedStyle(scroller).paddingTop) || 0)
}

useResizeObserver(toolbarRef, syncStickyMetrics)

const scopeOptions = [
  { label: '全部权限', value: PERMISSION_SCOPE_ALL },
  { label: '普通权限', value: 'business' },
  { label: '系统专用', value: 'system' },
] as const

const allGroups = computed(() => groupPermissions(props.permissions))
const baselineIds = computed(() => props.role === null
  ? []
  : sanitizePermissionSelection(props.role.permissionIds, props.permissions))
const filterActive = computed(() => keyword.value.trim() !== ''
  || scope.value !== PERMISSION_SCOPE_ALL
  || onlySelected.value)
const visibleGroups = computed<PermissionGroup[]>(() => filterActive.value
  ? buildAssignmentGroups(props.permissions, {
      keyword: keyword.value,
      onlySelected: onlySelected.value,
      scope: scope.value,
      selectedIds: selectedIds.value,
    })
  : allGroups.value)
const selection = computed(() => summarizeSelection(allGroups.value, selectedIds.value, baselineIds.value))
const selectedGroupEntries = computed(() => {
  const selected = new Set(selectedIds.value)
  return allGroups.value
    .map(group => ({
      key: group.key,
      label: group.label,
      permissions: group.permissions.filter(permission => !permission.systemOnly && selected.has(permission.id)),
    }))
    .filter(entry => entry.permissions.length > 0)
})
const groupRows = computed(() => {
  const fullGroups = new Map(allGroups.value.map(group => [group.key, group]))
  return visibleGroups.value.map((group) => {
    // 计数、三态与组级勾选都以完整组为准；筛选只影响列表展示，否则取消勾选会漏掉被隐藏的项。
    const fullGroup = fullGroups.get(group.key) ?? group
    const summary = summarizeGroup(fullGroup, selectedIds.value)
    const visibleAssignable = summarizeGroup(group, selectedIds.value).assignable
    return {
      collapsed: collapsedGroupKeys.value.includes(group.key),
      fullGroup,
      group,
      // 被筛选隐藏的可分配项必须显式说明，否则列表看起来比计数短、像是漏了权限。
      hiddenAssignable: filterActive.value ? summary.assignable - visibleAssignable : 0,
      summary,
      visibleAssignable,
    }
  })
})
const matchedAssignableCount = computed(() =>
  groupRows.value.reduce((total, row) => total + row.visibleAssignable, 0))
const allGroupsCollapsed = computed(() => visibleGroups.value.length > 0
  && visibleGroups.value.every(group => collapsedGroupKeys.value.includes(group.key)))

function groupOptions(group: PermissionGroup) {
  return group.permissions.map(permission => ({
    code: permission.code,
    description: permission.description || permission.name,
    disabled: permission.systemOnly,
    label: permission.name,
    systemOnly: permission.systemOnly,
    value: permission.id,
  }))
}

function groupCheckboxValue(state: ReturnType<typeof summarizeGroup>['state']): boolean | 'indeterminate' {
  if (state === 'all') {
    return true
  }
  return state === 'partial' ? 'indeterminate' : false
}

function toggleGroup(group: PermissionGroup): void {
  selectedIds.value = toggleGroupSelection(group, selectedIds.value)
}

function toggleGroupCollapse(groupKey: string): void {
  collapsedGroupKeys.value = collapsedGroupKeys.value.includes(groupKey)
    ? collapsedGroupKeys.value.filter(key => key !== groupKey)
    : [...collapsedGroupKeys.value, groupKey]
}

function toggleAllGroupsCollapse(): void {
  collapsedGroupKeys.value = allGroupsCollapsed.value
    ? []
    : visibleGroups.value.map(group => group.key)
}

function selectVisibleResults(): void {
  const ids = visibleGroups.value.flatMap(group => assignablePermissionIds(group))
  selectedIds.value = selectPermissions(ids, selectedIds.value)
  toast.success(`已选中当前结果的 ${ids.length} 项可分配权限`)
}

function removePermission(permissionId: string): void {
  selectedIds.value = selectedIds.value.filter(id => id !== permissionId)
}

function clearSelection(): void {
  selectedIds.value = []
  clearConfirmVisible.value = false
}

function resetFilters(): void {
  keyword.value = ''
  scope.value = PERMISSION_SCOPE_ALL
  onlySelected.value = false
}

/**
 * 定位依赖列表真实渲染，因此先清除会隐藏目标的筛选与折叠，再滚动并临时高亮。
 * 元素查询限定在抽屉列表容器内，避免与页面其余同名标识冲突。
 */
async function locatePermission(permissionId: string): Promise<void> {
  if (filterActive.value) {
    resetFilters()
    toast.info('已清除筛选条件以定位该权限')
    await nextTick()
  }

  const group = allGroups.value.find(entry => entry.permissions.some(permission => permission.id === permissionId))
  if (group === undefined) {
    toast.warning('该权限已不在当前权限目录中，请刷新后重试')
    return
  }
  if (collapsedGroupKeys.value.includes(group.key)) {
    collapsedGroupKeys.value = collapsedGroupKeys.value.filter(key => key !== group.key)
    await nextTick()
  }

  const target = listRef.value?.querySelector<HTMLElement>(`[data-permission-id="${CSS.escape(permissionId)}"]`)
  if (target === null || target === undefined) {
    return
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  highlightedPermissionId.value = permissionId
  if (highlightTimer !== undefined) {
    clearTimeout(highlightTimer)
  }
  highlightTimer = setTimeout(() => {
    highlightedPermissionId.value = null
    highlightTimer = undefined
  }, 1600)
}

function close(): void {
  if (!props.loading) {
    emits('update:visible', false)
  }
}

function handleVisibleChange(visible: boolean): void {
  if (!visible) {
    close()
  }
}

function submit(): void {
  if (props.loading || props.role === null || props.role.isSystem) {
    return
  }
  emits(
    'submit',
    props.role.id,
    sanitizePermissionSelection(selectedIds.value, props.permissions),
  )
}

watch(() => [props.visible, props.role] as const, ([visible, role]) => {
  if (visible) {
    selectedIds.value = role === null
      ? []
      : sanitizePermissionSelection(role.permissionIds, props.permissions)
    // 查询条件与折叠状态只服务于单次打开，不跨次沿用，避免误以为权限缺失。
    resetFilters()
    collapsedGroupKeys.value = []
    selectedPanelOpen.value = false
    clearConfirmVisible.value = false
    highlightedPermissionId.value = null
  }
})

onBeforeUnmount(() => {
  if (highlightTimer !== undefined) {
    clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
})
</script>

<template>
  <QsGenericDrawer
    :model-value="visible"
    title="分配权限"
    :description="role === null
      ? '选择角色需要的业务权限。'
      : `正在为「${role.name}」配置权限，保存后立即生效。`"
    placement="right"
    size="xl"
    :submitting="loading"
    @update:model-value="handleVisibleChange"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:shield-check" class="size-4" />
    </template>

    <div data-testid="permission-assignment-drawer-content" class="gap-4 grid">
      <!-- 保存错误属于业务提交反馈，不复用通用抽屉固定的“加载失败”内容状态。 -->
      <FaAlert
        v-if="errorMessage"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="权限保存失败"
        :description="errorMessage"
      />
      <FaAlert
        icon="i-lucide:triangle-alert"
        description="提交会替换该角色的完整权限集合；不勾选任何权限表示清空。系统专用权限不可分配给普通角色。"
      />

      <FaEmpty
        v-if="permissions.length === 0"
        icon="i-lucide:shield-off"
        title="暂无可分配权限"
        description="请先确认权限目录已正常加载。"
      />
      <div v-else class="gap-3 grid">
        <!-- 工具栏吸顶且不引入第二个滚动区；负外边距抵消抽屉正文的内边距，让吸顶时不露出滚动内容。 -->
        <div
          ref="toolbarRef"
          data-testid="permission-assignment-toolbar"
          class="pb-3 pt-4 border-b border-border bg-background gap-3 grid sticky z-10 -mt-4 md:pt-6 md:-mt-6"
          :style="{ top: `-${scrollPaddingTop}px` }"
        >
          <div class="flex flex-wrap gap-2 items-center">
            <FaInput
              v-model="keyword"
              type="search"
              clearable
              class="flex-1 min-w-0"
              placeholder="搜索权限码、名称或说明"
              aria-label="搜索权限"
              :disabled="loading"
              @clear="keyword = ''"
            >
              <template #start>
                <FaIcon name="i-lucide:search" />
              </template>
            </FaInput>
            <FaSelect
              v-model="scope"
              :options="[...scopeOptions]"
              aria-label="权限范围"
              class="shrink-0 w-32 sm:w-36"
              :disabled="loading"
            />
          </div>

          <div class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-3 gap-y-2 items-center">
            <span class="shrink-0">
              已选 <strong class="qs-type-data text-foreground">{{ selection.total }}</strong> 项 · 涉及 {{ selection.groupCount }} 组
            </span>
            <span
              v-if="selection.added > 0 || selection.removed > 0"
              class="flex shrink-0 gap-2 items-center"
            >
              <span class="text-primary">+{{ selection.added }}</span>
              <span class="text-destructive">-{{ selection.removed }}</span>
            </span>
            <div class="flex shrink-0 gap-2 items-center">
              <FaSwitch v-model="onlySelected" aria-label="只看已选" :disabled="loading" />
              <span>只看已选</span>
            </div>
            <!-- 窄屏只留图标，靠 aria-label 与 tooltip 保持可理解；文本在 sm 起显示，避免工具栏占满首屏。 -->
            <FaTooltip :text="allGroupsCollapsed ? '展开全部' : '折叠全部'">
              <FaButton
                variant="ghost"
                size="sm"
                class="shrink-0 min-h-9"
                :aria-label="allGroupsCollapsed ? '展开全部' : '折叠全部'"
                :disabled="loading || visibleGroups.length === 0"
                @click="toggleAllGroupsCollapse"
              >
                <FaIcon name="i-lucide:chevrons-up-down" class="size-4" />
                <span class="hidden sm:inline">{{ allGroupsCollapsed ? '展开全部' : '折叠全部' }}</span>
              </FaButton>
            </FaTooltip>
            <FaButton
              variant="ghost"
              size="sm"
              class="text-destructive shrink-0 min-h-9"
              :disabled="loading || selection.total === 0"
              @click="clearConfirmVisible = true"
            >
              清空已选
            </FaButton>
          </div>

          <div
            v-if="filterActive"
            class="qs-type-meta flex flex-wrap gap-x-3 gap-y-2 items-center"
          >
            <span aria-live="polite">匹配 {{ matchedAssignableCount }} 项可分配权限</span>
            <FaButton
              variant="outline"
              size="sm"
              class="min-h-9"
              :disabled="loading || matchedAssignableCount === 0"
              @click="selectVisibleResults"
            >
              选中当前结果 {{ matchedAssignableCount }} 项
            </FaButton>
            <FaButton
              variant="ghost"
              size="sm"
              class="min-h-9"
              :disabled="loading"
              @click="resetFilters"
            >
              清除条件
            </FaButton>
          </div>
        </div>

        <FaCollapsible
          v-model="selectedPanelOpen"
          class="border border-border rounded-lg overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full"
        >
          <template #trigger="{ open }">
            <span class="p-3.5 text-start flex flex-wrap gap-x-3 gap-y-1 cursor-pointer items-center justify-between hover:bg-muted/25">
              <strong>已选明细</strong>
              <span class="qs-type-meta text-muted-foreground">
                {{ selection.total === 0 ? '尚未选择权限' : `${selection.total} 项 · ${open ? '收起' : '展开'}` }}
              </span>
            </span>
          </template>
          <div class="p-3.5 border-t border-border gap-3 grid">
            <FaEmpty
              v-if="selectedGroupEntries.length === 0"
              icon="i-lucide:list-x"
              title="尚未选择权限"
              description="在下方分组中勾选权限，或用搜索与筛选快速定位；这里可以随时移除误选。"
              class="py-6"
            />
            <div
              v-for="entry in selectedGroupEntries"
              :key="entry.key"
              class="gap-2 grid"
            >
              <span class="qs-type-compact-label">{{ entry.label }}（{{ entry.permissions.length }}）</span>
              <ul class="m-0 p-0 list-none flex flex-wrap gap-2">
                <li
                  v-for="permission in entry.permissions"
                  :key="permission.id"
                  class="px-1 py-0.5 ps-2.5 border border-border rounded-full bg-muted/20 flex gap-1 items-center"
                >
                  <code class="qs-type-data">{{ permission.code }}</code>
                  <FaButton
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`定位 ${permission.code}`"
                    :disabled="loading"
                    @click="locatePermission(permission.id)"
                  >
                    <FaIcon name="i-lucide:locate" class="size-3.5" />
                  </FaButton>
                  <FaButton
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`移除 ${permission.code}`"
                    :disabled="loading"
                    @click="removePermission(permission.id)"
                  >
                    <FaIcon name="i-lucide:x" class="size-3.5" />
                  </FaButton>
                </li>
              </ul>
            </div>
          </div>
        </FaCollapsible>

        <div ref="listRef" class="gap-3 grid">
          <section
            v-for="row in groupRows"
            :key="row.group.key"
            class="p-3.5 border border-border rounded-lg bg-muted/10"
          >
            <div
              class="mb-2 p-1 rounded-lg bg-background flex flex-wrap gap-x-3 gap-y-2 items-center justify-between sticky z-5 -m-1"
              :style="{ top: `${stickyOffset - scrollPaddingTop}px` }"
            >
              <div class="flex gap-2 min-w-0 items-center">
                <FaCheckbox
                  v-if="row.summary.state !== 'unavailable'"
                  :model-value="groupCheckboxValue(row.summary.state)"
                  :aria-label="`全选${row.fullGroup.label}的可分配权限`"
                  :disabled="loading"
                  @update:model-value="toggleGroup(row.fullGroup)"
                />
                <strong class="min-w-0 [overflow-wrap:anywhere]">{{ row.fullGroup.label }}</strong>
                <FaTag
                  v-if="row.summary.systemOnly > 0"
                  variant="outline"
                  class="qs-type-status-tag"
                >
                  系统专用 {{ row.summary.systemOnly }}
                </FaTag>
              </div>
              <div class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 items-center">
                <span>
                  已选 <strong class="qs-type-data text-foreground">{{ row.summary.selected }}</strong> / 可分配 {{ row.summary.assignable }}
                </span>
                <span v-if="row.hiddenAssignable > 0" data-testid="permission-group-hidden-count">
                  本组另有 {{ row.hiddenAssignable }} 项不在当前结果
                </span>
                <FaButton
                  variant="ghost"
                  size="sm"
                  class="min-h-9"
                  :aria-label="`${row.collapsed ? '展开' : '收起'}${row.fullGroup.label}`"
                  :disabled="loading"
                  @click="toggleGroupCollapse(row.group.key)"
                >
                  {{ row.collapsed ? '展开' : '收起' }}
                </FaButton>
              </div>
            </div>

            <FaCheckboxGroup
              v-if="!row.collapsed"
              v-model="selectedIds"
              :options="groupOptions(row.group)"
              :disabled="loading"
              class="gap-2.5"
              option-class="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
            >
              <template #option="{ option, checked, disabled }">
                <div
                  :data-permission-id="option.value"
                  class="p-3 rounded-lg gap-1 grid min-w-0 w-full transition-colors -m-3"
                  :class="[
                    disabled && 'opacity-60',
                    checked && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                    highlightedPermissionId === option.value && 'ring-2 ring-primary/50',
                  ]"
                >
                  <div class="flex flex-wrap gap-2 min-w-0 items-center">
                    <!--
                      行本身已是 role="checkbox"，这里只画指示器：放进第二个复选框会在
                      label 内产生嵌套控件与重复 tab 停靠点，因此不复用 FaCheckbox。
                    -->
                    <span
                      aria-hidden="true"
                      class="border rounded-[4px] shrink-0 grid size-4 shadow-xs place-content-center"
                      :class="checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background'"
                    >
                      <FaIcon v-if="checked" name="i-lucide:check" class="size-3.5" />
                    </span>
                    <code class="min-w-0 [overflow-wrap:anywhere]">{{ option.code }}</code>
                    <FaTag v-if="option.systemOnly" variant="outline" class="qs-type-status-tag">
                      系统专用
                    </FaTag>
                  </div>
                  <span class="text-xs text-muted-foreground leading-5 ps-6 whitespace-normal">
                    {{ option.description }}
                  </span>
                </div>
              </template>
            </FaCheckboxGroup>
          </section>

          <FaEmpty
            v-if="visibleGroups.length === 0"
            icon="i-lucide:search-x"
            title="没有匹配的权限"
            :description="onlySelected ? '当前没有已选权限；关闭“只看已选”后可继续选择。' : '可调整关键词或权限范围后重试。'"
            class="py-8"
          >
            <FaButton
              variant="outline"
              size="sm"
              class="min-h-9"
              :disabled="loading"
              @click="resetFilters"
            >
              清除条件
            </FaButton>
          </FaEmpty>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="qs-type-meta text-muted-foreground md:me-auto">
        已选择 {{ selectedIds.length }} 项
      </span>
      <FaButton
        variant="outline"
        class="w-full md:w-auto"
        :disabled="loading"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        class="w-full md:w-auto"
        :loading="loading"
        :disabled="role?.isSystem"
        @click="submit"
      >
        保存权限
      </FaButton>
    </template>
  </QsGenericDrawer>

  <QsGenericModal
    v-model="clearConfirmVisible"
    title="清空已选权限？"
    :description="role === null ? '' : `将清空「${role.name}」当前的 ${selection.total} 项选择；保存后该角色不再拥有这些业务权限。`"
    size="sm"
    :submitting="false"
  >
    <FaAlert
      variant="destructive"
      icon="i-lucide:triangle-alert"
      title="清空后需要保存才会生效"
      description="清空只是当前编辑状态；点击“保存权限”后服务端才会替换该角色的完整权限集合。"
    />

    <template #footer>
      <FaButton
        variant="outline"
        class="w-full sm:w-auto"
        @click="clearConfirmVisible = false"
      >
        取消
      </FaButton>
      <FaButton
        variant="destructive"
        class="w-full sm:w-auto"
        @click="clearSelection"
      >
        清空已选
      </FaButton>
    </template>
  </QsGenericModal>
</template>
