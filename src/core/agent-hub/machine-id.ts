import { randomUUID } from 'node:crypto'
import { settingsStore } from '../../store/settings.js'

let cachedMachineId: string | undefined
let generating: Promise<string> | undefined

export async function getOrCreateMachineId(): Promise<string> {
  if (cachedMachineId) return cachedMachineId
  if (generating) return generating
  generating = (async () => {
    let id = settingsStore.get('machineId')
    if (!id) {
      id = `mac-${randomUUID().slice(0, 8)}`
      settingsStore.set('machineId', id)
    }
    cachedMachineId = id
    return id
  })()
  try {
    return await generating
  } finally {
    generating = undefined
  }
}

export function getMachineLabel(): string | undefined {
  return process.env.AGENT_HUB_MACHINE_LABEL || undefined
}

export function resetCachedMachineIdForTest(): void {
  cachedMachineId = undefined
  generating = undefined
}
