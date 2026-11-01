# 对账详情调货翻转卡 任务

## 后端

- [x] `SlhReconciliationBatchMemberDto.transferRecord` 及子 DTO
- [x] 批次详情查询当前乙对应的 CLAIMED 寄仓记录
- [x] release/claim/cost/claimLines 摘要与人员引用
- [x] 当前乙记录选择、变更计数、认领汇总、成本读取纯函数与单测
- [x] 认领产品行与完整变更前后值（姓名/电话/地址/COD）读取与单测
- [x] 成本原/现承担人从 `legsSnapshot.userId` 读取并回退原出单人/当前出单人
- [x] 序列化挂载与非调货行 null
- [x] 契约同步

## 前端

- [x] 抽出 `slh-order-section.vue`
- [x] 新增 `slh-order-flip-card.vue`（顶栏翻转、3D、inert/aria-live、减少动效）
- [x] 新增 `slh-transfer-record.vue`（按设计稿：标题+状态+仓库、货件三段、来源→当前、行数、成本、变更；移除时间/申请/审批字段）
- [x] 货件编号、柜号唛头分两行；仓库胶囊固定宽度并截断
- [x] 来源销售单可点击翻到背面（与右上角翻转共用 `toggle`）
- [x] 「N 行 / N 件」去底色 + 产品 Tooltip
- [x] 变更摘要 info 图标 + 完整前后值 Tooltip（方案 B），移除固定高度滚动
- [x] 转移成本做成区块，内含总额与原/现承担人，只显示人
- [x] 详情页调货行分支；普通行保留原卡片
- [x] 底部「查看完整寄仓记录」新标签页入口与权限禁用
- [x] 核对焦点改为当前销售单并改标签
- [x] 三语 i18n

## 验证

- [x] server 4321 单测
- [x] `slh-reconciliation-batch.e2e-spec.ts` 41 条
- [x] web SLH 58 条 + typecheck/lint/stylelint/build
- [x] contract check
- [x] 演示批次 `SRB/20261101-001` 数据准备
- [x] 编译后查询服务实测 `transferRecord.lines=1`、`changes=3` 且含完整前后值
- [ ] 浏览器页面级手工验收（需登录账号；翻转/键盘/减少动效/入口/两个 Tooltip）
- [ ] 普通非调货行的真实批次页面验收（当前演示批次只有调货行）
