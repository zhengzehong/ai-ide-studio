import pino from 'pino'
import { resolve } from 'path'
import { mkdirSync } from 'fs'

const logLevel = process.env.LOG_LEVEL ?? 'debug'
const logDir = resolve(process.env.LOG_DIR ?? process.env.DATA_DIR ?? './data', 'logs')
mkdirSync(logDir, { recursive: true })

const logFile = resolve(logDir, 'app.log')

const isDev = process.env.NODE_ENV !== 'production'

const transport = isDev
  ? {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
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
})

export function createChildLogger(module: string) {
  return logger.child({ module })
}
