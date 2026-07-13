<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'
import Sortable from 'sortablejs'
import apiTable from '@/api/modules/table'

const props = withDefaults(
  defineProps<{
    id?: string | number
  }>(),
  {
    id: '',
  },
)

const emits = defineEmits<{
  success: []
  cancel: []
  preview: [
    value: {
      code: string
      border: boolean
      stripe: boolean
      header: boolean
      columns: {
        name: string
        field: string
        width: string
        align: string
        sortable: boolean
        fixed: string
        enable: boolean
      }[]
    },
  ]
}>()

const form = ref({
  id: props.id,
  name: '',
  code: '',
  border: false,
  stripe: false,
  header: true,
  columns: [] as ColumnItem[],
})

const errors = ref<Record<string, string>>({})

function validate(): boolean {
  errors.value = {}
  if (!form.value.name) {
    errors.value.name = '请输入表格名称'
  }
  if (!form.value.code) {
    errors.value.code = '请输入表格唯一标识'
  }
  if (form.value.columns.length === 0) {
    errors.value.columns = '请添加列信息'
  }
  else if (form.value.columns.some(item => item.name === '')) {
    errors.value.columns = '列名称不能为空'
  }
  else if (form.value.columns.some(item => item.field === '')) {
    errors.value.columns = '列字段不能为空'
  }
  return Object.keys(errors.value).length === 0
}

interface ColumnItem {
  name: string
  field: string
  width: string
  align: string
  sortable: boolean
  fixed: string
  enable: boolean
}

const tableColumns: TableColumn<ColumnItem>[] = [
  {
    id: 'index',
    header: '',
    width: 60,
    align: 'center',
    fixed: 'left',
  },
  {
    id: 'sort',
    header: '排序',
    width: 60,
    align: 'center',
  },
  {
    accessorKey: 'name',
    header: '名称',
    minWidth: 200,
  },
  {
    accessorKey: 'field',
    header: '字段',
    width: 150,
  },
  {
    accessorKey: 'width',
    header: '宽度',
    width: 140,
    align: 'center',
  },
  {
    id: 'align',
    header: '对齐',
    width: 140,
    align: 'center',
  },
  {
    id: 'fixed',
    header: '固定',
    width: 140,
    align: 'center',
  },
  {
    id: 'sortable',
    header: '排序',
    width: 80,
    align: 'center',
  },
  {
    id: 'enable',
    header: '状态',
    width: 80,
    align: 'center',
  },
]

const columnsTableRef = ref()
const columnsTableKey = ref(0)
onMounted(() => {
  if (props.id !== '') {
    apiTable.detail(props.id).then((res) => {
      form.value.id = res.data.id
      form.value.name = res.data.name
      form.value.code = res.data.code
      form.value.border = res.data.border
      form.value.stripe = res.data.stripe
      form.value.header = res.data.header
      form.value.columns = res.data.columns
    })
  }
  onColumnDarg()
})

function onColumnAdd() {
  form.value.columns = [...form.value.columns, {
    name: '',
    field: '',
    width: '100',
    align: 'left',
    sortable: false,
    fixed: '',
    enable: true,
  }]
}
function onColumnDelete(index: number) {
  form.value.columns = form.value.columns.filter((_, i) => i !== index)
}
function onColumnDarg() {
  nextTick(() => {
    const tbody = columnsTableRef.value?.$el?.querySelector('tbody[data-slot="table-body"]')
    if (!tbody) {
      return
    }
    Sortable.create(tbody, {
      handle: '.sortable',
      animation: 300,
      ghostClass: 'ghost',
      onEnd: ({ newIndex, oldIndex }) => {
        if (newIndex === undefined || oldIndex === undefined) {
          return
        }
        const columns = [...form.value.columns]
        const [moved] = columns.splice(oldIndex, 1)
        columns.splice(newIndex, 0, moved)
        form.value.columns = columns
        columnsTableKey.value += 1
        nextTick(() => onColumnDarg())
      },
    })
  })
}

function onSubmit() {
  if (!validate()) {
    return
  }
  if (form.value.id === '') {
    apiTable.create(form.value).then(() => {
      useFaToast().success('模拟新增成功')
      emits('success')
    })
  }
  else {
    apiTable.edit(form.value).then(() => {
      useFaToast().success('模拟编辑成功')
      emits('success')
    })
  }
}
async function onPreview() {
  if (!form.value.code) {
    useFaToast().error('请先完善表格唯一标识')
    return
  }
  if (form.value.columns.length === 0 || form.value.columns.some(item => !item.name || !item.field)) {
    useFaToast().error('请先完善列信息')
    return
  }
  emits('preview', {
    code: form.value.code,
    border: form.value.border,
    stripe: form.value.stripe,
    header: form.value.header,
    columns: form.value.columns,
  })
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <div class="mb-4 gap-4 grid grid-cols-12">
      <FaLabel label="表格名称" class="flex-col col-span-3 items-start" :class="{ 'text-destructive': errors.name }">
        <FaInput v-model="form.name" placeholder="请输入中文描述标题" class="w-full" />
        <span v-if="errors.name" class="text-xs text-destructive mt-1">{{ errors.name }}</span>
      </FaLabel>
      <FaLabel label="标识" class="flex-col col-span-3 items-start" :class="{ 'text-destructive': errors.code }">
        <FaInput v-model="form.code" placeholder="请输入唯一标识" class="w-full" />
        <span v-if="errors.code" class="text-xs text-destructive mt-1">{{ errors.code }}</span>
      </FaLabel>
      <FaLabel label="边框" class="flex-col col-span-2 items-start">
        <FaSwitch v-model="form.border" />
      </FaLabel>
      <FaLabel label="斑马纹" class="flex-col col-span-2 items-start">
        <FaSwitch v-model="form.stripe" />
      </FaLabel>
      <FaLabel label="表头" class="flex-col col-span-2 items-start">
        <FaSwitch v-model="form.header" />
      </FaLabel>
    </div>
    <FaTable
      ref="columnsTableRef"
      :key="columnsTableKey"
      class="flex-1 min-h-0"
      table-root-class="border rounded-lg h-full"
      row-key="field"
      stripe
      border
      :columns="tableColumns"
      :data="form.columns"
    >
      <template #toolbar>
        <FaButton size="sm" @click="onColumnAdd">
          添加列
        </FaButton>
      </template>
      <template #cell-index="{ index }">
        <span class="index">{{ index + 1 }}</span>
        <FaButton variant="destructive" size="icon-sm" class="delete" @click="onColumnDelete(index)">
          <FaIcon name="i-ep:delete" />
        </FaButton>
      </template>
      <template #cell-sort>
        <FaButton variant="outline" size="icon-sm" class="sortable hover:cursor-ns-resize">
          <FaIcon name="i-ep:d-caret" />
        </FaButton>
      </template>
      <template #cell-name="{ row }">
        <FaInput v-model="row.original.name" class="w-full" />
      </template>
      <template #cell-field="{ row }">
        <FaInput v-model="row.original.field" class="w-full" />
      </template>
      <template #cell-width="{ row }">
        <FaNumberField :model-value="Number(row.original.width)" :min="50" :max="1000" :step="10" class="w-full" @update:model-value="row.original.width = String($event)" />
      </template>
      <template #cell-align="{ row }">
        <FaButtonGroup class="inline-flex">
          <FaButton size="sm" :variant="row.original.align === 'left' ? 'default' : 'outline'" @click="row.original.align = 'left'">
            左
          </FaButton>
          <FaButton size="sm" :variant="row.original.align === 'center' ? 'default' : 'outline'" @click="row.original.align = 'center'">
            中
          </FaButton>
          <FaButton size="sm" :variant="row.original.align === 'right' ? 'default' : 'outline'" @click="row.original.align = 'right'">
            右
          </FaButton>
        </FaButtonGroup>
      </template>
      <template #cell-fixed="{ row }">
        <FaButtonGroup class="inline-flex">
          <FaButton size="sm" :variant="row.original.fixed === 'left' ? 'default' : 'outline'" @click="row.original.fixed = 'left'">
            左
          </FaButton>
          <FaButton size="sm" :variant="row.original.fixed === '' ? 'default' : 'outline'" @click="row.original.fixed = ''">
            无
          </FaButton>
          <FaButton size="sm" :variant="row.original.fixed === 'right' ? 'default' : 'outline'" @click="row.original.fixed = 'right'">
            右
          </FaButton>
        </FaButtonGroup>
      </template>
      <template #cell-sortable="{ row }">
        <FaSwitch v-model="row.original.sortable" />
      </template>
      <template #cell-enable="{ row }">
        <FaSwitch v-model="row.original.enable" />
      </template>
    </FaTable>
    <div class="mt-2 flex gap-2">
      <FaButton @click="onSubmit">
        保存
      </FaButton>
      <FaButton variant="outline" @click="onPreview">
        预览
      </FaButton>
      <FaButton variant="outline" @click="emits('cancel')">
        取消
      </FaButton>
    </div>
  </div>
</template>

<style scoped>
:deep([data-slot="table-body"]) {
  .ghost {
    opacity: 0;
  }

  .index {
    display: inline-block;
  }

  .delete {
    display: none;
  }

  tr:hover {
    .index {
      display: none;
    }

    .delete {
      display: inline-block;
    }
  }
}
</style>
