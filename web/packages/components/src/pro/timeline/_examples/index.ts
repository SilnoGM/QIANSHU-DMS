import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Merge from './_merge.vue'
import MergeRaw from './_merge.vue?raw'
import Scroll from './_scroll.vue'
import ScrollRaw from './_scroll.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '合并相同时间',
    component: Merge,
    componentRaw: MergeRaw,
  },
  {
    title: '设置高度并出现滚动条',
    component: Scroll,
    componentRaw: ScrollRaw,
  },
]
