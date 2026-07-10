import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Filter from './_filter.vue'
import FilterRaw from './_filter.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '筛选条件',
    component: Filter,
    componentRaw: FilterRaw,
  },
]
