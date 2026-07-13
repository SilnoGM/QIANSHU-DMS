import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import CustomContent from './_custom-content.vue'
import CustomContentRaw from './_custom-content.vue?raw'
import Status from './_status.vue'
import StatusRaw from './_status.vue?raw'

export default [
  {
    title: '基础用法',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '状态',
    component: Status,
    componentRaw: StatusRaw,
  },
  {
    title: '自定义内容',
    component: CustomContent,
    componentRaw: CustomContentRaw,
  },
]
