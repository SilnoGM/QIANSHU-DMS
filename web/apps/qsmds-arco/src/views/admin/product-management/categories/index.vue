<script setup lang="ts">
import type { ProductTaxonomyCategoryListItemDto, ProductTaxonomyHeadListItemDto } from '@/api/generated/types.gen'

import productTaxonomiesApi from '@/api/modules/product-taxonomies'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'AdminProductCategories' })

type CategoryModalMode = 'create' | 'rename'
type HeadModalMode = 'create' | 'rename'
type DeleteTarget
  = | {
    readonly kind: 'category'
    readonly id: string
    readonly name: string
    readonly productCount: number
    readonly headCount: number
  }
  | {
    readonly kind: 'head'
    readonly id: string
    readonly name: string
    readonly productCount: number
  }

interface ApiFailure {
  readonly code: string | undefined
  readonly message: string
  readonly requestId: string | undefined
}

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()

const canRead = computed(() => auth('product-categories:read'))
const canCreate = computed(() => auth('product-categories:create'))
const canUpdate = computed(() => auth('product-categories:update'))
const canDelete = computed(() => auth('product-categories:delete'))

const supplierValue = ref<string | null>(null)
const categories = shallowRef<readonly ProductTaxonomyCategoryListItemDto[]>([])
const selectedCategoryId = ref<string | null>(null)
const loading = ref(false)
const loadError = ref('')
const loadRequestId = ref<string>()
let loadAbortController: AbortController | null = null

const categoryModalVisible = ref(false)
const categoryModalMode = ref<CategoryModalMode>('create')
const categoryNameDraft = ref('')
const categoryModalError = ref('')
const categoryModalRequestId = ref<string>()
const categorySubmitting = ref(false)
let categoryAbortController: AbortController | null = null

const headModalVisible = ref(false)
const headModalMode = ref<HeadModalMode>('create')
const editingHead = shallowRef<ProductTaxonomyHeadListItemDto | null>(null)
const headNameDraft = ref('')
const headModalError = ref('')
const headModalRequestId = ref<string>()
const headSubmitting = ref(false)
let headAbortController: AbortController | null = null

const deleteTarget = shallowRef<DeleteTarget | null>(null)
const deleteModalVisible = ref(false)
const deleteError = ref('')
const deleteRequestId = ref<string>()
const deleting = ref(false)
let deleteAbortController: AbortController | null = null

const selectedCategory = computed(() => (
  categories.value.find(category => category.id === selectedCategoryId.value)
  ?? null
))
const categoryCount = computed(() => categories.value.length)
const headCount = computed(() => selectedCategory.value?.productHeads.length ?? 0)
const categoryModalTitle = computed(() => (
  categoryModalMode.value === 'create' ? '新建分类' : '重命名分类'
))
const headModalTitle = computed(() => (
  headModalMode.value === 'create' ? '新建产品头' : '重命名产品头'
))
const deleteModalTitle = computed(() => {
  const target = deleteTarget.value
  if (target === null) {
    return '删除条目'
  }
  return target.kind === 'category' ? '删除分类' : '删除产品头'
})
const deleteModalDescription = computed(() => {
  const target = deleteTarget.value
  if (target === null) {
    return ''
  }
  if (target.kind === 'category') {
    return target.headCount > 0
      ? `分类“${target.name}”下还有 ${target.headCount} 个空产品头；删除分类会同时删除这些产品头。`
      : `确认删除空分类“${target.name}”？`
  }
  return `确认删除空产品头“${target.name}”？`
})
const deleteBlocked = computed(() => (
  deleteTarget.value !== null && deleteTarget.value.productCount > 0
))
const deleteBlockedDescription = computed(() => {
  const target = deleteTarget.value
  if (target === null || target.productCount === 0) {
    return ''
  }
  return `仍有 ${target.productCount} 个产品引用该条目，必须先在产品编辑中改到其他条目后才能删除。`
})

function getApiFailure(error: unknown): ApiFailure {
  const fallback: ApiFailure = {
    code: undefined,
    message: '请求失败，请稍后重试',
    requestId: undefined,
  }
  if (typeof error !== 'object' || error === null) {
    return fallback
  }
  const body = 'body' in error && typeof error.body === 'object' && error.body !== null
    ? error.body as Record<string, unknown>
    : undefined
  return {
    code: typeof body?.code === 'string' ? body.code : undefined,
    message: typeof body?.message === 'string'
      ? body.message
      : 'message' in error && typeof error.message === 'string'
        ? error.message
        : fallback.message,
    requestId: typeof body?.requestId === 'string'
      ? body.requestId
      : 'requestId' in error && typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
  }
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (
      typeof error === 'object'
      && error !== null
      && (
        ('code' in error && error.code === 'ERR_CANCELED')
        || ('name' in error && error.name === 'CanceledError')
      )
    )
}

function closeLoadError(): void {
  loadError.value = ''
  loadRequestId.value = undefined
}

async function loadCategories(): Promise<void> {
  const supplier = supplierValue.value
  loadAbortController?.abort()
  loadAbortController = null
  if (!canRead.value || supplier === null) {
    categories.value = []
    selectedCategoryId.value = null
    loading.value = false
    closeLoadError()
    return
  }
  const controller = new AbortController()
  loadAbortController = controller
  loading.value = true
  closeLoadError()
  try {
    const response = await productTaxonomiesApi.listCategories(
      { supplierValue: supplier },
      controller.signal,
    )
    if (controller.signal.aborted) {
      return
    }
    categories.value = response.data.items
    if (
      selectedCategoryId.value === null
      || !response.data.items.some(item => item.id === selectedCategoryId.value)
    ) {
      selectedCategoryId.value = response.data.items[0]?.id ?? null
    }
  }
  catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      return
    }
    const failure = getApiFailure(error)
    categories.value = []
    selectedCategoryId.value = null
    loadError.value = failure.message
    loadRequestId.value = failure.requestId
  }
  finally {
    if (loadAbortController === controller) {
      loadAbortController = null
      loading.value = false
    }
  }
}

function handleSupplierChange(value: string | null): void {
  if (value === supplierValue.value) {
    return
  }
  supplierValue.value = value
  selectedCategoryId.value = null
  categories.value = []
  closeLoadError()
  void loadCategories()
}

function selectCategory(categoryId: string): void {
  selectedCategoryId.value = categoryId
}

function openCreateCategory(): void {
  if (!canCreate.value || supplierValue.value === null) {
    return
  }
  categoryModalMode.value = 'create'
  categoryNameDraft.value = ''
  categoryModalError.value = ''
  categoryModalRequestId.value = undefined
  categoryModalVisible.value = true
}

function openRenameCategory(): void {
  if (!canUpdate.value || selectedCategory.value === null) {
    return
  }
  categoryModalMode.value = 'rename'
  categoryNameDraft.value = selectedCategory.value.name
  categoryModalError.value = ''
  categoryModalRequestId.value = undefined
  categoryModalVisible.value = true
}

function closeCategoryModal(): void {
  if (categorySubmitting.value) {
    return
  }
  categoryAbortController?.abort()
  categoryAbortController = null
  categoryModalVisible.value = false
  categoryModalError.value = ''
  categoryModalRequestId.value = undefined
}

async function submitCategory(): Promise<void> {
  const supplier = supplierValue.value
  const name = categoryNameDraft.value.trim().normalize('NFC')
  if (supplier === null || name === '' || categorySubmitting.value) {
    if (name === '') {
      categoryModalError.value = '请输入分类名称'
    }
    return
  }
  categoryAbortController?.abort()
  const controller = new AbortController()
  categoryAbortController = controller
  categorySubmitting.value = true
  categoryModalError.value = ''
  categoryModalRequestId.value = undefined
  let success = false
  try {
    if (categoryModalMode.value === 'create') {
      const response = await productTaxonomiesApi.createCategory(
        { supplierValue: supplier, name },
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }
      selectedCategoryId.value = response.data.id
      toast.success(`分类“${response.data.name}”已创建`)
    }
    else {
      const category = selectedCategory.value
      if (category === null) {
        return
      }
      const response = await productTaxonomiesApi.renameCategory(
        category.id,
        { name },
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }
      selectedCategoryId.value = response.data.id
      toast.success(`分类已重命名为“${response.data.name}”`)
    }
    success = true
  }
  catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      return
    }
    const failure = getApiFailure(error)
    categoryModalError.value = failure.message
    categoryModalRequestId.value = failure.requestId
  }
  finally {
    if (categoryAbortController === controller) {
      categoryAbortController = null
      categorySubmitting.value = false
    }
  }
  if (success) {
    // 等 submitting 释放后的下一帧再关闭，避免 QsGenericModal 的提交期守卫回写 true。
    await nextTick()
    closeCategoryModal()
    await loadCategories()
  }
}

function openCreateHead(): void {
  if (!canCreate.value || selectedCategory.value === null) {
    return
  }
  headModalMode.value = 'create'
  headNameDraft.value = ''
  headModalError.value = ''
  headModalRequestId.value = undefined
  headModalVisible.value = true
}

function openRenameHead(head: ProductTaxonomyHeadListItemDto): void {
  if (!canUpdate.value) {
    return
  }
  headModalMode.value = 'rename'
  headNameDraft.value = head.name
  headModalError.value = ''
  headModalRequestId.value = undefined
  headModalVisible.value = true
  editingHead.value = head
}

function closeHeadModal(): void {
  if (headSubmitting.value) {
    return
  }
  headAbortController?.abort()
  headAbortController = null
  headModalVisible.value = false
  headModalError.value = ''
  headModalRequestId.value = undefined
  editingHead.value = null
}

async function submitHead(): Promise<void> {
  const category = selectedCategory.value
  const name = headNameDraft.value.trim().normalize('NFC')
  if (category === null || name === '' || headSubmitting.value) {
    if (name === '') {
      headModalError.value = '请输入产品头名称'
    }
    return
  }
  headAbortController?.abort()
  const controller = new AbortController()
  headAbortController = controller
  headSubmitting.value = true
  headModalError.value = ''
  headModalRequestId.value = undefined
  let success = false
  try {
    if (headModalMode.value === 'create') {
      const response = await productTaxonomiesApi.createHead(
        { categoryId: category.id, name },
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }
      toast.success(`产品头“${response.data.name}”已创建`)
    }
    else {
      const head = editingHead.value
      if (head === null) {
        return
      }
      const response = await productTaxonomiesApi.renameHead(
        head.id,
        { name },
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }
      toast.success(`产品头已重命名为“${response.data.name}”`)
    }
    success = true
  }
  catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      return
    }
    const failure = getApiFailure(error)
    headModalError.value = failure.message
    headModalRequestId.value = failure.requestId
  }
  finally {
    if (headAbortController === controller) {
      headAbortController = null
      headSubmitting.value = false
    }
  }
  if (success) {
    await nextTick()
    closeHeadModal()
    await loadCategories()
  }
}

function requestDeleteCategory(): void {
  const category = selectedCategory.value
  if (!canDelete.value || category === null) {
    return
  }
  deleteTarget.value = {
    headCount: category.productHeads.length,
    id: category.id,
    kind: 'category',
    name: category.name,
    productCount: category.productCount,
  }
  deleteModalVisible.value = true
  deleteError.value = ''
  deleteRequestId.value = undefined
}

function requestDeleteHead(head: ProductTaxonomyHeadListItemDto): void {
  if (!canDelete.value) {
    return
  }
  deleteTarget.value = {
    id: head.id,
    kind: 'head',
    name: head.name,
    productCount: head.productCount,
  }
  deleteModalVisible.value = true
  deleteError.value = ''
  deleteRequestId.value = undefined
}

function closeDeleteModal(): void {
  if (deleting.value) {
    return
  }
  deleteAbortController?.abort()
  deleteAbortController = null
  deleteModalVisible.value = false
  deleteTarget.value = null
  deleteError.value = ''
  deleteRequestId.value = undefined
}

async function submitDelete(): Promise<void> {
  const target = deleteTarget.value
  if (target === null || deleteBlocked.value || deleting.value) {
    return
  }
  deleteAbortController?.abort()
  const controller = new AbortController()
  deleteAbortController = controller
  deleting.value = true
  deleteError.value = ''
  deleteRequestId.value = undefined
  let success = false
  try {
    if (target.kind === 'category') {
      await productTaxonomiesApi.deleteCategory(target.id, controller.signal)
      selectedCategoryId.value = null
    }
    else {
      await productTaxonomiesApi.deleteHead(target.id, controller.signal)
    }
    if (controller.signal.aborted) {
      return
    }
    toast.success(`“${target.name}”已删除`)
    success = true
  }
  catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      return
    }
    const failure = getApiFailure(error)
    deleteError.value = failure.message
    deleteRequestId.value = failure.requestId
  }
  finally {
    if (deleteAbortController === controller) {
      deleteAbortController = null
      deleting.value = false
    }
  }
  if (success) {
    await nextTick()
    closeDeleteModal()
    await loadCategories()
  }
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  () => {
    if (!canRead.value) {
      loadAbortController?.abort()
      categories.value = []
      selectedCategoryId.value = null
      loading.value = false
      return
    }
    void loadCategories()
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadCategories()
  }
})

onBeforeUnmount(() => {
  loadAbortController?.abort()
  categoryAbortController?.abort()
  headAbortController?.abort()
  deleteAbortController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      title="产品分类"
      description="按供应商维护分类与产品头；唯一性按所属供应商/分类收敛，不同作用域允许同名。"
    />

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权查看产品分类"
        description="当前身份缺少 product-categories:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0">
      <div class="mb-4 p-4 border border-border rounded-xl bg-muted/20 gap-3 grid sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] sm:items-end">
        <div class="gap-2 grid">
          <span class="text-sm font-medium">供应商</span>
          <QsDictionarySelect
            :model-value="supplierValue"
            dictionary-code="service_provider.supplier"
            placeholder="请选择供应商"
            @update:model-value="handleSupplierChange"
          />
        </div>
        <p class="text-xs text-muted-foreground m-0 sm:pb-2">
          先选择供应商，再维护其分类与产品头。空分类/产品头会保留并显示 0 项。
        </p>
      </div>

      <FaAlert
        v-if="loadError"
        title="产品分类加载失败"
        variant="destructive"
        role="alert"
        class="mb-4"
      >
        <template #description>
          <p class="m-0">
            {{ loadError }}
          </p>
          <code v-if="loadRequestId" class="text-xs font-mono mt-2 block break-all">
            requestId: {{ loadRequestId }}
          </code>
          <FaButton type="button" variant="outline" class="mt-3 min-h-11 sm:min-h-9" @click="loadCategories">
            重新加载
          </FaButton>
        </template>
      </FaAlert>

      <div v-if="supplierValue === null" class="py-16">
        <FaEmpty
          icon="i-lucide:store"
          title="请选择供应商"
          description="产品分类按供应商隔离，选择后才能查看和编辑。"
        />
      </div>

      <div v-else-if="loading" class="text-sm text-muted-foreground py-16 text-center" role="status">
        正在加载产品分类…
      </div>

      <div v-else class="gap-4 grid xl:grid-cols-[20rem_minmax(0,1fr)]">
        <section class="border border-border rounded-xl bg-background flex flex-col min-h-0 overflow-hidden" aria-label="分类列表">
          <div class="px-4 py-3 border-b border-border flex gap-2 items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold m-0">
                分类
              </h2>
              <p class="text-xs text-muted-foreground m-0 mt-0.5">
                {{ categoryCount }} 个分类
              </p>
            </div>
            <FaButton
              v-if="canCreate"
              type="button"
              size="sm"
              class="min-h-9"
              @click="openCreateCategory"
            >
              <FaIcon name="i-lucide:plus" aria-hidden="true" />
              新建分类
            </FaButton>
          </div>
          <div class="p-2 flex flex-col gap-1 max-h-[60vh] min-h-0 overflow-y-auto">
            <FaEmpty
              v-if="categories.length === 0"
              icon="i-lucide:folder-tree"
              title="暂无分类"
              description="当前供应商下还没有分类。"
              class="py-10"
            />
            <div
              v-for="category in categories"
              :key="category.id"
              class="rounded-lg flex gap-1 transition-colors items-center"
              :class="category.id === selectedCategoryId
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted/40'"
            >
              <button
                type="button"
                class="text-sm px-3 py-2 text-left flex flex-1 gap-2 min-w-0 items-center"
                :aria-pressed="category.id === selectedCategoryId"
                @click="selectCategory(category.id)"
              >
                <span class="flex-1 min-w-0 truncate">{{ category.name }}</span>
                <span class="text-[11px] text-muted-foreground tabular-nums">{{ category.productCount }}</span>
              </button>
              <FaButton
                v-if="canUpdate"
                type="button"
                variant="ghost"
                size="icon"
                class="shrink-0 size-8"
                :aria-label="`重命名分类 ${category.name}`"
                @click.stop="selectedCategoryId = category.id; openRenameCategory()"
              >
                <FaIcon name="i-lucide:pencil" class="size-4" aria-hidden="true" />
              </FaButton>
              <FaButton
                v-if="canDelete"
                type="button"
                variant="ghost"
                size="icon"
                class="text-destructive shrink-0 size-8"
                :aria-label="`删除分类 ${category.name}`"
                @click.stop="selectedCategoryId = category.id; requestDeleteCategory()"
              >
                <FaIcon name="i-lucide:trash-2" class="size-4" aria-hidden="true" />
              </FaButton>
            </div>
          </div>
        </section>

        <section class="border border-border rounded-xl bg-background flex flex-col min-h-0 overflow-hidden" aria-label="产品头列表">
          <div class="px-4 py-3 border-b border-border flex gap-2 items-center justify-between">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold m-0 truncate">
                {{ selectedCategory?.name ?? '产品头' }}
              </h2>
              <p class="text-xs text-muted-foreground m-0 mt-0.5">
                {{ selectedCategory === null ? '请选择左侧分类' : `${headCount} 个产品头` }}
              </p>
            </div>
            <FaButton
              v-if="canCreate && selectedCategory"
              type="button"
              size="sm"
              class="min-h-9"
              @click="openCreateHead"
            >
              <FaIcon name="i-lucide:plus" aria-hidden="true" />
              新建产品头
            </FaButton>
          </div>

          <div class="p-3">
            <FaEmpty
              v-if="selectedCategory === null"
              icon="i-lucide:folder-open"
              title="未选择分类"
              description="从左侧选择一个分类查看其产品头。"
              class="py-10"
            />
            <FaEmpty
              v-else-if="selectedCategory.productHeads.length === 0"
              icon="i-lucide:list-tree"
              title="暂无产品头"
              description="当前分类下还没有产品头。"
              class="py-10"
            />
            <div v-else class="gap-2 grid">
              <div
                v-for="head in selectedCategory.productHeads"
                :key="head.id"
                class="px-3 py-2 border border-border rounded-lg flex gap-2 items-center"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium m-0 truncate">
                    {{ head.name }}
                  </p>
                  <p class="text-xs text-muted-foreground m-0 mt-0.5">
                    {{ head.productCount }} 个产品
                  </p>
                </div>
                <FaButton
                  v-if="canUpdate"
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="shrink-0 size-8"
                  :aria-label="`重命名产品头 ${head.name}`"
                  @click="openRenameHead(head)"
                >
                  <FaIcon name="i-lucide:pencil" class="size-4" aria-hidden="true" />
                </FaButton>
                <FaButton
                  v-if="canDelete"
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="text-destructive shrink-0 size-8"
                  :aria-label="`删除产品头 ${head.name}`"
                  @click="requestDeleteHead(head)"
                >
                  <FaIcon name="i-lucide:trash-2" class="size-4" aria-hidden="true" />
                </FaButton>
              </div>
            </div>
          </div>
        </section>
      </div>
    </FaPageMain>

    <QsGenericModal
      v-if="categoryModalVisible"
      :model-value="categoryModalVisible"
      :title="categoryModalTitle"
      :submitting="categorySubmitting"
      size="sm"
      @update:model-value="value => { if (!value) closeCategoryModal() }"
    >
      <FaForm :model="{ categoryName: categoryNameDraft }" class="gap-3 grid" @submit="submitCategory">
        <FaFormItem name="categoryName" label="分类名称" required>
          <FaInput
            v-model="categoryNameDraft"
            :disabled="categorySubmitting"
            maxlength="64"
            placeholder="请输入分类名称"
            @keydown.enter.prevent="submitCategory"
          />
        </FaFormItem>
      </FaForm>
      <FaAlert
        v-if="categoryModalError"
        title="保存失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            {{ categoryModalError }}
          </p>
          <code v-if="categoryModalRequestId" class="text-xs font-mono mt-2 block break-all">
            requestId: {{ categoryModalRequestId }}
          </code>
        </template>
      </FaAlert>
      <template #footer>
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="categorySubmitting" @click="closeCategoryModal">
          取消
        </FaButton>
        <FaButton type="button" class="min-h-11 sm:min-h-9" :loading="categorySubmitting" @click="submitCategory">
          保存
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      v-if="headModalVisible"
      :model-value="headModalVisible"
      :title="headModalTitle"
      :submitting="headSubmitting"
      size="sm"
      @update:model-value="value => { if (!value) closeHeadModal() }"
    >
      <FaForm :model="{ productHeadName: headNameDraft }" class="gap-3 grid" @submit="submitHead">
        <FaFormItem name="productHeadName" label="产品头名称" required>
          <FaInput
            v-model="headNameDraft"
            :disabled="headSubmitting"
            maxlength="64"
            placeholder="请输入产品头名称"
            @keydown.enter.prevent="submitHead"
          />
        </FaFormItem>
      </FaForm>
      <FaAlert
        v-if="headModalError"
        title="保存失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            {{ headModalError }}
          </p>
          <code v-if="headModalRequestId" class="text-xs font-mono mt-2 block break-all">
            requestId: {{ headModalRequestId }}
          </code>
        </template>
      </FaAlert>
      <template #footer>
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="headSubmitting" @click="closeHeadModal">
          取消
        </FaButton>
        <FaButton type="button" class="min-h-11 sm:min-h-9" :loading="headSubmitting" @click="submitHead">
          保存
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      v-if="deleteModalVisible"
      :model-value="deleteModalVisible"
      :title="deleteModalTitle"
      :description="deleteModalDescription"
      :submitting="deleting"
      size="sm"
      @update:model-value="value => { if (!value) closeDeleteModal() }"
    >
      <FaAlert
        v-if="deleteBlocked"
        title="不能删除"
        :description="deleteBlockedDescription"
        variant="destructive"
        role="alert"
      />
      <FaAlert
        v-if="deleteError"
        title="删除失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            {{ deleteError }}
          </p>
          <code v-if="deleteRequestId" class="text-xs font-mono mt-2 block break-all">
            requestId: {{ deleteRequestId }}
          </code>
        </template>
      </FaAlert>
      <template #footer>
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="deleting" @click="closeDeleteModal">
          取消
        </FaButton>
        <FaButton
          type="button"
          variant="destructive"
          class="min-h-11 sm:min-h-9"
          :disabled="deleteBlocked"
          :loading="deleting"
          @click="submitDelete"
        >
          确认删除
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
