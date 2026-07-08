import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/project.store'

export type PathCheckState = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'missing' } | { state: 'error', message: string }

type StoredResult = { workDir: string; state: Exclude<PathCheckState, { state: 'idle' } | { state: 'checking' }> }

export function usePathCheck(workDir: string, enabled: boolean): PathCheckState {
  const checkPath = useProjectStore((s) => s.checkPath)
  const [result, setResult] = useState<StoredResult | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const trimmed = workDir.trim()
    if (!trimmed) return
    const seq = ++seqRef.current
    const handle = setTimeout(() => {
      checkPath(trimmed)
        .then((res) => {
          if (seq !== seqRef.current) return
          if (res.exists && res.isDir) {
            setResult({ workDir: trimmed, state: { state: 'ok' } })
          } else if (res.exists && !res.isDir) {
            setResult({ workDir: trimmed, state: { state: 'error', message: '路径是文件,不是目录' } })
          } else {
            setResult({ workDir: trimmed, state: { state: 'missing' } })
          }
        })
        .catch(() => {
          if (seq !== seqRef.current) return
          setResult({ workDir: trimmed, state: { state: 'missing' } })
        })
    }, 500)
    return () => clearTimeout(handle)
  }, [workDir, enabled, checkPath])

  const trimmed = workDir.trim()
  if (!enabled || !trimmed) return { state: 'idle' }
  if (!result || result.workDir !== trimmed) return { state: 'checking' }
  return result.state
}
