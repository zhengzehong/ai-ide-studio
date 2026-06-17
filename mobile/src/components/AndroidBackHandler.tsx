import { useEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConnectionStore } from '../stores/connection.store'

export type AndroidBackAction =
  | { type: 'navigate'; to: string }
  | { type: 'exit' }

export function resolveAndroidBackAction(pathname: string, serverUrl: string): AndroidBackAction {
  if (pathname.startsWith('/chat/') || pathname === '/tasks' || pathname === '/settings') {
    return { type: 'navigate', to: '/' }
  }
  if (pathname === '/connect' && serverUrl.trim()) {
    return { type: 'navigate', to: '/' }
  }
  return { type: 'exit' }
}

export default function AndroidBackHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  const serverUrl = useConnectionStore((state) => state.serverUrl)

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return

    let removeListener: (() => void) | undefined
    void CapacitorApp.addListener('backButton', () => {
      const action = resolveAndroidBackAction(location.pathname, serverUrl)
      if (action.type === 'navigate') {
        navigate(action.to, { replace: true })
        return
      }
      void CapacitorApp.exitApp()
    }).then((handle) => {
      removeListener = () => { void handle.remove() }
    })

    return () => removeListener?.()
  }, [location.pathname, navigate, serverUrl])

  return null
}
