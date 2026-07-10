import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import FixedDate from './_fixed-date.vue'
import FixedDateRaw from './_fixed-date.vue?raw'
import Seconds from './_seconds.vue'
import SecondsRaw from './_seconds.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '固定日期',
    component: FixedDate,
    componentRaw: FixedDateRaw,
  },
  {
    title: '秒级更新',
    component: Seconds,
    componentRaw: SecondsRaw,
  },
]
