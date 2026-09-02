import { Suspense, type ReactElement, type ReactNode } from 'react'

export function RouteBoundary({ children }: { children: ReactNode }): ReactElement {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>
}

function RouteLoading(): ReactElement {
  return (
    <div className="route-loading" role="status" aria-label="页面加载中">
      <span className="route-loading-spinner" aria-hidden="true" />
      <span>正在加载页面</span>
    </div>
  )
}
