import { SupplierEntityType } from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeCreateSupplierInput,
  normalizeUpdateSupplierInput,
} from './supplier.normalizer'

const COUNTRY_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const PROVINCE_ID = 'ba6e6036-42c7-489b-b22b-238c3d36a879'
const CITY_ID = '5f6ddb91-c9a0-4ee4-a1de-e2587128fdc3'

describe('supplier normalizer', () => {
  it('normalizes a complete create payload and derives search values', () => {
    expect(normalizeCreateSupplierInput({
      legalName: '  Re\u0301al\u3000供应商  ',
      shortName: '  REAL\t供方  ',
      entityType: SupplierEntityType.ORGANIZATION,
      registration: {
        countryRegionId: COUNTRY_ID.toUpperCase(),
        number: ' ＡＢ 12- ３ ',
      },
      primaryContact: {
        name: '  张\u3000三  ',
        phone: ' +86 (138) 0000-0000 ',
        wechatId: '  SilnoGM  ',
      },
      primaryAddress: {
        countryRegionId: COUNTRY_ID.toUpperCase(),
        provinceStateId: PROVINCE_ID,
        cityId: CITY_ID,
        addressLine: '  科技园\u30001 号  ',
        postalCode: '  518000  ',
      },
      remark: '  首选供方\r\n需复核  ',
    })).toEqual({
      legalName: 'Réal\u3000供应商',
      normalizedLegalName: 'réal 供应商',
      shortName: 'REAL\t供方',
      normalizedShortName: 'real 供方',
      entityType: SupplierEntityType.ORGANIZATION,
      registration: {
        countryRegionId: COUNTRY_ID,
        number: 'ＡＢ 12- ３',
        normalizedNumber: 'AB12-3',
      },
      primaryContact: {
        name: '张\u3000三',
        normalizedName: '张 三',
        phone: '+86 (138) 0000-0000',
        normalizedPhone: '+8613800000000',
        wechatId: 'SilnoGM',
        normalizedWechatId: 'silnogm',
      },
      primaryAddress: {
        countryRegionId: COUNTRY_ID,
        provinceStateId: PROVINCE_ID,
        cityId: CITY_ID,
        addressLine: '科技园\u30001 号',
        postalCode: '518000',
      },
      remark: '首选供方\r\n需复核',
    })
  })

  it('canonicalizes omitted, null and blank optional create values to null', () => {
    const minimal = {
      legalName: '个体供应商',
      entityType: SupplierEntityType.INDIVIDUAL,
    }

    expect(normalizeCreateSupplierInput(minimal)).toMatchObject({
      shortName: null,
      normalizedShortName: null,
      registration: null,
      primaryContact: null,
      primaryAddress: null,
      remark: null,
    })
    expect(normalizeCreateSupplierInput({
      ...minimal,
      shortName: ' \u3000 ',
      primaryContact: { name: null, phone: ' ', wechatId: null },
      primaryAddress: {
        countryRegionId: null,
        provinceStateId: null,
        cityId: null,
        addressLine: ' ',
        postalCode: null,
      },
      remark: '',
    })).toMatchObject({
      shortName: null,
      primaryContact: null,
      primaryAddress: null,
      remark: null,
    })
  })

  it('preserves PATCH omission while null and objects remain explicit replacements', () => {
    expect(normalizeUpdateSupplierInput({
      expectedVersion: 7,
      primaryContact: null,
      primaryAddress: {
        countryRegionId: COUNTRY_ID,
        provinceStateId: null,
        cityId: null,
        addressLine: null,
        postalCode: ' ',
      },
    })).toEqual({
      expectedVersion: 7,
      primaryContact: null,
      primaryAddress: {
        countryRegionId: COUNTRY_ID,
        provinceStateId: null,
        cityId: null,
        addressLine: null,
        postalCode: null,
      },
    })
  })

  it.each([
    [{ legalName: ' ' }, 'legalName'],
    [{ legalName: '😀'.repeat(201) }, 'legalName'],
    [{ shortName: '😀'.repeat(101) }, 'shortName'],
    [{ registration: { countryRegionId: COUNTRY_ID, number: '😀'.repeat(65) } }, 'registration.number'],
    [{ primaryContact: { name: '😀'.repeat(129), phone: null, wechatId: null } }, 'primaryContact.name'],
    [{ primaryContact: { name: null, phone: '1'.repeat(33), wechatId: null } }, 'primaryContact.phone'],
    [{ primaryContact: { name: null, phone: '㍿'.repeat(32), wechatId: null } }, 'primaryContact.phone'],
    [{ primaryContact: { name: null, phone: null, wechatId: 'İ'.repeat(64) } }, 'primaryContact.wechatId'],
    [{ primaryAddress: { countryRegionId: null, provinceStateId: null, cityId: null, addressLine: '😀'.repeat(501), postalCode: null } }, 'primaryAddress.addressLine'],
    [{ remark: '😀'.repeat(1001) }, 'remark'],
  ])('rejects invalid normalized field %s', (partial, field) => {
    try {
      normalizeCreateSupplierInput({
        legalName: '供应商',
        entityType: SupplierEntityType.ORGANIZATION,
        ...partial,
      })
      throw new Error('Expected supplier validation failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException)
      const exception = error as ApiException
      expect(exception.code).toBe('VALIDATION_FAILED')
      expect(Object.keys(exception.fieldErrors ?? {})).toContain(field)
    }
  })
})
