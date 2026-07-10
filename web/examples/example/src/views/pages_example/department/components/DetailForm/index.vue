<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import { ref } from 'vue'
import apiDepartment from '@/api/modules/department'

export interface Props {
  id?: number | string
}
const props = withDefaults(
  defineProps<Props>(),
  {
    id: '',
  },
)

const loading = ref(false)
const formRef = useTemplateRef<FormExpose>('formRef')

interface DetailFormModel {
  id: number | string
  title: string
}

const model = ref<DetailFormModel>({
  id: props.id,
  title: '',
})

const validationSchema = {
  title(value: string) {
    return value.trim() ? true : '请输入部门名称'
  },
}

onMounted(() => {
  if (model.value.id !== '') {
    getInfo()
  }
})

function getInfo() {
  loading.value = true
  apiDepartment.detail(model.value.id).then((res: any) => {
    loading.value = false
    model.value.title = res.data.title
  }).catch(() => {
    loading.value = false
  })
}

async function submit() {
  const result = await formRef.value?.validate()

  if (!result?.valid) {
    return false
  }

  if (model.value.id === '') {
    await apiDepartment.create(model.value)
    useFaToast().success('模拟新增成功')
  }
  else {
    await apiDepartment.edit(model.value)
    useFaToast().success('模拟编辑成功')
  }

  return true
}

defineExpose({
  submit,
})
</script>

<template>
  <div v-loading="loading">
    <FaForm
      ref="formRef"
      :model="model"
      :validation-schema="validationSchema"
      label-placement="right"
      :label-width="120"
    >
      <FaFormItem name="title" label="部门" required>
        <FaInput placeholder="请输入部门名称" class="w-full" />
      </FaFormItem>
    </FaForm>
  </div>
</template>
