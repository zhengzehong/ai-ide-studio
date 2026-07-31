export type WidgetTheme = 'light' | 'yellow' | 'dark'

const STORAGE_KEY = 'ai-ide-widget-theme'
const THEMES: WidgetTheme[] = ['light', 'yellow', 'dark']

interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const WIDGET_THEME_LABELS: Record<WidgetTheme, string> = {
  light: '亮色',
  yellow: '黄色',
  dark: '深色',
}

export function getNextWidgetTheme(theme: WidgetTheme): WidgetTheme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
}

export function readWidgetTheme(storage: ThemeStorage): WidgetTheme {
  try {
    const value = storage.getItem(STORAGE_KEY)
    return isWidgetTheme(value) ? value : 'light'
  } catch {
    return 'light'
  }
}

export function saveWidgetTheme(storage: ThemeStorage, theme: WidgetTheme): void {
  try {
    storage.setItem(STORAGE_KEY, theme)
  } catch {
    // Keep the active in-memory theme when storage is unavailable.
  }
}

function isWidgetTheme(value: string | null): value is WidgetTheme {
  return value === 'light' || value === 'yellow' || value === 'dark'
}
