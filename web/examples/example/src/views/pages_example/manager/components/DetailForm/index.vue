<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import { ref } from 'vue'
import apiManager from '@/api/modules/manager'
import apiRole from '@/api/modules/role'

export interface Props {
  id?: number | string
}
const props = withDefaults(
  defineProps<Props>(),
  {
    id: '',
  },
)

interface ManagerFormModel {
  id: number | string
  account: string
  name: string
  mobile: string
  sex: string
  role_id: string
}

const roleList = ref<any>([])
apiRole.allList().then((res) => {
  roleList.value = res.data.list
})

const loading = ref(false)
const formRef = useTemplateRef<FormExpose>('formRef')
const model = ref<ManagerFormModel>({
  id: props.id,
  account: '',
  name: '',
  mobile: '',
  sex: '2',
  role_id: '',
})

const validationSchema = {
  account(value: string) {
    return value ? true : '请输入帐号'
  },
  name(value: string) {
    return value ? true : '请输入姓名'
  },
  async mobile(value: string) {
    if (!value) {
      return '请输入手机号'
    }

    const params: Parameters<typeof apiManager.check>[0] = {
      key: 'mobile',
      value,
    }
    if (model.value.id !== '') {
      params.id = Number(model.value.id)
    }

    const res = await apiManager.check(params) as any
    return res.data.exist ? '手机号已存在' : true
  },
}

onMounted(() => {
  if (model.value.id !== '') {
    getInfo()
  }
})

function getInfo() {
  loading.value = true
  apiManager.detail(model.value.id).then((res: any) => {
    loading.value = false
    model.value.account = res.data.account
    model.value.name = res.data.name
    model.value.mobile = res.data.mobile
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
    await apiManager.create(model.value)
    useFaToast().success('模拟新增成功')
  }
  else {
    await apiManager.edit(model.value)
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
      <FaFormItem name="account" label="帐号" required>
        <FaInput placeholder="请输入帐号" class="w-full" />
      </FaFormItem>
      <FaFormItem name="name" label="姓名" required>
        <FaInput placeholder="请输入姓名" class="w-full" />
      </FaFormItem>
      <FaFormItem name="mobile" label="手机号" required>
        <FaInput placeholder="请输入手机号" class="w-full" />
      </FaFormItem>
      <FaFormItem name="sex" label="性别">
        <FaSelect
          :options="[
            { label: '保密', value: '2' },
            { label: '男', value: '1' },
            { label: '女', value: '0' },
          ]" placeholder="请选择性别" class="w-full"
        />
      </FaFormItem>
      <FaFormItem name="role_id" label="角色">
        <FaSelect :options="roleList.map((item: any) => ({ label: item.name, value: item.id }))" placeholder="请选择角色" class="w-full" />
      </FaFormItem>
    </FaForm>
  </div>
</template>
