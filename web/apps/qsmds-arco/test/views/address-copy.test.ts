import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 复制地址前缀处理使用 Node.js 内置 runner 验证。
import test from 'node:test'
import { stripAddressCountryPrefix } from '../../src/utils/address-copy'

test('去掉开头的国家名并保留省名，简体繁体都识别', () => {
  assert.equal(stripAddressCountryPrefix('中国台湾台湾高雄市苓雅区中正一路100号'), '台湾高雄市苓雅区中正一路100号')
  assert.equal(stripAddressCountryPrefix('中國台灣台灣高雄市苓雅區中正一路100號'), '台灣高雄市苓雅區中正一路100號')
})

test('地址只有国家名时只去掉国家名本身，保留台湾', () => {
  assert.equal(stripAddressCountryPrefix('中国台湾'), '台湾')
  assert.equal(stripAddressCountryPrefix('中國台灣'), '台灣')
  assert.equal(stripAddressCountryPrefix(' 中国台湾 '), '台湾')
})

test('没有国家前缀的地址原样返回', () => {
  assert.equal(stripAddressCountryPrefix('高雄市苓雅区中正一路100号'), '高雄市苓雅区中正一路100号')
  assert.equal(stripAddressCountryPrefix('屏東縣竹田鄉鳳新路477之1號'), '屏東縣竹田鄉鳳新路477之1號')
})

test('只剥离开头一处，地址正文里的同名文字保留', () => {
  assert.equal(
    stripAddressCountryPrefix('中国台湾台湾高雄市中国台湾路10号'),
    '台湾高雄市中国台湾路10号',
  )
})

test('去掉首尾空白，空值与缺失值返回空串', () => {
  assert.equal(stripAddressCountryPrefix('  中国台湾台湾高雄市  '), '台湾高雄市')
  assert.equal(stripAddressCountryPrefix(''), '')
  assert.equal(stripAddressCountryPrefix('   '), '')
  assert.equal(stripAddressCountryPrefix(null), '')
  assert.equal(stripAddressCountryPrefix(undefined), '')
})

test('保留地址内部的换行，不做其他改写', () => {
  assert.equal(
    stripAddressCountryPrefix('中国台湾台湾高雄市\n第一行\n第二行'),
    '台湾高雄市\n第一行\n第二行',
  )
})
