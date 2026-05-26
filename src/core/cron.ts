function matchField(pattern: string, value: number): boolean {
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
    if (value >= min && value <= max && (value - min) % step === 0) return true
  }
  return false
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
    matchField(fields[0], minute) &&
    matchField(fields[1], hour) &&
    matchField(fields[2], dom) &&
    matchField(fields[3], month) &&
    matchField(fields[4], dow)
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
