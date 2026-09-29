import { SLH_BILL_RECIPIENT_FIXTURES, SLH_BILL_RECIPIENT_INTERNATIONAL_FIXTURES } from '../../../test/fixtures/slh-bill-recipient.fixture'
import { parseSlhBillRecipient } from './slh-bill-recipient-parser'

// 夹具与边界用例的期望值来自规则确认稿；形态取自两份真实账单（78 行）的脱敏同形结果。
describe('slh bill recipient parser', () => {
  describe('真实账单形态（脱敏夹具）', () => {
    it.each(SLH_BILL_RECIPIENT_FIXTURES)('解析 $raw', (fixture) => {
      expect(parseSlhBillRecipient(fixture.raw)).toEqual({
        recipientAddress: fixture.address === '' ? null : fixture.address,
        recipientName: fixture.name === '' ? null : fixture.name,
        recipientPhones: fixture.phones === '' ? null : fixture.phones,
      })
    })
  })

  describe('需求驱动写法（样本未覆盖，按规则确认稿作为规格）', () => {
    it.each(SLH_BILL_RECIPIENT_INTERNATIONAL_FIXTURES)('解析 $raw', (fixture) => {
      expect(parseSlhBillRecipient(fixture.raw)).toEqual({
        recipientAddress: fixture.address,
        recipientName: fixture.name,
        recipientPhones: fixture.phones,
      })
    })
  })

  describe('门牌与电话同形时的排除规则', () => {
    it('紧跟地址单位的数字串判为地址，不当作电话', () => {
      // `37-22號`、`1666-1號`、`130之181號`、`4鄰45-2號`：全都不构成电话。
      const result = parseSlhBillRecipient('範例市範例區範例里37-22號915000000王小明')
      expect(result.recipientAddress).toBe('範例市範例區範例里37-22號')
      expect(result.recipientPhones).toBe('915000000')
    })

    it('里程与小数点不会被当成号码', () => {
      const result = parseSlhBillRecipient('範例縣範例鎮範例里6-3號範例1.5km0930-000000王小明')
      expect(result.recipientAddress).toBe('範例縣範例鎮範例里6-3號範例1.5km')
      expect(result.recipientPhones).toBe('0930-000000')
    })
  })

  describe('缺失与异常输入', () => {
    it('空值与空白一律返回三个 null', () => {
      for (const input of [null, undefined, '', '   ']) {
        expect(parseSlhBillRecipient(input)).toEqual({ recipientAddress: null, recipientName: null, recipientPhones: null })
      }
    })

    it('整串恰好重复两遍时折叠后再解析', () => {
      expect(parseSlhBillRecipient('測試倉庫測試倉庫')).toEqual({ recipientAddress: '測試倉庫', recipientName: null, recipientPhones: null })
      // 只折叠"对半完全相同"的整串重复，正文里的重复内容不删。
      expect(parseSlhBillRecipient('範例市範例區範例里37-22號915000000王小明')).toEqual({
        recipientAddress: '範例市範例區範例里37-22號',
        recipientName: '王小明',
        recipientPhones: '915000000',
      })
    })

    it('有数字但没有任何合法号码时留空而不猜', () => {
      expect(parseSlhBillRecipient('範例市範例區範例號123林先生')).toEqual({
        recipientAddress: '範例市範例區範例號123林先生',
        recipientName: null,
        recipientPhones: null,
      })
    })

    it('全角字符按 NFKC 归一化后再识别', () => {
      // 全角斜杠与全角括号都要被当成半角处理，号码原文按归一化后的文本保留。
      expect(parseSlhBillRecipient('範例市範例區範例路1號0910000000／0920000000黃小姐')).toEqual({
        recipientAddress: '範例市範例區範例路1號',
        recipientName: '黃小姐',
        recipientPhones: '0910000000/0920000000',
      })
    })
  })
})
