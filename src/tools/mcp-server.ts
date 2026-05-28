#!/usr/bin/env node
import { resolve } from 'node:path'
import { initDatabase } from '../store/db.js'
import { loadConfig } from '../core/config.js'
import { startToolGateway } from './tool-gateway.js'

const config = loadConfig()
initDatabase(resolve(config.dataDir, 'ai-ide.sqlite'))
await startToolGateway()
