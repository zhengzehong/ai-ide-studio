import { createElement, lazy, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react'
import {
  createChunkRecoveryPolicy,
  getChunkRecoveryStorage,
} from '../services/chunk-recovery'

type RouteComponent = ComponentType

export function lazyWithRecovery(
  loader: () => Promise<{ default: RouteComponent }>,
): LazyExoticComponent<RouteComponent> {
  const storage = getChunkRecoveryStorage()
  const policy = storage ? createChunkRecoveryPolicy(storage) : null
  return lazy(async (): Promise<{ default: RouteComponent }> => {
    try {
      const module = await loader()
      if (typeof window !== 'undefined') policy?.clear(window.location.pathname)
      return module
    } catch (error) {
      const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
      if (policy?.shouldReload(error, pathname)) window.location.reload()
      return { default: RouteLoadError }
    }
  })
}

function RouteLoadError(): ReactElement {
  return createElement(
    'section',
    { className: 'route-load-error', role: 'alert' },
    createElement('strong', null, '页面资源加载失败'),
    createElement('p', null, '可能是服务更新或网络连接中断，请重新加载。'),
    createElement(
      'button',
      { type: 'button', onClick: (): void => window.location.reload() },
      '重新加载',
    ),
  )
}
