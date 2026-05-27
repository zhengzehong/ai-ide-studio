export type ElicitationValue = string | number | boolean | string[]
export type ElicitationValues = Record<string, ElicitationValue>

export interface ElicitationOption {
  value: string
  label: string
}

export interface ElicitationPropertySchema {
  type?: string
  title?: string | null
  description?: string | null
  default?: unknown
  enum?: string[] | null
  oneOf?: { const: string; title?: string | null }[] | null
  minimum?: number | null
  maximum?: number | null
  minItems?: number | null
  maxItems?: number | null
  items?: {
    type?: string
    enum?: string[] | null
    anyOf?: { const: string; title?: string | null }[] | null
  } | null
}

export interface ElicitationSchema {
  type?: string
  title?: string | null
  description?: string | null
  properties?: Record<string, ElicitationPropertySchema>
  required?: string[] | null
  url?: string
}

export interface ValidationResult {
  ok: boolean
  errors: Record<string, string>
}

export function getElicitationOptions(prop: ElicitationPropertySchema): ElicitationOption[] {
  if (prop.type === 'array') {
    if (prop.items?.anyOf) return prop.items.anyOf.map(item => ({ value: item.const, label: item.title || item.const }))
    if (prop.items?.enum) return prop.items.enum.map(item => ({ value: item, label: item }))
    return []
  }
  if (prop.oneOf) return prop.oneOf.map(item => ({ value: item.const, label: item.title || item.const }))
  if (prop.enum) return prop.enum.map(item => ({ value: item, label: item }))
  return []
}

export function getInitialElicitationValues(schema: ElicitationSchema | undefined): ElicitationValues {
  const values: ElicitationValues = {}
  for (const [key, prop] of Object.entries(schema?.properties || {})) {
    if (prop.default !== undefined && prop.default !== null) {
      if (prop.type === 'array') values[key] = Array.isArray(prop.default) ? prop.default.map(String) : []
      else if (prop.type === 'boolean') values[key] = prop.default === true
      else if (prop.type === 'number' || prop.type === 'integer') values[key] = Number(prop.default)
      else values[key] = String(prop.default)
      continue
    }
    if (prop.type === 'array') values[key] = []
    if (prop.type === 'boolean') values[key] = false
  }
  return values
}

export function validateElicitationValues(schema: ElicitationSchema | undefined, values: ElicitationValues): ValidationResult {
  const errors: Record<string, string> = {}
  const props = schema?.properties || {}
  const required = new Set(schema?.required || [])

  for (const [key, prop] of Object.entries(props)) {
    const label = prop.title || key
    const value = values[key]
    const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

    if (required.has(key) && isEmpty) {
      errors[key] = prop.type === 'array' ? '请至少选择 1 项' : `请填写${label}`
      continue
    }

    if (prop.type === 'array' && Array.isArray(value)) {
      if (prop.minItems != null && value.length < prop.minItems) errors[key] = `请至少选择 ${prop.minItems} 项`
      if (prop.maxItems != null && value.length > prop.maxItems) errors[key] = `最多选择 ${prop.maxItems} 项`
    }

    if ((prop.type === 'number' || prop.type === 'integer') && value !== undefined && value !== '') {
      const num = Number(value)
      if (Number.isNaN(num)) errors[key] = `请填写有效数字`
      else if (prop.minimum != null && num < prop.minimum) errors[key] = `不能小于 ${prop.minimum}`
      else if (prop.maximum != null && num > prop.maximum) errors[key] = `不能大于 ${prop.maximum}`
    }
  }

  return { ok: Object.keys(errors).length === 0, errors }
}
