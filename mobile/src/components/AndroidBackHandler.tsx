import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConnectionStore } from '../stores/connection.store'

export type AndroidBackAction =
  | { type: 'navigate'; to: string }
  | { type: 'exit' }

export interface AndroidBackSnapshot {
  pathname: string
  serverUrl: string
  navigate: (to: string, options: { replace: boolean }) => void
}

interface AndroidBackListenerDeps {
  addListener: (eventName: 'backButton', listener: () => void) => Promise<{ remove: () => Promise<void> }>
  exitApp: () => Promise<void>
  getSnapshot: () => AndroidBackSnapshot
}

export function resolveAndroidBackAction(pathname: string, serverUrl: string): AndroidBackAction {
  if (pathname.startsWith('/chat/') || pathname === '/tasks' || pathname === '/settings') {
    return { type: 'navigate', to: '/' }
  }
  if (pathname === '/connect' && serverUrl.trim()) {
    return { type: 'navigate', to: '/' }
  }
  return { type: 'exit' }
}

export function registerAndroidBackListener({ addListener, exitApp, getSnapshot }: AndroidBackListenerDeps): () => void {
  let disposed = false
  let removeListener: (() => void) | undefined

  void addListener('backButton', () => {
    const snapshot = getSnapshot()
    const action = resolveAndroidBackAction(snapshot.pathname, snapshot.serverUrl)
    if (action.type === 'navigate') {
      snapshot.navigate(action.to, { replace: true })
      return
    }
    void exitApp()
  }).then((handle) => {
    removeListener = () => { void handle.remove() }
    if (disposed) removeListener()
  })

  return () => {
    disposed = true
    removeListener?.()
  }
}

export default function AndroidBackHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  const serverUrl = useConnectionStore((state) => state.serverUrl)
  const latestRef = useRef<AndroidBackSnapshot>({ pathname: location.pathname, serverUrl, navigate })

  useEffect(() => {
    latestRef.current = { pathname: location.pathname, serverUrl, navigate }
  }, [location.pathname, navigate, serverUrl])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    return registerAndroidBackListener({
      addListener: CapacitorApp.addListener.bind(CapacitorApp),
      exitApp: CapacitorApp.exitApp.bind(CapacitorApp),
      getSnapshot: () => latestRef.current,
    })
  }, [])

  return null
}
