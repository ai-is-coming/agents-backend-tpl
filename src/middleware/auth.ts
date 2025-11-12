import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import { createLogger } from '../utils/logger'

const log = createLogger('auth')

// Whitelist paths that don't require authentication
const WHITELIST_PATHS = [
  '/auth/login',
  '/docs',
  '/docs.json',
  '/',
]

/**
 * Authentication middleware
 * Checks Bearer token in Authorization header
 * Whitelist paths don't require authentication
 */
export function authMiddleware(): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const path = new URL(c.req.url).pathname

    // Check if path is in whitelist
    if (WHITELIST_PATHS.includes(path)) {
      return next()
    }

    // Get Authorization header
    const authHeader = c.req.header('Authorization')

    if (!authHeader) {
      log.warn({ path }, 'Missing Authorization header')
      return c.json({ error: 'Unauthorized: Missing Authorization header' }, 401)
    }

    // Check Bearer token format
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      log.warn({ path, authHeader }, 'Invalid Authorization header format')
      return c.json({ error: 'Unauthorized: Invalid Authorization header format' }, 401)
    }

    const token = parts[1]

    // For now, just check that token is not empty
    if (!token || token.trim() === '') {
      log.warn({ path }, 'Empty token')
      return c.json({ error: 'Unauthorized: Empty token' }, 401)
    }

    // Store token in context for later use
    c.set('token', token)

    log.info({ path, token }, 'Authentication successful')

    await next()
  })
}

