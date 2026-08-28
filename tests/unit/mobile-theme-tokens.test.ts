import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { theme } from '../../mobile/src/theme'

const MOBILE_SRC = fileURLToPath(new URL('../../mobile/src', import.meta.url))
const INDEX_CSS = readFileSync(join(MOBILE_SRC, 'index.css'), 'utf8')

function parseDefinedVars(css: string): Map<string, string> {
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(css)
  expect(rootMatch, 'index.css 必须存在 :root 块').toBeTruthy()
  const vars = new Map<string, string>()
  for (const line of rootMatch![1].split(';')) {
    const decl = /^--([a-z0-9-]+)\s*:\s*(.+)$/.exec(line.trim())
    if (decl) vars.set(`--${decl[1]}`, decl[2].trim())
  }
  return vars
}

function collectUsedVars(dir: string, acc: Map<string, string[]>): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      collectUsedVars(full, acc)
      continue
    }
    if (!/\.(tsx?|css)$/.test(name)) continue
    const content = readFileSync(full, 'utf8')
    for (const match of content.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const relative = full.slice(MOBILE_SRC.length + 1)
      const users = acc.get(match[1]) ?? []
      users.push(relative)
      acc.set(match[1], users)
    }
  }
}

describe('mobile theme tokens', () => {
  const defined = parseDefinedVars(INDEX_CSS)
  const used = new Map<string, string[]>()
  collectUsedVars(MOBILE_SRC, used)

  test('index.css 定义了设计系统基础 token', () => {
    for (const required of [
      '--primary', '--primary-bg', '--bg', '--bg-card', '--bg-input',
      '--text-primary', '--text-secondary', '--text-muted',
      '--border', '--border-light',
      '--success', '--success-bg', '--warning', '--warning-bg',
      '--error', '--error-bg', '--info', '--info-bg',
      '--radius', '--radius-sm', '--radius-lg',
      '--font-mono', '--shadow-card',
    ]) {
      expect(defined.has(required), `缺少 token ${required}`).toBe(true)
    }
  })

  test('mobile/src 中使用的每个 CSS 变量都有定义(防 --error-bg 类透明 bug)', () => {
    const missing = [...used.keys()].filter((name) => !defined.has(name))
    expect(missing, `未定义的变量被使用: ${missing.join(', ')}`).toEqual([])
  })

  test('theme.ts 与 index.css 颜色值保持同步', () => {
    const cssToTheme: Record<string, string> = {
      '--primary': 'primary',
      '--primary-light': 'primaryLight',
      '--primary-bg': 'primaryBg',
      '--bg': 'bg',
      '--bg-card': 'bgCard',
      '--bg-input': 'bgInput',
      '--text-primary': 'textPrimary',
      '--text-secondary': 'textSecondary',
      '--text-muted': 'textMuted',
      '--border': 'border',
      '--border-light': 'borderLight',
      '--success': 'success',
      '--success-bg': 'successBg',
      '--warning': 'warning',
      '--warning-bg': 'warningBg',
      '--error': 'error',
      '--error-bg': 'errorBg',
      '--info': 'info',
      '--info-bg': 'infoBg',
    }
    for (const [cssVar, themeKey] of Object.entries(cssToTheme)) {
      expect(defined.get(cssVar)?.toLowerCase(), `${cssVar} 与 theme.ts.${themeKey} 不一致`)
        .toBe(theme.colors[themeKey as keyof typeof theme.colors].toLowerCase())
    }
  })

  test('提供按压反馈与卡片全局类', () => {
    expect(INDEX_CSS).toContain('.pressable')
    expect(INDEX_CSS).toContain('.pressable:active')
    expect(INDEX_CSS).toContain('.card')
    expect(INDEX_CSS).toContain('.group-block')
  })
})
