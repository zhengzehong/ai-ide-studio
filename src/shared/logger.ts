import pino from 'pino'
import { resolve } from 'path'
import { mkdirSync } from 'fs'

const logLevel = process.env.LOG_LEVEL ?? 'debug'
const logDir = process.env.LOG_DIR
  ? resolve(process.env.LOG_DIR)
  : resolve(process.env.DATA_DIR ?? './data', 'logs')
mkdirSync(logDir, { recursive: true })

const logFile = resolve(logDir, 'app.log')

const isDev = process.env.NODE_ENV !== 'production'

const transport = isDev
  ? {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          level: logLevel as pino.Level,
        },
        {
          target: 'pino-roll',
          options: { file: logFile, frequency: 'daily', limit: { count: 14 }, mkdir: true },
          level: logLevel as pino.Level,
        },
      ],
    }
  : {
      targets: [
        { target: 'pino/file', options: { destination: 1 }, level: logLevel as pino.Level },
        {
          target: 'pino-roll',
          options: { file: logFile, frequency: 'daily', limit: { count: 30 }, mkdir: true },
          level: logLevel as pino.Level,
        },
      ],
    }

export const logger = pino({
  level: logLevel,
  transport,
  redact: ['*.password', '*.token', '*.apiKey', '*.secret', 'req.headers.authorization'],
  timestamp: () => `,"time":${Date.now()}`,
})

export function createChildLogger(module: string) {
  return logger.child({ module })
}

export function getLogConfig(): { logLevel: string; logDir: string; logFile: string; nodeEnv: string } {
  return {
    logLevel,
    logDir,
    logFile,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  }
}
