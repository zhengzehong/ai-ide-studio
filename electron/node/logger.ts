import pino from 'pino'

const logger = pino({ level: 'info' }, pino.destination(2))
export function createChildLogger(module: string): pino.Logger {
  return logger.child({ module: `desktop-node:${module}` })
}
