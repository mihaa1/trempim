import copy from 'copy-to-clipboard'
import {
  Allow,
  AllowedForInstance,
  BackendMethod,
  Entity,
  EntityFilter,
  Field,
  FieldOptions,
  Fields,
  IdEntity,
  Relations,
  SqlDatabase,
  Validators,
  ValueConverters,
  remult,
  repo,
} from 'remult'
import {
  DataControl,
  GridSettings,
  RowButton,
} from '../common-ui-elements/interfaces'

import moment from 'moment'
import { UITools } from '../common/UITools'
import {
  GeocodeResult,
  GetDistanceBetween,
  getCity,
  getLocation,
  updateGeocodeResult,
} from '../common/address-input/google-api-helpers'
import { Roles } from '../users/roles'
import { getSite, getTitle } from '../users/sites'
import { User } from '../users/user'

import { TaskImage } from './TaskImage'
import { TaskStatusChanges } from './TaskStatusChanges'
import { CreatedAtField, DateField, formatDate } from './date-utils'
import { Locks } from './locks'
import {
  PhoneField,
  TaskContactInfo,
  formatPhone,
  phoneConfig,
  sendWhatsappToPhone,
} from './phone'
import { taskStatus } from './taskStatus'
import { Urgency } from './urgency'
import { updateChannel } from './UpdatesChannel'
import { sendSms } from '../../server/send-sms'
import { _DisposeViewRepeaterStrategy } from '@angular/cdk/collections'
import { update } from '../../server/getGraphQL'
import {
  ACTIVE_DELIVERY,
  DELIVERY_DONE,
  NO_PACK_READY_FOR_DELIVERY,
  PACKED_READY_FOR_DELIVERY,
  updateDriverOnMonday,
  updateStatusOnMonday,
} from '../../server/monday-work'

const onlyDriverRules: FieldOptions<Task, string> = {
  includeInApi: (t) => {
    if (remult.user) {
      if (remult.isAllowed([Roles.trainee, Roles.dispatcher])) return true
      if (
        t!.createUserId === remult.user?.id &&
        remult.isAllowed(Roles.trainee)
      )
        return true
      if (getSite().showContactToAnyDriver) return true
      if (t!.driverId === remult.user.id) return true
    }
    if (t!.isNew()) return true
    return false
  },
  allowApiUpdate: (t) => {
    if (remult.user) {
      if (remult.isAllowed([Roles.trainee, Roles.dispatcher])) return true
      if (
        t!.createUserId === remult.user?.id &&
        remult.isAllowed(Roles.trainee)
      )
        return true
    }
    if (t!.isNew()) return true
    return false
  },
}

@Entity<Task>('tasks', {
  allowApiInsert: true,
  allowApiUpdate: (t) => {
    if (t!.taskStatus === taskStatus.draft)
      return remult.isAllowed([Roles.trainee, Roles.dispatcher])
    return remult.isAllowed(Roles.dispatcher)
  },
  allowApiRead: Allow.authenticated,
  allowApiDelete: false,
  saving: async (task) => {
    if (!remult.user && task.isNew()) {
      const user = await repo(User).findFirst({
        phone: '0500000000',
        deleted: false,
      })
      if (!user) {
        throw new Error('לא ניתן להוסיף בקשות חדשות')
      }
      remult.user = { id: user.id }
      task.createUserId = remult.user.id
    }
    if (
      !remult.isAllowed(Roles.dispatcher) &&
      task.isNew() &&
      !getSite().allDeliveryRequestsAreApprovedAutomatically
    )
      task.taskStatus = taskStatus.draft
    if (task.$.taskStatus.valueChanged()) task.statusChangeDate = new Date()
    if (task.isNew() && !task.externalId)
      task.externalId = (
        await SqlDatabase.getDb().execute("select nextval('task_seq')")
      ).rows[0].nextval
    if (
      task.$.eventDate.valueChanged() ||
      task.$.startTime.valueChanged() ||
      task.$.relevantHours.valueChanged()
    ) {
      task.validUntil = calcValidUntil(
        task.eventDate,
        task.startTime,
        task.relevantHours
      )
    }
    if (task.imageId?.includes('data:image/')) {
      task.imageId = (await repo(TaskImage).insert({ image: task.imageId })).id
    }
    for (const f of [task.$.createUserId, task.$.driverId]) {
      if (f.value === null) f.value = f.originalValue
    }
    for (const f of [task.$.addressApiResult, task.$.toAddressApiResult]) {
      if (f.valueChanged()) await updateGeocodeResult(f.value)
      task.distance = parseFloat(
        GetDistanceBetween(
          getLocation(task.addressApiResult),
          getLocation(task.toAddressApiResult)
        ).toFixed(1)
      )
    }
  },
  saved: async (task, { isNew }) => {
    if (isNew) {
      await task.insertStatusChange('יצירה')
      if (task.taskStatus === taskStatus.draft && getSite().sendSmsOnNewDraft) {
        for (const user of await repo(User).find({
          where: { dispatcher: true },
        })) {
          sendSms(
            user.phone,
            'נוספה בקשה: ' +
              task.getShortDescription() +
              '\n\n' +
              remult.context.origin +
              '/טיוטות'
          )
        }
      }
    }
    if (getSite().syncWithMonday && task.externalId.startsWith('m:')) {
      if (task.$.taskStatus.valueChanged()) {
        switch (task.taskStatus) {
          case taskStatus.active:
          case taskStatus.assigned:
            updateStatusOnMonday(
              task,
              task.returnMondayStatus === NO_PACK_READY_FOR_DELIVERY
                ? task.returnMondayStatus
                : PACKED_READY_FOR_DELIVERY
            )
            break
          case taskStatus.driverPickedUp:
            updateStatusOnMonday(task, ACTIVE_DELIVERY)
            break
          case taskStatus.completed:
            updateStatusOnMonday(task, DELIVERY_DONE)
            break
        }
      }
      if (task.$.driverId.valueChanged()) {
        if (task.driverId) {
          await updateDriverOnMonday(task)
        }
      }
    }
  },
  validation: (task) => {
    if (phoneConfig.disableValidation || task.__disableValidation) return
    if (!task.addressApiResult?.results && !getSite().onlyAskForSecondAddress)
      task.$.address.error = 'כתובת לא נמצאה'
    if (!task.toAddressApiResult?.results)
      task.$.toAddress.error = 'כתובת לא נמצאה'
  },
  //@ts-ignore
  apiPrefilter: () => {
    if (remult.isAllowed(Roles.dispatcher)) return {}
    if (remult.isAllowed(Roles.trainee))
      return {
        $or: [
          {
            taskStatus: taskStatus.draft,
            createUser: remult.user!.id,
          },
          Task.filterActiveTasks(),
        ],
      }

    // {
    //   $or: [
    //     { draft: true, createUser: remult.user!.id },
    //     Task.filterActiveTasks,
    //   ],
    // }
    return Task.filterActiveTasks()
  },
})
export class Task extends IdEntity {
  __disableValidation = false
  sendWhatsappInvite() {
    sendWhatsappToPhone(
      this.driver?.phone!,
      `שלום ${this.driver?.name || ''}, קיבלת נסיעה חדשה מ "${getTitle()}"
${this.getShortDescription()}
${this.getLink()}`
    )
  }

  getShortDescription(): string {
    let message = ''
    if (this.category) message = this.category + ': '
    if (this.title) message += this.title + ' '
    if (this.addressApiResult?.results?.length)
      message += 'מ' + getCity(this.addressApiResult!, this.address)
    if (this.toAddressApiResult?.results?.length)
      message += ' ל' + getCity(this.toAddressApiResult, this.toAddress)
    return message + ` (${this.externalId})`
  }
  displayDate() {
    const e = this
    let result = eventDisplayDate(e)
    if (e.startTime) {
      let time = e.startTime
      if (time.startsWith('0')) time = time.substring(1)
      result += ' ' + time
    }
    if (getSite().showValidUntil)
      if (e.validUntil.getDate() == e.eventDate.getDate()) {
        result +=
          ' - ' +
          e.validUntil.getHours() +
          ':' +
          e.validUntil.getMinutes().toString().padStart(2, '0')
      }

    return 'רלוונטי מ: ' + result
  }
  static filterActiveTasks(): EntityFilter<Task> {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return {
      taskStatus: { $ne: taskStatus.draft },
      $or: [
        {
          taskStatus: taskStatus.active,
        },
        {
          driverId: remult.user!.id!,
          taskStatus: [taskStatus.assigned, taskStatus.driverPickedUp],
        },
        { driverId: remult.user!.id!, statusChangeDate: { $gte: d } },
      ],
    }
  }

  @Fields.string<Task>({
    caption: 'מה משנעים *',
    validate: (s, c) => {
      if (s.__disableValidation) return
      Validators.required(s, c)
    },
  })
  title = ''
  @DataControl({ width: '120' })
  @Field(() => taskStatus, { allowApiUpdate: false })
  taskStatus: taskStatus = taskStatus.active
  @DataControl({ width: '120' })
  @DateField({
    allowApiUpdate: false,
    caption: 'סטטוס עדכון אחרון',
    displayValue: (_, d) => formatDate(d),
  })
  statusChangeDate = new Date()
  @Fields.string({
    caption: 'פרטים נוספים',
    customInput: (x) => x.textarea(),
  })
  description = ''
  @DataControl({ visible: () => getSite().canSeeUrgency })
  @Field(() => Urgency)
  urgency = Urgency.normal
  @DataControl({
    valueList: () => getSite().categories.map((x) => ({ id: x, caption: x })),
  })
  @Fields.string({ caption: 'קטגוריה' })
  category: string = getSite().defaultCategory
  @Fields.dateOnly<Task>({
    caption: 'תאריך הסיוע המבוקש',
    validate: (s, c) => {
      if (s.__disableValidation) return
      if (!c.value || c.value.getFullYear() < 2018) c.error = 'תאריך שגוי'
    },
  })
  eventDate: Date = new Date()
  @Fields.string({ inputType: 'time', caption: 'רלוונטי החל משעה' })
  @DataControl({ width: '110' })
  startTime = new Date().toLocaleTimeString('he-il', {
    hour: '2-digit',
    minute: '2-digit',
  })

  @Fields.integer({ caption: 'למשך כמה שעות הסיוע רלוונטי' })
  relevantHours = 12
  @DataControl({ width: '240' })
  @DateField({ caption: 'בתוקף עד', allowApiUpdate: false })
  validUntil = new Date()

  @Fields.json<GeocodeResult>()
  addressApiResult: GeocodeResult | null = null
  @Fields.string({
    caption: 'מיקום מוצא *',
    customInput: (c) =>
      c.inputAddress(
        (result, event: Task) =>
          (event.addressApiResult = result.autoCompleteResult)
      ),
  })
  address = ''

  @Fields.json<GeocodeResult>()
  toAddressApiResult: GeocodeResult | null = null
  @Fields.string({
    caption: 'מיקום יעד *',
    customInput: (c) =>
      c.inputAddress(
        (result, event: Task) =>
          (event.toAddressApiResult = result.autoCompleteResult)
      ),
  })
  toAddress = ''
  @Fields.number()
  distance = 0

  @PhoneField<Task>({
    caption: 'טלפון ממלא הבקשה *',
    ...onlyDriverRules,
    validate: (entity, ref) => {
      if (entity.__disableValidation) return

      if (
        (entity.isNew() || ref.valueChanged()) &&
        getSite().useFillerInfo &&
        !remult.isAllowed(Roles.dispatcher)
      )
        Validators.required(entity, ref)
    },
  })
  requesterPhone1 = !remult.isAllowed(Roles.dispatcher)
    ? remult.user?.phone
    : ''
  @Fields.string({
    caption: 'שם ממלא הבקשה',
    ...onlyDriverRules,
  })
  requesterPhone1Description = !remult.isAllowed(Roles.dispatcher)
    ? remult.user?.name
    : ''

  @PhoneField<Task>({
    caption: 'טלפון מוצא *',
    ...onlyDriverRules,
    validate: (entity, ref) => {
      if (entity.__disableValidation) return
      if (getSite().onlyAskForSecondAddress) return
      if (entity.isNew() || ref.valueChanged()) Validators.required(entity, ref)
    },
  })
  phone1 = ''
  @Fields.string({
    caption: 'איש קשר מוצא',
    ...onlyDriverRules,
  })
  phone1Description = ''
  @DataControl({ visible: () => getSite().showTwoContacts })
  @PhoneField<Task>({
    caption: 'טלפון מוצא 2',
    ...onlyDriverRules,
  })
  phone2 = ''
  @DataControl({ visible: () => getSite().showTwoContacts })
  @Fields.string({
    caption: 'איש קשר מוצא 2',
    ...onlyDriverRules,
  })
  phone2Description = ''
  @PhoneField({
    caption: 'טלפון ליעד',
    validate: (entity, ref) => {
      if (entity.__disableValidation) return

      if (
        (entity.isNew() || ref.valueChanged()) &&
        getSite().onlyAskForSecondAddress
      )
        Validators.required(entity, ref)
    },
    ...onlyDriverRules,
  })
  toPhone1 = ''
  @Fields.string({
    caption: 'איש קשר ליעד',
    ...onlyDriverRules,
  })
  tpPhone1Description = ''
  @DataControl({ visible: () => getSite().showTwoContacts })
  @PhoneField({
    caption: 'טלפון ליעד 2',
    ...onlyDriverRules,
  })
  toPhone2 = ''
  @DataControl({ visible: () => getSite().showTwoContacts })
  @Fields.string({
    caption: 'איש קשר ליעד 2',
    ...onlyDriverRules,
  })
  tpPhone2Description = ''

  @Fields.string({
    caption: 'מידע שיוצג רק לנהג המבצע ולמוקד',
    ...onlyDriverRules,
    customInput: (x) => x.textarea(),
  })
  privateDriverNotes = ''

  @CreatedAtField()
  createdAt = new Date()
  @Fields.string<Task>({
    includeInApi: Roles.dispatcher,
    allowApiUpdate: false,
    caption: 'משתמש מוסיף',
    displayValue: (u) => u.createUser?.name || '',
  })
  createUserId = remult.user?.id!
  @Relations.toOne<Task, User>(() => User, 'createUserId')
  createUser?: User

  @Fields.string({
    allowApiUpdate: false,
    caption: 'נהג',
    displayValue: (u) => u.driver?.name || '',
  })
  driverId = ''
  @Relations.toOne<Task, User>(() => User, 'driverId')
  driver?: User
  @Fields.string({ allowApiUpdate: false })
  statusNotes = ''

  @DataControl<Task>({ visible: (t) => !t.isNew(), width: '70' })
  @Fields.string({ caption: 'מזהה ', allowApiUpdate: false })
  externalId = ''
  @DataControl({
    visible: (t) => remult.isAllowed([Roles.trainee, Roles.dispatcher]),
  })
  @Fields.string({
    caption: 'הערה פנימית לחמ"ל',
    customInput: (x) => x.textarea(),
    includeInApi: Roles.trainee,
  })
  internalComments = ''

  @Fields.string<Task>({
    caption: 'תמונה',
    customInput: (c) => c.image(),
    validate: (_, f) => {
      if (_.__disableValidation) return
      if (getSite().imageIsMandatory && (_.isNew() || f.valueChanged()))
        Validators.required(_, f, 'אנא העלה תמונה')
    },
  })
  imageId = ''

  @Fields.integer<Task>({ includeInApi: false })
  returnMondayStatus = -1

  @BackendMethod({ allowed: Roles.admin })
  static async markTasksForRelevanceCheck(ids: string[]) {
    let i = 0
    for (const task of await repo(Task).find({
      where: { id: ids, taskStatus: taskStatus.active },
    })) {
      await task.markForRelevanceCheck()
      i++
    }
    return i
  }

  @BackendMethod({ allowed: Allow.authenticated })
  async assignToMe(userId?: string) {
    let assignUserId = remult.user!.id
    const assignedChangeType = 'שוייך לנהג'
    if (userId) {
      if ((await repo(User).count({ id: userId })) == 0)
        throw Error('משתמש לא קיים')
      if (userId != remult.user?.id && !remult.isAllowed(Roles.dispatcher))
        throw Error('אינך רשאי לשייך לנהג אחר')
      assignUserId = userId
    } else {
      if (
        (await repo(Task).count({
          driverId: remult.user!.id!,
          taskStatus: [taskStatus.assigned, taskStatus.driverPickedUp],
        })) >= 5
      )
        throw Error('ניתן להרשם במקביל לעד 5 נסיעות')

      if (
        (await repo(TaskStatusChanges).count({
          driverId: remult.user!.id!,
          what: assignedChangeType,
          createdAt: {
            $gt: new Date(new Date().getTime() - 1000 * 60 * 60),
          },
        })) >= 20
      ) {
        throw Error('ניתן להרשם לעד 7 נסיעות בשעה')
      }
    }
    await this._.reload()
    if (this.driverId) throw Error('מתנדב אחר כבר לקח משימה זו')
    this.driverId = assignUserId
    this.taskStatus = taskStatus.assigned
    this.statusNotes = ''
    await this.insertStatusChange(assignedChangeType)
    await this.save()
    return this.getContactInfo()
  }
  async insertStatusChange(what: string, notes?: string) {
    updateChannel.publish({
      status: this.taskStatus.id,
      message: what + ' - ' + this.getShortDescription(),
      userId: remult.user?.id!,
      action: what,
    })
    await repo(TaskStatusChanges).insert({
      taskId: this.id,
      what,
      eventStatus: this.taskStatus,
      notes,
      driverId: this.driverId,
    })
  }
  @Fields.string({
    valueConverter: {
      toDb: (x) => (x == null ? '' : x),
    },
  })
  responsibleDispatcherId = ''
  @Relations.toOne<Task, User>(() => User, 'responsibleDispatcherId')
  responsibleDispatcher?: User

  @BackendMethod({ allowed: Allow.authenticated })
  async cancelAssignment(notes: string) {
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    this.driverId = ''
    this.taskStatus = taskStatus.active
    this.statusNotes = notes
    await this.insertStatusChange(DriverCanceledAssign, notes)
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async noLongerRelevant(notes: string) {
    if (!notes) throw Error('אנא הזן הערות, שנדע מה קרה')
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    this.taskStatus = taskStatus.notRelevant
    this.statusNotes = notes
    await this.insertStatusChange(this.taskStatus.caption, notes)
    await this.save()
  }
  @BackendMethod({ allowed: Roles.dispatcher })
  async returnToDriver() {
    if (!this.driverId) throw Error('לא נמצא נהג')
    this.taskStatus = taskStatus.assigned
    await this.insertStatusChange('מוקדן החזיר לנהג', 'על ידי מוקדן')
    await this.save()
  }
  @BackendMethod({ allowed: Roles.dispatcher })
  async returnToActive() {
    this.driverId = ''
    let action = 'מוקדן החזיר לפעיל'
    if (this.taskStatus == taskStatus.draft) action = 'טיוטה אושרה'
    this.taskStatus = taskStatus.active
    await this.insertStatusChange(action, 'על ידי מוקדן')
    await this.save()
  }
  @BackendMethod({ allowed: Roles.dispatcher })
  async markAsDraft() {
    this.driverId = ''
    this.taskStatus = taskStatus.draft
    await this.insertStatusChange('סמן כטיוטא', 'על ידי מוקדן')
    await this.save()
  }
  @BackendMethod({ allowed: Roles.dispatcher })
  async markForRelevanceCheck() {
    this.taskStatus = taskStatus.relevanceCheck
    await this.insertStatusChange(this.taskStatus.caption)
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async otherProblem(notes: string) {
    if (!notes) throw Error('אנא הזן הערות, שנדע מה קרה')
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    this.taskStatus = taskStatus.otherProblem
    this.statusNotes = notes
    await this.insertStatusChange(this.taskStatus.caption, notes)
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async completed(notes: string) {
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    this.taskStatus = taskStatus.completed
    this.statusNotes = notes
    await this.insertStatusChange(this.taskStatus.caption, notes)
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async completedStatusClickedByMistake() {
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    if (
      (await repo(TaskStatusChanges).count({
        taskId: this.id,
        eventStatus: taskStatus.driverPickedUp,
      })) > 0
    )
      this.taskStatus = taskStatus.driverPickedUp
    else this.taskStatus = taskStatus.assigned
    await this.insertStatusChange('עדכון סטטוס נלחץ בטעות')
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async driverPickedUp() {
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    this.taskStatus = taskStatus.driverPickedUp
    await this.insertStatusChange(this.taskStatus.caption)
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async pickedUpStatusClickedByMistake() {
    if (
      this.driverId != remult.user?.id! &&
      !remult.isAllowed(Roles.dispatcher)
    )
      throw new Error('נסיעה זו לא משוייכת לך')
    this.taskStatus = taskStatus.assigned
    await this.insertStatusChange('נאסף בהצלחה נלחץ בטעות')
    await this.save()
  }
  @BackendMethod({ allowed: Allow.authenticated })
  async getContactInfo(): Promise<TaskContactInfo> {
    if (Roles.dispatcher || this.driverId == remult.user?.id!)
      return {
        origin: [
          {
            phone: this.phone1,
            formattedPhone: formatPhone(this.phone1),
            name: this.phone1Description,
          },
          {
            phone: this.phone2,
            formattedPhone: formatPhone(this.phone2),
            name: this.phone2Description,
          },
        ],

        target: [
          {
            phone: this.toPhone1,
            formattedPhone: formatPhone(this.toPhone1),
            name: this.tpPhone1Description,
          },
          {
            phone: this.toPhone2,
            formattedPhone: formatPhone(this.toPhone2),
            name: this.tpPhone2Description,
          },
        ],
      }
    return {
      origin: [],
      target: [],
    }
  }

  async openEditDialog(ui: UITools, saved?: VoidFunction) {
    const doLocks = !this.isNew()
    if (doLocks)
      try {
        await Locks.lock(this.id, false)
      } catch (err: any) {
        if (remult.isAllowed(Roles.admin)) {
          if (await ui.yesNoQuestion(err.message + ', לפתוח בכל זאת?')) {
            await Locks.lock(this.id, true)
          } else return
        } else {
          ui.error(err.message)
          return
        }
      }

    const e = this.$
    ui.areaDialog({
      title: 'פרטי נסיעה',
      fields: [
        [e.category!, e.urgency],
        e.title,
        e.address,
        e.toAddress,
        e.description,
        e.privateDriverNotes,
        [e.eventDate, e.startTime, e.relevantHours],
        ...(getSite().useFillerInfo
          ? [[e.requesterPhone1, e.requesterPhone1Description]]
          : []),
        [e.phone1, e.phone1Description],
        [e.phone2, e.phone2Description],
        [e.toPhone1, e.tpPhone1Description],
        [e.toPhone2, e.tpPhone2Description],

        e.imageId,
        e.internalComments,
        e.externalId,
      ],
      ok: () =>
        this.save().then(() => {
          saved?.()
          if (doLocks) Locks.unlock(this.id)
        }),
      cancel: () => {
        this._.undoChanges()
        if (doLocks) Locks.unlock(this.id)
      },
      buttons: [],
    })
  }

  static rowButtons(
    ui: UITools,
    args?: {
      taskAdded?: (t: Task) => void
      taskSaved?: (t: Task) => void
    }
  ): RowButton<Task>[] {
    return [
      {
        name: 'ערוך נסיעה',
        icon: 'edit',
        click: async (e) => {
          e.openEditDialog(ui, () => args?.taskSaved?.(e))
        },
      },
      {
        name: 'העתק הודעה לווטסאפ',
        icon: 'content_copy',
        visible: (x) => x.taskStatus === taskStatus.active,
        click: (e) => {
          copy(e.getShortDescription() + '\n' + e.getLink())
          ui.info('הקישור הועתק ללוח, ניתן לשלוח בקבוצה')
        },
      },
      {
        name: 'שלח ווטסאפ לנהג',
        icon: 'sms',
        visible: (x) =>
          [taskStatus.driverPickedUp, taskStatus.assigned].includes(
            x.taskStatus
          ),
        click: async (e) => {
          if (!e.driver) {
            e.driver = await e._.relations.driver.findOne()
          }
          e.sendWhatsappInvite()
        },
      },

      {
        name: 'בחר נהג',
        icon: 'directions_car',
        visible: (x) => x.taskStatus === taskStatus.active,
        click: async (e) => {
          ui.selectUser({
            onSelect: async (user) => {
              await e.assignToMe(user.id)
              if (await ui.yesNoQuestion('שלח הודעת ווטסאפ לנהג?')) {
                e.sendWhatsappInvite()
              }
            },
          })
        },
      },

      {
        name: 'היסטוריה',
        icon: 'history_edu',
        click: async (e) => {
          ui.gridDialog({
            settings: new GridSettings(repo(TaskStatusChanges), {
              where: {
                taskId: e.id,
              },
              include: {
                createUser: true,
                driver: true,
              },
              rowButtons: [
                {
                  name: 'פרטי מבצע',
                  click: (e) =>
                    ui.showUserInfo({ userId: e.createUserId, title: 'מבצע' }),
                },
                {
                  name: 'פרטי נהג',
                  icon: 'local_taxi',
                  visible: (e) => !!e.driverId,
                  click: (e) =>
                    ui.showUserInfo({ userId: e.driverId, title: 'נהג' }),
                },
              ],

              columnSettings: (x) => [
                { field: x.what, width: '130' },
                { field: x.driverId, getValue: (x) => x.driver?.name },
                x.notes,
                { field: x.createdAt, width: '240px' },
                { field: x.createUserId, getValue: (x) => x.createUser?.name },
                x.eventStatus,
              ],
            }),
            title: 'היסטורית נסיעה',
          })
        },
      },
      {
        name: 'פרטי מוקדן',
        icon: 'contact_emergency',
        click: (e) =>
          ui.showUserInfo({ userId: e.createUserId, title: 'מוקדן' }),
      },
      {
        name: 'פרטי נהג',
        icon: 'local_taxi',
        visible: (e) => !!e.driverId,
        click: (e) => ui.showUserInfo({ userId: e.driverId, title: 'נהג' }),
      },
      {
        name: 'העבר לבירור רלוונטיות',
        icon: 'question_mark',
        visible: (e) => [taskStatus.active].includes(e.taskStatus),
        click: async (e) => {
          await e.markForRelevanceCheck()
        },
      },
      {
        name: 'סמן כלא רלוונטי',
        icon: 'thumb_down',
        visible: (e) =>
          [
            taskStatus.active,
            taskStatus.assigned,
            taskStatus.notRelevant,
            taskStatus.otherProblem,
            taskStatus.relevanceCheck,
            taskStatus.draft,
          ].includes(e.taskStatus),
        click: async (e) => {
          if (e.taskStatus !== taskStatus.completed)
            await e.noLongerRelevant('על ידי מוקדן')
        },
      },
      {
        name: 'החזר לנהג',
        icon: 'badge',
        visible: (e) =>
          ![
            taskStatus.active,
            taskStatus.assigned,
            taskStatus.driverPickedUp,
            taskStatus.relevanceCheck,
          ].includes(e.taskStatus) && e.driverId !== '',

        click: async (e) => {
          await e.returnToDriver()
        },
      },
      {
        name: 'החזר לפתוח לרישום',
        icon: 'check_circle',

        visible: (e) =>
          ![taskStatus.active, taskStatus.draft].includes(e.taskStatus),
        click: async (e) => {
          await e.returnToActive()
        },
      },
      {
        name: 'אשר טיוטא',
        icon: 'check_circle',

        visible: (e) => [taskStatus.draft].includes(e.taskStatus),
        click: async (e) => {
          await e.returnToActive()
        },
      },
      {
        name: 'סמן כטיוטא',
        visible: (e) =>
          e.taskStatus == taskStatus.active ||
          e.taskStatus === taskStatus.notRelevant ||
          e.taskStatus == taskStatus.relevanceCheck,
        click: async (e) => {
          await e.markAsDraft()
        },
      },
      {
        name: 'שכפול נסיעה',
        click: async (oldE) => {
          const e = remult.repo(Task).create(oldE)
          e.eventDate = new Date()
          e.eventDate.setDate(e.eventDate.getDate() + 1)
          ui.areaDialog({
            title: 'שכפול נסיעה',
            fields: [e.$.eventDate],
            ok: async () => {
              await e.save()
              args?.taskAdded?.(e)
            },
          })
        },
      },
      {
        name: 'פתח בMONDAY',
        visible: (e) => e.externalId.startsWith('m:'),
        click: (t) => {
          window.open(
            `https://kanfi-barzel.monday.com/boards/1290250715/pulses/` +
              t.externalId.split(':')[1],
            '_blank'
          )
        },
      },
    ]
  }
  getLink(): string {
    return remult.context.origin + '/t/' + this.id
  }
}

export const day = 86400000

export function eventDisplayDate(
  e: Task,
  group = false,
  today: Date | undefined = undefined
) {
  if (e.eventDate) {
    let edd = e.eventDate
    if (!today) today = new Date()
    today = ValueConverters.DateOnly.fromJson!(
      ValueConverters.DateOnly.toJson!(new Date())
    )
    let todayJson = ValueConverters.DateOnly.toJson!(today)
    let t = today.valueOf()
    let d = edd.valueOf()
    if (d > t - day) {
      if (d < t + day)
        return `היום` + ' (' + moment(d).locale('he').format('DD/MM') + ')'
      if (d < t + day * 2)
        return 'מחר' + ' (' + moment(d).locale('he').format('DD/MM') + ')'
      if (group) {
        let endOfWeek = t - today.getDay() * day + day * 7
        if (d < endOfWeek) return 'השבוע'
        if (d < endOfWeek + day * 7) return 'שבוע הבא'
        if (edd.getFullYear() == today.getFullYear())
          return edd.toLocaleString('he', { month: 'long' })

        if (group)
          return edd.toLocaleString('he', { month: 'long', year: '2-digit' })
      }
    } else {
      if (d > t - day * 2) {
        return 'אתמול' + ' (' + moment(d).locale('he').format('DD/MM') + ')'
      }
      if (d > t - day * 3) {
        return 'שלשום' + ' (' + moment(d).locale('he').format('DD/MM') + ')'
      }

      return 'עבר' + ' (' + moment(d).locale('he').format('DD/MM') + ')'
    }

    return moment(d).locale('he').format('DD/MM (dddd)')
  }
  if (group) return 'gcr'
  return ''
}

export function calcValidUntil(
  date: Date,
  startTime: string,
  validUntil: number
) {
  const hours = +startTime.substring(0, 2)
  const minutes = +startTime.substring(3, 5)
  const result = new Date(date)
  result.setHours(result.getHours() + hours + validUntil - 2)
  result.setMinutes(result.getMinutes() + minutes)
  return result
  const text = result.toLocaleString('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour12: false,
    timeZoneName: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const r2 = new Date(text)
  console.log({ date, startTime, validUntil, result, text, r2 })
  return r2
}

export const DriverCanceledAssign = 'נהג ביטל שיוך'
