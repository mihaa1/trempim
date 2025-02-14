import {
  FieldRef,
  FieldValidator,
  Fields,
  StringFieldOptions,
  Validators,
} from 'remult'

export function sendWhatsappToPhone(
  phone: string,
  smsMessage: string,
  test = false
) {
  phone = fixPhoneInput(phone)
  if (phone.startsWith('0')) {
    phone = `+972` + phone.substring(1)
  }

  if (phone.startsWith('+')) phone = phone.substring(1)
  if (test)
    window.open(
      'whatsapp://send/?phone=' + phone + '&text=' + encodeURI(smsMessage),
      '_blank'
    )
  else
    window.open(
      'https://wa.me/' + phone + '?text=' + encodeURI(smsMessage),
      '_blank'
    )
}

export function fixPhoneInput(s: string) {
  if (!s) return s
  let orig = s.trim()
  s = s.replace(/\D/g, '')
  if (s.startsWith('972')) s = s.substring(3)
  //if (orig.startsWith('+')) return '+' + s
  if (s.length == 9 && s[0] != '0' && s[0] != '3') s = '0' + s
  return s
}

export function isPhoneValidForIsrael(input: string) {
  if (input) {
    input = input.toString().trim()
    let st1 = input.match(/^0(5\d|7\d|[2,3,4,6,8,9])(-{0,1}\d{3})(-*\d{4})$/)
    return st1 != null
  }
  return false
}
export const phoneConfig = {
  disableValidation: false,
}
export function PhoneField<entityType>(
  options?: StringFieldOptions<entityType>
) {
  const validate:
    | ((
        entity: entityType,
        fieldRef: FieldRef<entityType, string>
      ) => any | Promise<any>)
    | ((
        entity: entityType,
        fieldRef: FieldRef<entityType, string>
      ) => any | Promise<any>)[] = [
    (_, f) => {
      if (!f.value) return
      f.value = fixPhoneInput(f.value)
      if (phoneConfig.disableValidation) return
      if (!isPhoneValidForIsrael(f.value)) throw new Error('טלפון לא תקין')
    },
  ]
  if (options?.validate) {
    if (!Array.isArray(options.validate)) options.validate = [options.validate]
    validate.push(...options.validate)
  }
  return Fields.string({
    caption: 'מספר טלפון',
    inputType: 'tel',
    displayValue: (_, value) => formatPhone(value),
    ...options,
    validate,
  })
}

export function formatPhone(s: string) {
  if (!s) return s
  let x = s.replace(/\D/g, '')
  if (x.length < 9 || x.length > 10) return s
  if (x.length < 10 && !x.startsWith('0')) x = '0' + x

  x = x.substring(0, x.length - 4) + '-' + x.substring(x.length - 4, x.length)
  x = x.substring(0, x.length - 8) + '-' + x.substring(x.length - 8, x.length)
  return x
}

export interface ContactInfo {
  phone: string
  formattedPhone: string
  name: string
}
export interface TaskContactInfo {
  origin: ContactInfo[]
  target: ContactInfo[]
}
