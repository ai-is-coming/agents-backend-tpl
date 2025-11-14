import { prisma } from '../db/prisma'
import type { AppContext } from '../types/hono'
import { createLogger } from './logger'

const log = createLogger('user')

export async function getOrCreateUserByToken(c: AppContext) {
  const token = c.get('token')
  if (!token) {
    throw new Error('Unauthorized: missing token')
  }
  const email = token
  let user = await prisma.users.findUnique({ where: { email } })
  if (!user) {
    log.info({ email }, 'creating user from token')
    user = await prisma.users.create({ data: { email } })
  }
  return user
}
