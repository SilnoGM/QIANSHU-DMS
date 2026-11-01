# SLH 结算分摊 任务

## 后端

- [x] `PORT_FEE` 枚举与备注解析
- [x] `allocation_snapshot` 迁移
- [x] 公司入账类型（结算 REVENUE / 金流费 COST）/ 规则 / 来源 / 形状约束
- [x] 分摊纯函数（默认目标、贡献额、尾差、校验、快照读取、稳定序列化）
- [x] 结算写入快照、指纹升 v2、相同结算比较改用稳定序列化
- [x] 批次详情返回 `currentSalesOrder`
- [x] 结算 / 核对记录返回逐项分摊与目标合计
- [x] 核对记录 `allocationParties` 补出单人姓名/头像（按 salesOrderId 补读）
- [x] 资金入账按甲/乙/公司拆分，金流费按当前销售单去重
- [x] 甲出单人资金账户预检
- [x] 已结算后调货阻断（申请、直接认领、审批）
- [x] 调货行核对门禁只看乙；销售金额/金流费按乙的约定总额计算
- [x] 历史无快照结算保持旧口径
- [x] 资金引擎支持公司来源（预览、入账、比例快照为 null）
- [x] 单测与 e2e

## 前端

- [x] 结算弹窗分摊预览与逐项目标选择、出单人+单号+原/现单展示、目标合计/方向/合计校验
- [x] 改目标必填原因，COD 只读，费用明细不一致阻断
- [x] 提交携带 `allocationTargets`
- [x] 核对记录展示逐项分摊与目标合计（全宽只读快照、出人头像/姓名 + 原/现单）
- [x] 三语 i18n 与失败码映射
- [x] web 测试

## 验证

- [x] server typecheck / lint / 全量单测
- [x] `slh-reconciliation-batch.e2e-spec.ts` 全量 41 条
- [x] `shipment-storage-claim.e2e-spec.ts` 回归（5 条）
- [x] 已结算后调货阻断单测（`shipment-storage.service.spec`）
- [x] web typecheck / lint / SLH 页面测试
- [x] contract sync + contract check
- [x] dev 库迁移状态
- [ ] 测试机 / 生产迁移与部署（发布时执行）
- [ ] 页面级联调（财务真实账号、真实账单）
