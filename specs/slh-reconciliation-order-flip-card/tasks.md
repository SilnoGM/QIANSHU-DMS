# 对账详情调货翻转卡 任务

## 后端

- [x] `SlhReconciliationBatchMemberDto.transferRecord` 及子 DTO
- [x] 批次详情查询当前乙对应的 CLAIMED 寄仓记录
- [x] release/claim/cost/claimLines 摘要与人员引用
- [x] 当前乙记录选择、变更计数、认领汇总、成本读取纯函数与单测
- [x] 序列化挂载与非调货行 null
- [x] 契约同步

## 前端

- [x] 抽出 `slh-order-section.vue`
- [x] 新增 `slh-order-flip-card.vue`（顶栏翻转、3D、inert/aria-live、减少动效）
- [x] 新增 `slh-transfer-record.vue`（成本、变更摘要、申请/审批/认领）
- [x] 详情页调货行分支；普通行保留原卡片
- [x] 底部「查看完整寄仓记录」新标签页入口与权限禁用
- [x] 核对焦点改为当前销售单并改标签
- [x] 三语 i18n

## 验证

- [x] server 4319 单测
- [x] `slh-reconciliation-batch.e2e-spec.ts` 41 条
- [x] web SLH 58 条 + typecheck/lint/build
- [x] contract check
- [x] 演示批次 `SRB/20261101-001` 数据准备
- [ ] 浏览器页面级手工验收（需登录账号；翻转/键盘/减少动效/入口）
- [ ] 普通非调货行的真实批次页面验收（当前演示批次只有调货行）
