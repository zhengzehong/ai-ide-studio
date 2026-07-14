function matchField(pattern: string, value: number, fieldIndex: number): boolean {
  for (const part of pattern.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '*') return true

    let step = 1
    let range = trimmed
    const slashIdx = trimmed.indexOf('/')
    if (slashIdx !== -1) {
      range = trimmed.slice(0, slashIdx)
      const stepStr = trimmed.slice(slashIdx + 1)
      step = parseInt(stepStr, 10)
      if (isNaN(step) || step < 1) return false
    }

    let min: number
    let max: number
    if (range === '*') {
      return value % step === 0
    }

    const dashIdx = range.indexOf('-')
    if (dashIdx !== -1) {
      min = parseInt(range.slice(0, dashIdx), 10)
      max = parseInt(range.slice(dashIdx + 1), 10)
    } else {
      min = parseInt(range, 10)
      max = min
    }

    if (isNaN(min) || isNaN(max)) continue
    if (fieldIndex === 4) {
      if (min === 7) min = 0
      if (max === 7) max = 0
    }
    if (value >= min && value <= max && (value - min) % step === 0) return true
  }
  return false
}

const CRON_FIELD_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: '分', min: 0, max: 59 },
  { name: '时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  { name: '周', min: 0, max: 6 },
]

export function validateCronFields(cron: string): void {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('cron 表达式需要 5 个字段')
  parts.forEach((p, i) => {
    if (p === '*') return
    const tokens = p.split(/[\/,-]/)
    for (const tok of tokens) {
      if (tok === '*' || tok === '') continue
      const n = parseInt(tok, 10)
      if (isNaN(n)) {
        throw new Error(`${CRON_FIELD_RANGES[i].name} 字段含非数字: ${tok}`)
      }
      const { min, max, name } = CRON_FIELD_RANGES[i]
      const normalized = i === 4 && n === 7 ? 0 : n
      if (normalized < min || normalized > max) {
        throw new Error(`${name} 字段值 ${n} 越界(${min}-${max})`)
      }
    }
  })
}

export function matchCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const minute = date.getMinutes()
  const hour = date.getHours()
  const dom = date.getDate()
  const month = date.getMonth() + 1
  const dow = date.getDay()

  return (
    matchField(fields[0], minute, 0) &&
    matchField(fields[1], hour, 1) &&
    matchField(fields[2], dom, 2) &&
    matchField(fields[3], month, 3) &&
    matchField(fields[4], dow, 4)
  )
}

export function getNextRunTime(cron: string, after: Date): Date | null {
  const next = new Date(after)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  const maxIter = 525600
  for (let i = 0; i < maxIter; i++) {
    if (matchCron(cron, next)) return new Date(next)
    next.setMinutes(next.getMinutes() + 1)
  }
  return null
}
