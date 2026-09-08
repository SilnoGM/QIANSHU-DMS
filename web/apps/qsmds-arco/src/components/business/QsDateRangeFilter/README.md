# QsDateRangeFilter

`QsDateRangeFilter` 是订单列表等查询工具栏使用的日期范围控件。组件组合
`FaCalendarDateRange` 与框内清除按钮，只负责选择状态、完成通知和清除交互，
不请求 API，也不理解 `orderDateFrom`、`orderDateTo` 等领域查询字段。

## 契约

- `v-model`：受控的 `CalendarDateRangeValue`。
- `calendarLabel`：日历与清除按钮的可访问名称。
- `placeholder`：空区间时的触发器文本。
- `minValue`、`maxValue`：可选日期边界。
- `complete`：用户完成一个有效起止区间后触发。
- `clear`：用户通过框内叉号清空区间后触发。

业务页面在 `complete` 和 `clear` 中重置分页并重新请求数据。组件不会监听值变化后
自行请求，避免与页面的搜索、筛选和请求取消策略产生重复副作用。
