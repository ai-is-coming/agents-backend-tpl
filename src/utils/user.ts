import { prisma } from '../db/prisma'
import { createLogger } from './logger'

const log = createLogger('user')

export async function getOrCreateUserByToken(c: any) {
  const token = c.get('token') as string | undefined
  if (!token) {
    throw new Error('Unauthorized: missing token')
  }
  const email = token
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    log.info({ email }, 'creating user from token')
    user = await prisma.user.create({ data: { email } })
  }
  return user
}

