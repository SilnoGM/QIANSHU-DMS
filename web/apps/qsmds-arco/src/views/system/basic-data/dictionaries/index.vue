<script setup lang="ts">
import type {
  DictionaryItemDto,
  DictionaryTypeDto,
} from '@/api/generated/types.gen'
import type {
  DictionaryItemListQuery,
  DictionaryTypeListQuery,
} from '@/api/modules/dictionaries'

import dictionariesApi from '@/api/modules/dictionaries'
import {
  canApplyDictionaryItemResponse,
  canApplyDictionaryQueryResponse,
  createDictionaryManagementState,
  createDictionarySelection,
  isDictionaryAbortError,
  resolveDictionaryAccessTransition,
  transitionDictionaryMutationState,
  transitionDictionaryQueryState,
} from './dictionary-management.logic'

defineOptions({ name: 'SystemBasicDataDictionaries' })

const TYPE_QUERY: DictionaryTypeListQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'sortOrder',
  sortOrder: 'asc',
}
const ITEM_QUERY: DictionaryItemListQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'sortOrder',
  sortOrder: 'asc',
}

const appAccountStore = useAppAccountStore()
const { auth } = useAppAuth()
const canRead = computed(() => auth('dictionaries:read'))

const managementState = ref(createDictionaryManagementState(canRead.value))
const dictionaryTypes = ref<DictionaryTypeDto[]>([])
const dictionaryItems = ref<DictionaryItemDto[]>([])
const typeTotal = ref(0)
const itemTotal = ref(0)
const typeError = ref('')
const itemError = ref('')
const typeDrawerOpen = ref(false)

let typeAbortController: AbortController | null = null
let itemAbortController: AbortController | null = null
let typeRequestVersion = 0
let itemRequestVersion = 0
let disposed = false

const selectedTypeId = computed(() => {
  return managementState.value.selection.kind === 'selected'
    ? managementState.value.selection.typeId
    : null
})
const selectedType = computed(() => {
  return dictionaryTypes.value.find(type => type.id === selectedTypeId.value) ?? null
})
const typeBusy = computed(() => {
  return managementState.value.typeQuery === 'loading'
    || managementState.value.typeQuery === 'refreshing'
})
const itemBusy = computed(() => {
  return managementState.value.itemQuery === 'loading'
    || managementState.value.itemQuery === 'refreshing'
})

function setTypeQuery(event: Parameters<typeof transitionDictionaryQueryState>[1]): void {
  managementState.value = {
    ...managementState.value,
    typeQuery: transitionDictionaryQueryState(
      managementState.value.typeQuery,
      event,
    ),
  }
}

function setItemQuery(event: Parameters<typeof transitionDictionaryQueryState>[1]): void {
  managementState.value = {
    ...managementState.value,
    itemQuery: transitionDictionaryQueryState(
      managementState.value.itemQuery,
      event,
    ),
  }
}

/**
 * 每种资源使用独立的 AbortController 和版本号。abort 后仍推进版本，确保即便底层
 * Promise 最终完成，旧 finally 也不能关闭新请求的 loading 或清空新 controller。
 */
function abortTypeQuery(): void {
  typeRequestVersion += 1
  typeAbortController?.abort()
  typeAbortController = null
}

function abortItemQuery(): void {
  itemRequestVersion += 1
  itemAbortController?.abort()
  itemAbortController = null
}

function abortProtectedQueries(): void {
  abortTypeQuery()
  abortItemQuery()
}

function typeResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return !disposed
    && typeAbortController === controller
    && canApplyDictionaryQueryResponse({
      aborted: controller.signal.aborted,
      authorized: canRead.value,
      authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      latestRequestVersion: typeRequestVersion,
      requestVersion,
    })
}

function itemResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  requestedTypeId: string,
  controller: AbortController,
): boolean {
  return !disposed
    && itemAbortController === controller
    && canApplyDictionaryItemResponse({
      aborted: controller.signal.aborted,
      authorized: canRead.value,
      authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      currentTypeId: selectedTypeId.value,
      latestRequestVersion: itemRequestVersion,
      requestedTypeId,
      requestVersion,
    })
}

async function loadDictionaryTypes(): Promise<void> {
  if (!canRead.value || disposed) {
    return
  }

  abortTypeQuery()
  const controller = new AbortController()
  typeAbortController = controller
  const requestVersion = typeRequestVersion
  const authEpoch = appAccountStore.authEpoch
  typeError.value = ''
  setTypeQuery({
    type: 'request',
    hasData: dictionaryTypes.value.length > 0,
  })

  try {
    const response = await dictionariesApi.types.list(TYPE_QUERY, controller.signal)
    if (!typeResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    dictionaryTypes.value = response.data.items
    typeTotal.value = response.data.total
    setTypeQuery({
      type: 'success',
      itemCount: response.data.items.length,
    })

    if (
      selectedTypeId.value !== null
      && !response.data.items.some(type => type.id === selectedTypeId.value)
    ) {
      selectDictionaryType(null)
    }
  }
  catch (error) {
    if (
      isDictionaryAbortError(error)
      || !typeResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    typeError.value = '暂时无法读取字典类型，请稍后重试。'
    setTypeQuery({ type: 'failure' })
  }
  finally {
    if (
      typeAbortController === controller
      && requestVersion === typeRequestVersion
    ) {
      typeAbortController = null
    }
  }
}

async function loadDictionaryItems(requestedTypeId: string): Promise<void> {
  if (!canRead.value || disposed || requestedTypeId !== selectedTypeId.value) {
    return
  }

  abortItemQuery()
  const controller = new AbortController()
  itemAbortController = controller
  const requestVersion = itemRequestVersion
  const authEpoch = appAccountStore.authEpoch
  itemError.value = ''
  setItemQuery({
    type: 'request',
    hasData: dictionaryItems.value.length > 0,
  })

  try {
    const response = await dictionariesApi.items.list(
      requestedTypeId,
      ITEM_QUERY,
      controller.signal,
    )
    if (!itemResponseIsCurrent(
      requestVersion,
      authEpoch,
      requestedTypeId,
      controller,
    )) {
      return
    }

    dictionaryItems.value = response.data.items
    itemTotal.value = response.data.total
    setItemQuery({
      type: 'success',
      itemCount: response.data.items.length,
    })
  }
  catch (error) {
    if (
      isDictionaryAbortError(error)
      || !itemResponseIsCurrent(
        requestVersion,
        authEpoch,
        requestedTypeId,
        controller,
      )
    ) {
      return
    }
    itemError.value = '暂时无法读取字典条目，请稍后重试。'
    setItemQuery({ type: 'failure' })
  }
  finally {
    if (
      itemAbortController === controller
      && requestVersion === itemRequestVersion
    ) {
      itemAbortController = null
    }
  }
}

/** Type 选择只写页面本地状态；先作废旧 Item，再建立新选择的请求归属。 */
function selectDictionaryType(typeId: string | null): void {
  abortItemQuery()
  dictionaryItems.value = []
  itemTotal.value = 0
  itemError.value = ''
  managementState.value = {
    ...managementState.value,
    itemQuery: 'idle',
    mutation: 'closed',
    selection: createDictionarySelection(typeId),
  }
  typeDrawerOpen.value = false

  if (typeId !== null) {
    void loadDictionaryItems(typeId)
  }
}

function clearProtectedData(): void {
  dictionaryTypes.value = []
  dictionaryItems.value = []
  typeTotal.value = 0
  itemTotal.value = 0
  typeError.value = ''
  itemError.value = ''
  managementState.value = {
    ...managementState.value,
    itemQuery: 'idle',
    selection: createDictionarySelection(null),
    typeQuery: 'idle',
  }
}

function closeProtectedOverlays(): void {
  typeDrawerOpen.value = false
  managementState.value = {
    ...managementState.value,
    mutation: transitionDictionaryMutationState(
      managementState.value.mutation,
      'authority-loss',
    ),
  }
}

function applyAccessBoundary(
  authorized: boolean,
  identityChanged: boolean,
): void {
  const transition = resolveDictionaryAccessTransition({
    authorized,
    identityChanged,
    previousState: managementState.value,
  })
  if (transition.shouldAbortQueries) {
    abortProtectedQueries()
  }
  if (transition.shouldClearProtectedData) {
    clearProtectedData()
  }
  if (transition.shouldCloseOverlays) {
    closeProtectedOverlays()
  }
  managementState.value = transition.nextState

  if (transition.shouldReload) {
    void loadDictionaryTypes()
  }
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([authEpoch, authorized], [previousAuthEpoch]) => {
    applyAccessBoundary(authorized, authEpoch !== previousAuthEpoch)
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadDictionaryTypes()
  }
})

onBeforeUnmount(() => {
  disposed = true
  abortProtectedQueries()
  clearProtectedData()
  closeProtectedOverlays()
})
</script>

<template>
  <div class="dictionary-management-page min-w-0">
    <FaPageHeader
      title="字典管理"
      description="维护全局、平铺且低风险的业务选项；类型码与条目值作为稳定身份，不随展示名称变化。"
    />

    <FaPageMain>
      <FaEmpty
        v-if="managementState.access === 'forbidden'"
        icon="i-lucide:shield-alert"
        title="无权查看字典"
        description="当前身份缺少 dictionaries:read 权限。"
        class="min-h-64"
      />

      <div
        v-else
        class="gap-5 grid min-w-0 md:grid-cols-[18rem_minmax(0,1fr)]"
        data-testid="dictionary-management-workspace"
      >
        <aside
          class="min-w-0 hidden md:pr-5 md:border-r md:border-border md:block"
          aria-labelledby="dictionary-type-list-title"
          data-testid="dictionary-type-panel"
        >
          <div class="mb-4 flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <p class="qs-type-meta m-0">
                配置目录
              </p>
              <h2 id="dictionary-type-list-title" class="qs-type-compact-title mb-0 mt-1">
                字典类型
              </h2>
            </div>
            <span class="qs-type-meta tabular-nums">{{ typeTotal }} 项</span>
          </div>

          <div
            v-if="typeBusy && dictionaryTypes.length === 0"
            class="text-muted-foreground flex gap-2 min-h-40 items-center justify-center"
            role="status"
            aria-busy="true"
          >
            <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
            <span>正在读取类型…</span>
          </div>

          <FaAlert
            v-else-if="managementState.typeQuery === 'error'"
            variant="destructive"
            icon="i-lucide:circle-alert"
            title="字典类型读取失败"
            :description="typeError"
            role="alert"
          >
            <template #action>
              <FaButton variant="outline" class="min-h-11" @click="loadDictionaryTypes">
                重试
              </FaButton>
            </template>
          </FaAlert>

          <FaEmpty
            v-else-if="managementState.typeQuery === 'empty'"
            icon="i-lucide:book-dashed"
            title="暂无字典类型"
            description="当前系统尚未配置业务字典。"
            class="min-h-40"
          />

          <ul v-else class="m-0 p-0 list-none gap-2 grid" aria-label="字典类型">
            <li
              v-for="type in dictionaryTypes"
              :key="type.id"
            >
              <button
                type="button"
                class="p-3 text-left border border-border rounded-lg bg-background min-h-11 w-full transition-colors focus-visible:outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary/50"
                :class="selectedTypeId === type.id ? 'border-primary bg-primary/5' : ''"
                :aria-current="selectedTypeId === type.id ? 'true' : undefined"
                @click="selectDictionaryType(type.id)"
              >
                <span class="qs-type-compact-title block break-words">{{ type.name }}</span>
                <code class="qs-type-data mt-1 block break-all">{{ type.code }}</code>
                <span class="qs-type-meta mt-2 block">
                  {{ type.enabled ? '已启用' : '已停用' }} · {{ type.itemCount }} 个条目
                </span>
              </button>
            </li>
          </ul>
        </aside>

        <section class="min-w-0" aria-labelledby="dictionary-item-panel-title">
          <div class="mb-4 flex flex-wrap gap-3 items-start justify-between">
            <div class="min-w-0">
              <p class="qs-type-meta m-0">
                当前类型
              </p>
              <h2 id="dictionary-item-panel-title" class="qs-type-compact-title mb-0 mt-1 break-words">
                {{ selectedType?.name ?? '字典条目' }}
              </h2>
              <code v-if="selectedType" class="qs-type-data mt-1 block break-all">
                {{ selectedType.code }}
              </code>
            </div>

            <FaButton
              variant="outline"
              class="min-h-11 md:hidden"
              data-testid="dictionary-open-type-drawer"
              @click="typeDrawerOpen = true"
            >
              <FaIcon name="i-lucide:list-filter" />
              选择类型
            </FaButton>
          </div>

          <FaEmpty
            v-if="managementState.selection.kind === 'none'"
            icon="i-lucide:mouse-pointer-click"
            title="请选择字典类型"
            description="从类型目录中选择一项后查看其条目。"
            class="border border-border rounded-lg bg-muted/10 min-h-64"
          />

          <div
            v-else-if="itemBusy && dictionaryItems.length === 0"
            class="text-muted-foreground border border-border rounded-lg flex gap-2 min-h-64 items-center justify-center"
            role="status"
            aria-busy="true"
          >
            <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
            <span>正在读取条目…</span>
          </div>

          <FaAlert
            v-else-if="managementState.itemQuery === 'error'"
            variant="destructive"
            icon="i-lucide:circle-alert"
            title="字典条目读取失败"
            :description="itemError"
            role="alert"
          >
            <template #action>
              <FaButton
                v-if="selectedTypeId"
                variant="outline"
                class="min-h-11"
                @click="loadDictionaryItems(selectedTypeId)"
              >
                重试
              </FaButton>
            </template>
          </FaAlert>

          <FaEmpty
            v-else-if="managementState.itemQuery === 'empty'"
            icon="i-lucide:list-x"
            title="该类型暂无条目"
            description="该字典类型尚未配置任何条目。"
            class="border border-border rounded-lg bg-muted/10 min-h-64"
          />

          <div v-else class="gap-3 grid" aria-live="polite">
            <div class="p-4 border border-border rounded-lg bg-muted/10 flex flex-wrap gap-3 items-center justify-between">
              <p class="qs-type-meta m-0">
                当前读取 {{ dictionaryItems.length }} 项，共 {{ itemTotal }} 项
              </p>
              <span class="qs-type-meta">条目概览</span>
            </div>
            <ul class="m-0 p-0 list-none gap-2 grid" aria-label="字典条目">
              <li
                v-for="item in dictionaryItems"
                :key="item.id"
                class="p-3 border border-border rounded-lg bg-background flex flex-wrap gap-3 items-start justify-between"
              >
                <span class="min-w-0">
                  <strong class="qs-type-compact-title block break-words">{{ item.label }}</strong>
                  <code class="qs-type-data mt-1 block break-all">{{ item.value }}</code>
                </span>
                <span class="qs-type-meta">
                  {{ item.effectiveEnabled ? '有效' : item.enabled ? '随类型停用' : '已停用' }}
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </FaPageMain>

    <QsGenericDrawer
      v-if="managementState.access === 'active'"
      v-model="typeDrawerOpen"
      title="选择字典类型"
      description="选择只保存在当前页面，不改变地址。"
      placement="bottom"
      size="lg"
    >
      <div class="pb-[max(0.75rem,env(safe-area-inset-bottom))] gap-2 grid">
        <div
          v-if="typeBusy && dictionaryTypes.length === 0"
          class="text-muted-foreground flex gap-2 min-h-40 items-center justify-center"
          role="status"
          aria-busy="true"
        >
          <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
          <span>正在读取类型…</span>
        </div>
        <FaAlert
          v-else-if="managementState.typeQuery === 'error'"
          variant="destructive"
          icon="i-lucide:circle-alert"
          title="字典类型读取失败"
          :description="typeError"
          role="alert"
        >
          <template #action>
            <FaButton variant="outline" class="min-h-11" @click="loadDictionaryTypes">
              重试
            </FaButton>
          </template>
        </FaAlert>
        <FaEmpty
          v-else-if="managementState.typeQuery === 'empty'"
          icon="i-lucide:book-dashed"
          title="暂无字典类型"
          description="当前系统尚未配置业务字典。"
          class="min-h-40"
        />
        <template v-else>
          <button
            v-for="type in dictionaryTypes"
            :key="type.id"
            type="button"
            class="p-3 text-left border border-border rounded-lg bg-background min-h-11"
            :class="selectedTypeId === type.id ? 'border-primary bg-primary/5' : ''"
            @click="selectDictionaryType(type.id)"
          >
            <span class="qs-type-compact-title block break-words">{{ type.name }}</span>
            <code class="qs-type-data mt-1 block break-all">{{ type.code }}</code>
          </button>
        </template>
      </div>
    </QsGenericDrawer>
  </div>
</template>
