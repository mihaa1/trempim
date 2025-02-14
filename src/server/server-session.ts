import { UserInfo, remult, repo } from 'remult'
import type { Request } from 'express'
import type from 'cookie-session' //needed for build - do not remove
import { User } from '../app/users/user'
import { Site, getSite } from '../app/users/sites'
import { Roles } from '../app/users/roles'
import { createId } from '@paralleldrive/cuid2'

declare module 'remult' {
  export interface RemultContext {
    session: CookieSessionInterfaces.CookieSessionObject
    sessionOptions: CookieSessionInterfaces.CookieSessionOptions
    sessionId: string
    origin: string
    site: Site
  }
}

export async function initRequestUser(req: Request) {
  remult.context.session = req.session!
  remult.context.sessionOptions = req.sessionOptions
  remult.context.sessionId =
    req.session!['sessionID'] || (req.session!['sessionID'] = createId())

  const sessionUser = req.session!['user']
  if (!sessionUser || !sessionUser.id) return
  const user = await repo(User).findFirst({
    id: sessionUser!.id,
    deleted: false,
  })
  setSessionUserBasedOnUserRow(user)
}

export function setSessionUser(user: UserInfo, remember?: boolean): UserInfo {
  const current = remult.context.session['user']
  if (JSON.stringify(user) != JSON.stringify(current))
    remult.context.session['user'] = user
  if (remember) remult.context.sessionOptions.maxAge = 365 * 24 * 60 * 60 * 1000 //remember for a year
  remult.user = user
  return user
}

export function setSessionUserBasedOnUserRow(user: User, remember?: boolean) {
  if (!user) {
    return setSessionUser(undefined!, true)
  }
  const roles: string[] = []
  if (user.admin) {
    roles.push(Roles.admin)
    roles.push(Roles.dispatcher)
    roles.push(Roles.trainee)
    roles.push(Roles.manageDrivers)
  } else if (user.dispatcher) {
    roles.push(Roles.dispatcher)
    roles.push(Roles.trainee)
  } else if (user.trainee) roles.push(Roles.trainee)
  if (user.manageDrivers) roles.push(Roles.manageDrivers)
  if (
    (getSite().urlPrefix === 'dshinua' || getSite().urlPrefix === 'test1') &&
    user.admin &&
    ['0507330590', '0523307014'].includes(user.phone)
  )
    roles.push(Roles.superAdmin)
  return setSessionUser(
    {
      id: user.id,
      name: user.name,
      phone: user.phone,
      roles,
      allowedCategories: user.allowedCategories,
    },
    remember
  )
}
