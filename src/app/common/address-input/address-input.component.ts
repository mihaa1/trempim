import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  NgZone,
  AfterViewInit,
} from '@angular/core'
import { ErrorStateMatcher } from '@angular/material/core'
import {
  CustomComponentArgs,
  CustomDataComponent,
} from '../../common-ui-elements/interfaces'

import { FieldRef } from 'remult'

import { getAddress, Location, parseUrlInAddress } from './google-api-helpers'
import { InputAddressResult } from '../UITools'
import { getSite } from '../../users/sites'

@Component({
  selector: 'app-address-input',
  templateUrl: './address-input.component.html',
  styleUrls: ['./address-input.component.scss'],
})
export class AddressInputComponent
  implements AfterViewInit, CustomDataComponent
{
  @Input() field!: FieldRef<any, string>
  @Input() autoInit: boolean = false
  @Input() caption!: string

  onSelect?: (result: InputAddressResult) => void
  constructor(private zone: NgZone) {}
  set args(value: CustomComponentArgs) {
    this.field = value.fieldRef
    if (value.settings.caption) this.caption = value.settings.caption
    if (value.args) {
      this.onSelect = (result) => {
        value.args(result, value.fieldRef.container)
      }
    }
    this.autoInit = true
  }
  initAddressAutoComplete = false
  destroyMe!: google.maps.MapsEventListener
  checkInput() {
    var x = parseUrlInAddress(this.field.value)
    if (x != this.field.value) {
      setTimeout(() => {
        this.field.value = x
      }, 50)
    }
  }

  @ViewChild('addressInput', { static: false }) addressInput!: ElementRef
  initAddress(consumer: (x: InputAddressResult) => void) {
    if (this.initAddressAutoComplete) return
    this.initAddressAutoComplete = true
    const options: google.maps.places.AutocompleteOptions = {
      //   bounds: bounds,
      fields: ['address_components', 'formatted_address', 'geometry', 'type'],
    }
    if (getSite().onlyCities) options.types = ['(cities)']
    const autocomplete = new google.maps.places.Autocomplete(
      this.addressInput.nativeElement,
      options
    )
    this.destroyMe = google.maps.event.addListener(
      autocomplete,
      'place_changed',
      () => {
        const place = autocomplete.getPlace()
        if (!place) return

        this.zone.run(() => {
          this.field.value = this.addressInput.nativeElement.value
          this.field.value = getAddress({
            formatted_address: this.field.value,
            address_components: place.address_components,
          })
          this.field.error = ''
          consumer(
            !place.geometry
              ? {
                  autoCompleteResult: undefined!,
                  location: undefined!,
                  addressByGoogle: undefined!,
                }
              : {
                  autoCompleteResult: {
                    results: [
                      {
                        address_components: place.address_components,
                        formatted_address: place.formatted_address,
                        partial_match: false,
                        geometry: {
                          location_type: '',
                          location: toLocation(place.geometry!.location)!,
                          viewport: {
                            northeast: toLocation(
                              place.geometry!.viewport.getNorthEast()
                            ),
                            southwest: toLocation(
                              place.geometry!.viewport.getSouthWest()
                            ),
                          },
                        },
                        place_id: place.place_id!,
                        types: place.types!,
                      },
                    ],
                    status: 'OK',
                  },
                  location: {
                    lat: place.geometry!.location.lat(),
                    lng: place.geometry!.location.lng(),
                  },
                  addressByGoogle: getAddress(place),
                }
          )
        })
      }
    )
  }
  getError() {
    return this.field.error
  }

  ngAfterViewInit() {
    if (this.autoInit) {
      this.initAddress((x) => {
        this.onSelect?.(x)
      })
    }
  }
  ngOnDestroy(): void {
    if (this.destroyMe) this.destroyMe.remove()
  }
  ngErrorStateMatches = new (class extends ErrorStateMatcher {
    constructor(public parent: AddressInputComponent) {
      super()
    }
    override isErrorState() {
      return !!this.parent.field.error
    }
  })(this)
}

function toLocation(l: google.maps.LatLng): Location {
  return {
    lat: l.lat(),
    lng: l.lng(),
  }
}
