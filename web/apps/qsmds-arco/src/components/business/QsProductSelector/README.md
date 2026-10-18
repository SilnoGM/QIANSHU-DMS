# QsProductSelector

`QsProductSelector` 是业务中立的数据库产品选择器。组件只通过 `loadProducts`
读取全部有效产品候选页；订单币种只决定可空标准价，不限制产品展示。组件通过
`existingLines` 回显调用方当前数据库产品明细，并在
用户最终确认后一次性发出 `ADD | INCREMENT | REMOVE` 变更集。

弹窗使用 `QsGenericModal` 的 `2xl` 档位，内容区为「分类列 + 产品区 + 已选面板」
三列。分类列和数量来自 loader 返回的分类 facet；产品区按
`(categoryName, productHeadName)` 复合键分组，文本产品头跨分类同名不会被合并。
分类、供应商或关键词变化都会重置产品分页。

产品卡片的主图区是独立的预览按钮：点击调用项目 `useFaImagePreview()` 打开原图，
不会触发选择；卡片信息区才是选择/加量入口。卡片图片加载失败时仅显示占位图。

组件内部查询、供应商筛选、滚动分页、已选投影和变更集都属于一次弹窗会话。关闭、
取消或 Escape 会丢弃会话，绝不直接修改订单明细。销售订单和采购订单必须各自提供
loader，组件不得导入领域 API、路由、Store 或权限常量。loader 返回的每一页必须
同时提供 `items`、`categories`、`unclassifiedCount`、`page`、`pageSize` 和 `total`。

右侧已选列表始终投影“确认后会保留的数据库产品”。重复产品使用弹窗内锚定的
`FaPopover` 询问“产品已存在，是否增加数量？”，可在同一会话中累计数量；删除
已有产品只登记待提交的 `REMOVE`，取消弹窗仍会完整保留原明细。
