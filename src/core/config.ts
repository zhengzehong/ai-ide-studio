import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

export type AppRuntime = 'web' | 'electron'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  runtime: AppRuntime
  staticDir?: string
  mobileStaticDir?: string
  localToken?: string
  anthropicApiKey?: string
  openaiApiKey?: string
  googleApiKey?: string
}

export function loadConfig(): AppConfig {
  loadDotenv()
  const runtime = parseRuntime(process.env.AI_IDE_RUNTIME)

  return {
    host: process.env.HOST || defaultHost(runtime),
    port: parseInt(process.env.PORT || '18800', 10),
    dataDir: resolve(process.env.DATA_DIR || './data'),
    runtime,
    staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : resolve('./ui/dist'),
    mobileStaticDir: process.env.MOBILE_STATIC_DIR ? resolve(process.env.MOBILE_STATIC_DIR) : resolve('./mobile/dist'),
    localToken: process.env.AI_IDE_LOCAL_TOKEN || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    googleApiKey: process.env.GOOGLE_API_KEY || undefined,
  }
}

function parseRuntime(value: string | undefined): AppRuntime {
  return value === 'electron' ? 'electron' : 'web'
}

function defaultHost(runtime: AppRuntime): string {
  return runtime === 'electron' ? '127.0.0.1' : '0.0.0.0'
}
