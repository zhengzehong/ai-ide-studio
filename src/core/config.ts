import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

export interface AppConfig {
  port: number
  dataDir: string
  anthropicApiKey?: string
  openaiApiKey?: string
  googleApiKey?: string
}

export function loadConfig(): AppConfig {
  loadDotenv()

  return {
    port: parseInt(process.env.PORT || '18800', 10),
    dataDir: resolve(process.env.DATA_DIR || './data'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    googleApiKey: process.env.GOOGLE_API_KEY || undefined,
  }
}
