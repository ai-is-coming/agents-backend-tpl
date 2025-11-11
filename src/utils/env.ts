/* Environment variable logger with masking for sensitive values */

import * as MaskData from 'maskdata'
import { createLogger } from './logger'

const log = createLogger('env')

const SENSITIVE_KEYWORDS = [
  'KEY',
  'SECRET',
  'PASSWORD',
  'PWD',
  'PASS',
  'TOKEN',
  'AUTH',
  'CREDENTIAL',
  'COOKIE',
  'SESSION',
  'PRIVATE',
]

const maskOptions = {
  maskWith: '*',
  // Show a small portion of start/end characters; mask the middle
  unmaskedStartCharacters: 2,
  unmaskedEndCharacters: 2,
  // Cap the number of masking characters to keep logs readable
  maxMaskedCharacters: 64,
}

function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase()
  return SENSITIVE_KEYWORDS.some((kw) => upper.includes(kw))
}

export function logEnvOnStartup(): void {
  try {
    log.info('--- Environment variables ---')
    const keys = Object.keys(process.env).sort((a, b) => a.localeCompare(b))
    for (const key of keys) {
      const raw = process.env[key] ?? ''
      const value = String(raw)
      const masked = isSensitiveKey(key)
        ? MaskData.maskPassword(value, maskOptions)
        : value
      log.info(`${key}=${masked}`)
    }
    log.info('--- End environment variables ---')
  } catch (err) {
    // Do not fail app startup because of logging issues
    log.warn({ err }, 'failed to print environment variables')
  }
}

