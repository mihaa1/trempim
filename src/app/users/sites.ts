import { remult } from 'remult'
import { Roles } from './roles'
import { taskStatus } from '../events/taskStatus'
import { UpdateMessage } from '../events/UpdatesChannel'
import { DriverCanceledAssign } from '../events/tasks'

let title = ''
export function getTitle() {
  if (title) return title
  if (typeof localStorage !== 'undefined') return (title = document.title)
  return getBackendSite()!.title
}

export class Site {
  deliveryCaption: string | undefined
  allDeliveryRequestsAreApprovedAutomatically = false
  taskTitleCaption?: string
  defaultLinkDescription = `כאן תוכלו להתעדכן ולסייע בהסעת חיילים, מפונים וציוד`
  showContactToAnyDriver = false
  showValidUntil = false
  getIntroText() {
    return `ברוכים הבאים לאפליקציית השינועים של ${getTitle()}.

כאן תוכלו להתעדכן באירועי שינוע ולסייע בהסעת חיילים לבסיסים, בשינוע ציוד לחיילים או בשינועים שונים הנדרשים לכוחות העורף.

המענה שלכם יסייע באופן משמעותי למאמץ המלחמתי כעוגן האזרחי של ישראל.

${
  this.registerVolunteerLink
    ? `

עוד לא נרשמתם? [לחצו כאן להרשמה ונאשר אתכם במהרה](${this.registerVolunteerLink})

`
    : ''
}
צאו לעשות חסדים!`
  }
  constructor(public urlPrefix: string) {}
  onlyAskForSecondAddress = false
  countUpdates = true
  useFillerInfo = false
  allowAnyVolunteerToAdd? = false
  sendSmsOnNewDraft = false
  registerVolunteerLink?: string
  messageBySnif = false
  showInfoSnackbarFor(message: UpdateMessage) {
    return true
  }

  soldiersDelivery = 'שינוע חיילים'
  bikeDelivery = 'שינוע באופנוע'

  bikeCategoryCaption?: string
  defaultCategory = this.soldiersDelivery
  truckCategoryCaption?: string
  categories: string[] = [
    this.soldiersDelivery,
    'שינוע ציוד',
    'שינוע מזון',
    'שינוע ברכב מסחרי . נגרר',
    'שינוע במשאית',
    'מתאים גם לאופנוע',
    'שינוע רכב',
    'אחר',
  ]
  showCopyLink?: boolean
  imageIsMandatory?: boolean
  showTwoContacts = true
  fromAddressName?: string
  toAddressName?: string
  addressInstructions?: string
  driverCanMarkAsNonRelevant = true
  get canSeeUrgency() {
    return true
  }
  onlyCities = false
  syncWithMonday = false
  showPastEvents = true
}

export class BikeIlSite extends Site {
  override bikeCategoryCaption = 'שינוע באופנוע'
  override defaultCategory = this.bikeCategoryCaption
  override truckCategoryCaption? = 'שינוע מסחרי או נגרר'
  override categories = [
    this.bikeCategoryCaption!,
    this.truckCategoryCaption!,
    'רכב פרטי',
    'אחר',
  ]
  override showCopyLink? = true
  override imageIsMandatory? = true
  override useFillerInfo = true
  override allowAnyVolunteerToAdd = true
  override sendSmsOnNewDraft = true
}

export class AnyoneCanAddRequest_VolunteerCantSelfRegister extends Site {
  override showCopyLink? = true
  override allowAnyVolunteerToAdd = true
  override sendSmsOnNewDraft = true
  override useFillerInfo = true
}
export class Hahatul extends AnyoneCanAddRequest_VolunteerCantSelfRegister {
  override registerVolunteerLink =
    'https://wa.me/972545276812?text=' +
    encodeURI('שלום, אני מעוניין להצטרף כנהג מתנדב - שמי הוא: ')
}
export class Civil extends Site {
  override showContactToAnyDriver = true
  override showValidUntil = true
  override getIntroText(): string {
    return `נהגים מתנדבי טרמפים, ברוכים הבאים למערכת החדשה,

אם טרם נרשמתם כנהגים, [אנא מלאו את הטופס פה](https://docs.google.com/forms/d/1tCBQchGqgjU7a604BduE-MFGWtiutdOTTfFW4TpKc2U)

אם נרשמתם כבר, אמורים להתקשר אליכם לאימות נתונים.

מספר שעות לאחר האימות, פרטיכם יוזנו למערכת, ואז מסי הטלפון שלכם יוכר. מכאן ואילך, לאחר אימות SMS, תוכלו לחפש בקשות מתאימות, ולממש את רוח ההתנדבות שלכם.
יש  בעיות? דווחו בקבוצת הוואטסאפ "טרמפים+ כלל הארץ". הצטרפות לקבוצה הנ"ל - https://bit.ly/3Q7HJ2R`
  }
  override showCopyLink? = true
  override allowAnyVolunteerToAdd = true
  override useFillerInfo = true
  override allDeliveryRequestsAreApprovedAutomatically = true
  override deliveryCaption = 'הסעת חיילים'
  override defaultCategory = this.deliveryCaption
  override registerVolunteerLink =
    'https://docs.google.com/forms/d/1tCBQchGqgjU7a604BduE-MFGWtiutdOTTfFW4TpKc2U'
  override categories = [
    this.defaultCategory!,
    'הסעת מפונים',
    'הסעות אחר',
    'שינוע ציוד',
    'שינוע אוכל חם',
    'אחר',
  ]
  override showPastEvents = false
  override defaultLinkDescription = 'החמל האזרחי, מערכת ניהול טרמפים'
}
export class WarRoomCars extends Site {
  override showCopyLink? = true
  override allowAnyVolunteerToAdd = true
  override useFillerInfo = true
  override driverCanMarkAsNonRelevant = false
  override defaultCategory = 'שינוע ציוד'
  override syncWithMonday = true
  override registerVolunteerLink = `https://forms.monday.com/forms/2ecb222fecfb8b8d7404f754362d2c6d?r=euc1`
}
export class Showers extends Site {
  override taskTitleCaption = 'כמה חיילים? *'
  override onlyAskForSecondAddress = true
  override defaultCategory = 'מקלחות ניידות'
  override categories = [
    this.defaultCategory,
    'רכב גורר עד 1.5 טון',
    'רכב גורר עד 3.5 טון',
  ]
}

export class vdri extends Site {
  override showCopyLink? = true
  override allowAnyVolunteerToAdd = true
  override showTwoContacts = false
  override fromAddressName = 'ישוב מוצא'
  override toAddressName = 'ישוב יעד'
  override addressInstructions? =
    'אין למלא כתובות מדויקות או בסיסים, יש לרשום רק את העיר.'
  override onlyCities = true
}
export class Yedidim extends Site {
  override countUpdates = false
  override messageBySnif = true
  override get canSeeUrgency() {
    return remult.isAllowed(Roles.admin)
  }
  override getIntroText(): string {
    return `ברוכים הבאים למערכת השינועים של ידידים!

כאן תוכלו להתעדכן באירועי שינוע ולסייע בהסעת חיילים לבסיסים, בשינוע ציוד לחיילים או בשינועים שונים הנדרשים לכוחות העורף.

המענה שלכם יסייע באופן משמעותי למאמץ המלחמתי כעוגן האזרחי של ישראל.

${
  this.registerVolunteerLink
    ? `

עוד לא נרשמתם? [לחצו כאן להרשמה ונאשר אתכם במהרה](${this.registerVolunteerLink})

`
    : ''
}

במידה ונתקלתם בבעיה בהתחברות למערכת יש לפנות למנהל הסניף, או להתקשר למוקד הכוננים במספר [077-600-1230](tel:077-600-1230) שלוחה 1.

צאו לעשות חסדים!`
  }

  override registerVolunteerLink = 'https://forms.gle/E4DGSCtEgfSYfJvy9'
  override showInfoSnackbarFor(message: UpdateMessage): boolean {
    if (message.userId === remult.user?.id) return false
    if ([DriverCanceledAssign].includes(message.action)) return true
    if (
      [taskStatus.draft, taskStatus.otherProblem]
        .map((x) => x.id)
        .includes(message.status)
    )
      return true
    return false
  }
}

export function initSite(site?: string) {
  if (!site && typeof document !== 'undefined') {
    //@ts-ignore
    site = document.site
    if (site === '!!!ORG!!!') {
      //@ts-ignore
      site = document.location.pathname.split('/')[1]
    }
  }
  remult.context.site = new Site(site!)
  switch (site) {
    case 'bikeil':
      remult.context.site = new BikeIlSite(site)
      break
    case 'hahatul':
      remult.context.site = new Hahatul(site)
      break
    case 'dshinua':
    case 'ngim':
    case 'mgln':
    case 'teva':
      remult.context.site = new AnyoneCanAddRequest_VolunteerCantSelfRegister(
        site
      )
      break
    case 'civil':
      remult.context.site = new Civil(site)
      break
    case 'vdri':
      remult.context.site = new vdri(site)
      break
    case 'yedidim':
    case 'ezion':
    case 'y':
      remult.context.site = new Yedidim(site)
      break
    case 'wrc':
    case 'test1':
      remult.context.site = new WarRoomCars(site)
      break

    case 'showers':
      remult.context.site = new Showers(site)
      break
  }
}

export function getSite() {
  return remult.context.site || new Site('')
}

export const backendSites = [
  {
    urlPrefix: 'dshinua',
    dbSchema: 'dshinua',
    title: 'שינוע - הדגמה',
    ignore: true,
  },
  {
    urlPrefix: 'hahatul',
    dbSchema: 'hahatul',
    title: 'עמותת החתול – בוגרי 669',
  },
  { urlPrefix: 'lev1', dbSchema: 'lev1', title: 'לב אחד שינועים' },
  { urlPrefix: 'bikeil', dbSchema: 'bikeil', title: 'חמל אופנועים' },
  { urlPrefix: 'vdri', dbSchema: 'vdri', title: 'חמ"ל נהגים מתנדבים ארצי' },
  { urlPrefix: 'y', dbSchema: 'ezion', title: 'ידידים' },
  { urlPrefix: 'ezion', dbSchema: 'ezion', title: 'ידידים', ignore: true },
  { urlPrefix: 'brdls', dbSchema: 'brdls', title: 'ברדלס' },
  { urlPrefix: 'ngim', dbSchema: 'ngim', title: 'חמל נהגים' },
  { urlPrefix: 'mgln', dbSchema: 'mgln', title: 'ידידי מגלן' },
  { urlPrefix: 'test1', dbSchema: 'ezion', title: 'פיתוח', ignore: true },
  { urlPrefix: 'wrc', dbSchema: 'wrc', title: 'אופנוענים ונהגים מתנדבים' },
  { urlPrefix: 'showers', dbSchema: 'showers', title: 'מקלחות ניידות לשטח' },
  { urlPrefix: 'civil', dbSchema: 'civil', title: 'החמל האזרחי' },
  { urlPrefix: 'teva', dbSchema: 'teva', title: 'תופעת טבע' },
]
export function getBackendSite(schema?: string) {
  if (!schema) schema = getSite().urlPrefix
  const result = backendSites.find((x) => x.urlPrefix === schema)
  return result!
}

export function getSiteFromPath(req: { path: string }) {
  return req.path.split('/')[1]
}
