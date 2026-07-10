import api from '../index'

export default {
  list: () => api.get('dictionary/list', {
    fake: true,
  }),

  detail: (id: number | string) => api.get('dictionary/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  create: (data: any) => api.post('dictionary/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('dictionary/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('dictionary/delete', {
    id,
  }, {
    fake: true,
  }),

  itemList: (data: {
    dictionary_id: number | string
    title?: string
    from: number
    limit: number
  }) => api.get('dictionary/item/list', {
    params: data,
    fake: true,
  }),

  itemDetail: (id: number | string) => api.get('dictionary/item/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  itemCreate: (data: any) => api.post('dictionary/item/create', data, {
    fake: true,
  }),

  itemEdit: (data: any) => api.post('dictionary/item/edit', data, {
    fake: true,
  }),

  itemDelete: (id: number | number[] | string | string[]) => api.post('dictionary/item/delete', {
    id,
  }, {
    fake: true,
  }),

  itemChangeEnable: (data: {
    id: number
    enable: boolean
  }) => api.post('dictionary/item/change/enable', data, {
    fake: true,
  }),

  get: (code?: string) => api.get('dictionary/get', {
    params: {
      code,
    },
    fake: true,
  }),
}
