export interface PaginationResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function paginateList<T>(
  list: T[],
  page: number = 1,
  pageSize: number = 15
): PaginationResult<T> {
  const totalItems = list.length;
  const safePageSize = pageSize > 0 ? pageSize : 15;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), totalPages);

  const startOffset = (safePage - 1) * safePageSize;
  const endOffset = startOffset + safePageSize;
  const items = list.slice(startOffset, endOffset);

  const startIndex = totalItems > 0 ? startOffset + 1 : 0;
  const endIndex = totalItems > 0 ? Math.min(startOffset + items.length, totalItems) : 0;

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
  };
}

export function getPaginationPageNumbers(
  currentPage: number,
  totalPages: number
): Array<number | string> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      '...',
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    '...',
    currentPage - 1,
    currentPage,
    currentPage + 1,
    '...',
    totalPages,
  ];
}
