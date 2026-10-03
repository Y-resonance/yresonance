import { useEffect } from 'react';

export function pageTitle(page?: string) {
  return page ? `${page} | yresonance` : 'yresonance';
}

// Detail page names arrive through the existing client-side requests, after
// TanStack Router has rendered the route's generic fallback title.
export function usePageTitle(page?: string) {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
