import type { NotificationTemplateDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 分组逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  filterTemplateDomainGroups,
  groupTemplateKeysByDomain,
  groupTemplatesByKey,
  splitTemplateBody,
} from '../../src/views/system/notifications/template-key-grouping.logic'

function template(overrides: Partial<NotificationTemplateDto> & Pick<NotificationTemplateDto, 'channel' | 'key'>): NotificationTemplateDto {
  return {
    id: `${overrides.key}-${overrides.channel}`,
    key: overrides.key,
    channel: overrides.channel,
    name: overrides.key,
    domain: 'PURCHASE',
    titleTemplate: null,
    bodyTemplate: '正文',
    linkUrlTemplate: null,
    variables: [],
    maxLength: 2000,
    enabled: true,
    version: 1,
    updatedAt: '2026-11-09T08:00:00.000Z',
    updatedByName: '张三',
    ...overrides,
  }
}

test('模板键按渠道聚合，并在域内保持稳定顺序', () => {
  const groups = groupTemplatesByKey([
    template({ channel: 'ASSISTANT', key: 'purchase.review.pending', name: '采购审核提醒', updatedAt: '2026-11-09T08:00:00.000Z', updatedByName: '张三' }),
    template({ channel: 'IN_APP', key: 'purchase.review.pending', name: '采购审核待办', updatedAt: '2026-11-08T08:00:00.000Z', updatedByName: '李四' }),
    template({ channel: 'IN_APP', key: 'shipment.arrived', name: '货件到仓', domain: 'SHIPMENT' }),
  ])

  assert.equal(groups.length, 2)
  const purchase = groups.find(group => group.key === 'purchase.review.pending')
  assert.equal(purchase?.displayName, '采购审核提醒')
  assert.equal(purchase?.channelCount, 2)
  assert.equal(purchase?.updatedByName, '张三')
  assert.deepEqual(groupTemplateKeysByDomain(groups).map(group => group.label), ['采购域', '货件运输域'])
})

test('业务域和模板键过滤使用同一份分组结果', () => {
  const groups = groupTemplateKeysByDomain(groupTemplatesByKey([
    template({ channel: 'ASSISTANT', key: 'purchase.review.pending', domain: 'PURCHASE' }),
    template({ channel: 'ASSISTANT', key: 'shipment.arrived', domain: 'SHIPMENT' }),
  ]))

  assert.deepEqual(filterTemplateDomainGroups(groups, '货件').map(group => group.label), ['货件运输域'])
  assert.deepEqual(filterTemplateDomainGroups(groups, 'purchase.review').flatMap(group => group.keys.map(key => key.key)), ['purchase.review.pending'])
  assert.deepEqual(filterTemplateDomainGroups(groups, '不存在'), [])
})

test('正文预览只标记合法双花括号变量', () => {
  assert.deepEqual(splitTemplateBody('采购单 {{orderNo}} 已提交'), [
    { text: '采购单 ', token: false },
    { text: '{{orderNo}}', token: true },
    { text: ' 已提交', token: false },
  ])
  assert.equal(splitTemplateBody('单花括号 {orderNo} 不标记').some(segment => segment.token), false)
})
