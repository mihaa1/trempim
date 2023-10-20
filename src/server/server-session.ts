import { UserInfo, remult, repo } from 'remult'
import type { Request } from 'express'
import type from 'cookie-session' //needed for build - do not remove
import { User } from '../app/users/user'
import { Site } from '../app/users/sites'

declare module 'remult' {
  export interface RemultContext {
    session: CookieSessionInterfaces.CookieSessionObject
    sessionOptions: CookieSessionInterfaces.CookieSessionOptions
    site: Site
  }
}

export async function initRequest(req: Request) {
  remult.context.session = req.session!
  remult.context.sessionOptions = req.sessionOptions
  const user = req.session!['user']
  if (user && (await repo(User).findFirst({ id: [user.id], deleted: false })))
    remult.user = user
}

export function setSessionUser(user: UserInfo, remember: boolean): UserInfo {
  remult.context.session['user'] = user
  if (remember) remult.context.sessionOptions.maxAge = 365 * 24 * 60 * 60 * 1000 //remember for a year
  remult.user = user
  return user
}
