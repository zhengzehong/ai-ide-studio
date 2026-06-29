import type { EventCategoryRow } from '../store/event-categories.js'

export interface EventCategorySchemaProperty {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  'x-list'?: boolean
  'x-filter'?: boolean
}

export interface EventCategorySchema {
  type?: string
  properties?: Record<string, EventCategorySchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

export function parseCategorySchema(category: EventCategoryRow | undefined | null): EventCategorySchema {
  if (!category) return {}
  try {
    const parsed: unknown = JSON.parse(category.schema_json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as EventCategorySchema
  } catch {
    return {}
  }
}

export function schemaPropertyDefault(schema: EventCategorySchema, key: string): unknown {
  const property = schema.properties?.[key]
  if (!property) return undefined
  if (!Object.prototype.hasOwnProperty.call(property, 'default')) return undefined
  return property.default
}

export function schemaDefaults(schema: EventCategorySchema): Record<string, unknown> {
  const properties = schema.properties
  if (!properties) return {}
  const defaults: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(properties)) {
    if (!property) continue
    if (!Object.prototype.hasOwnProperty.call(property, 'default')) continue
    defaults[key] = property.default
  }
  return defaults
}

export function schemaRequiredFields(schema: EventCategorySchema): string[] {
  return Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
}

export function isPayloadValuePresent(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

export function filterablePayloadFields(category: EventCategoryRow | undefined): Set<string> {
  const schema = parseCategorySchema(category)
  const properties = schema.properties
  if (!properties) return new Set()
  const fields = new Set<string>()
  for (const [key, property] of Object.entries(properties)) {
    if (property && property['x-filter'] === true) fields.add(key)
  }
  return fields
}
