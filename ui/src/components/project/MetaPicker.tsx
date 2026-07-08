import type { CSSProperties } from 'react'
import { PROJECT_COLORS, PROJECT_ICONS } from '../../utils/project-meta'

interface ColorPickerProps {
  color: string
  onChange: (color: string) => void
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  return (
    <div style={{ flex: 1 }}>
      <label style={styles.label}>颜色</label>
      <div style={styles.colorGrid}>
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(color === c ? '' : c)}
            title={c}
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: c,
              border: color === c ? '2px solid var(--text-1)' : '2px solid transparent',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface IconPickerProps {
  icon: string
  onChange: (icon: string) => void
  effectiveColor: string
  effectiveIcon: string
}

export function IconPicker({ icon, onChange, effectiveColor, effectiveIcon }: IconPickerProps) {
  return (
    <div style={{ flex: 1 }}>
      <label style={styles.label}>图标</label>
      <div style={styles.iconGrid}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 5,
            background: effectiveColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
          }}
        >
          {effectiveIcon}
        </span>
        {PROJECT_ICONS.map((ic) => (
          <button
            key={ic}
            type="button"
            onClick={() => onChange(icon === ic ? '' : ic)}
            title={ic}
            style={{
              width: 30,
              height: 30,
              borderRadius: 5,
              background: icon === ic ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-1)',
              border: icon === ic ? '1px solid var(--blue)' : '1px solid transparent',
              cursor: 'pointer',
              padding: 0,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            {ic}
          </button>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    color: 'var(--text-1)',
  },
  colorGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  iconGrid: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
}
