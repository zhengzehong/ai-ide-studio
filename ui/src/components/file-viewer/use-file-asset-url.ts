import { useCallback, useEffect, useState } from 'react'
import { requestFileAssetUrl } from '../../services/file-assets'

export function useFileAssetUrl(
  projectId: string,
  filePath: string,
  options: { basePath?: string; mode?: 'inline' | 'attachment' } = {},
): { url: string; loading: boolean; error: string | null; refresh: () => void } {
  const [generation, setGeneration] = useState(0)
  const requestKey = `${projectId}\0${filePath}\0${options.basePath ?? ''}\0${options.mode ?? 'inline'}\0${generation}`
  const [state, setState] = useState<{ key: string; url: string; error: string | null }>({ key: '', url: '', error: null })
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    let active = true
    void requestFileAssetUrl({ projectId, filePath, basePath: options.basePath, mode: options.mode })
      .then((result) => { if (active) setState({ key: requestKey, url: result.url, error: null }) })
      .catch((reason: unknown) => {
        if (active) setState({ key: requestKey, url: '', error: reason instanceof Error ? reason.message : '资源加载失败' })
      })
    return () => { active = false }
  }, [filePath, options.basePath, options.mode, projectId, requestKey])

  const current = state.key === requestKey ? state : { url: '', error: null }
  return { ...current, loading: !current.url && !current.error, refresh }
}
