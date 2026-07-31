import { existsSync } from 'fs'
import { join } from 'path'

interface DesktopIconLocation {
  appPath: string
  resourcesPath: string
  exists?: (path: string) => boolean
}

export function resolveDesktopIconPath(location: DesktopIconLocation): string | undefined {
  const exists = location.exists ?? existsSync
  const candidates = [
    join(location.resourcesPath, 'app-icon.png'),
    join(location.appPath, 'ui', 'public', 'app-icon.png'),
    join(location.appPath, 'ui', 'dist', 'app-icon.png'),
  ]
  return candidates.find((path) => exists(path))
}
