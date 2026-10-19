import type { AxiosInstance } from 'axios'
import type {
  CreateProductHeadRequestDto,
  CreateProductTaxonomyCategoryRequestDto,
  MoveProductTaxonomyItemRequestDto,
  ProductCategoriesListData,
  ProductTaxonomyCategoryListDto,
  ProductTaxonomyCategoryListItemDto,
  ProductTaxonomyHeadListItemDto,
  RenameProductHeadRequestDto,
  RenameProductTaxonomyCategoryRequestDto,
} from '../generated/types.gen'

import api from '../index'

export type ProductCategoryListQuery = ProductCategoriesListData['query']

export function createProductTaxonomiesApi(client: AxiosInstance) {
  return {
    listCategories: (
      query: ProductCategoryListQuery,
      signal: AbortSignal,
    ) => client.get<ProductTaxonomyCategoryListDto>('product-categories', {
      errorPresentation: 'local',
      params: query,
      signal,
    }),
    createCategory: (
      data: CreateProductTaxonomyCategoryRequestDto,
      signal: AbortSignal,
    ) => client.post<ProductTaxonomyCategoryListItemDto>(
      'product-categories',
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    renameCategory: (
      categoryId: string,
      data: RenameProductTaxonomyCategoryRequestDto,
      signal: AbortSignal,
    ) => client.patch<ProductTaxonomyCategoryListItemDto>(
      `product-categories/${encodeURIComponent(categoryId)}`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    moveCategory: (
      categoryId: string,
      data: MoveProductTaxonomyItemRequestDto,
      signal: AbortSignal,
    ) => client.patch<void>(
      `product-categories/${encodeURIComponent(categoryId)}/move`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    deleteCategory: (
      categoryId: string,
      signal: AbortSignal,
    ) => client.delete<void>(
      `product-categories/${encodeURIComponent(categoryId)}`,
      { errorPresentation: 'local', retry: false, signal },
    ),
    createHead: (
      data: CreateProductHeadRequestDto,
      signal: AbortSignal,
    ) => client.post<ProductTaxonomyHeadListItemDto>(
      'product-heads',
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    renameHead: (
      productHeadId: string,
      data: RenameProductHeadRequestDto,
      signal: AbortSignal,
    ) => client.patch<ProductTaxonomyHeadListItemDto>(
      `product-heads/${encodeURIComponent(productHeadId)}`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    moveHead: (
      productHeadId: string,
      data: MoveProductTaxonomyItemRequestDto,
      signal: AbortSignal,
    ) => client.patch<void>(
      `product-heads/${encodeURIComponent(productHeadId)}/move`,
      data,
      { errorPresentation: 'local', retry: false, signal },
    ),
    deleteHead: (
      productHeadId: string,
      signal: AbortSignal,
    ) => client.delete<void>(
      `product-heads/${encodeURIComponent(productHeadId)}`,
      { errorPresentation: 'local', retry: false, signal },
    ),
  }
}

export default createProductTaxonomiesApi(api)
