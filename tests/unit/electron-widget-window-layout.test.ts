import { describe, expect, test } from 'vitest'
import {
  resolveWidgetPosition,
  WIDGET_HEIGHT,
  WIDGET_WIDTH,
} from '../../electron/widget-window-layout.js'

describe('Electron Widget window layout', () => {
  test('uses the compact fixed size and default bottom-right gap', () => {
    expect({ width: WIDGET_WIDTH, height: WIDGET_HEIGHT }).toEqual({ width: 300, height: 400 })
    expect(resolveWidgetPosition(null, { width: 1920, height: 1080 })).toEqual({ x: 1600, y: 660 })
  })

  test('preserves legacy right and bottom gaps after resizing', () => {
    expect(resolveWidgetPosition(
      { x: 1510, y: 490 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 1600, y: 660 })
  })

  test('preserves the right gap from the previous 360px Widget', () => {
    expect(resolveWidgetPosition(
      { x: 1540, y: 660, width: 360, height: 400 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 1600, y: 660 })
  })

  test('preserves a Widget placed near the top-left edge', () => {
    expect(resolveWidgetPosition(
      { x: 20, y: 20, width: 390, height: 570 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 20, y: 20 })
  })
})
