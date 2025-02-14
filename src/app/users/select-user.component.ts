import { Component, OnInit } from '@angular/core'
import { MatDialogRef } from '@angular/material/dialog'

import { Remult, repo } from 'remult'
import { BusyService } from '../common-ui-elements'
import { User } from './user'
import { getCity } from '../common/address-input/google-api-helpers'

@Component({
  selector: 'app-server-side-search-selection-dialog',
  template: `
    <h1 mat-dialog-title>בחר מתנדב</h1>

    <div mat-dialog-content>
      <form (submit)="selectFirst()">
        <mat-form-field>
          <input
            matInput
            [(ngModel)]="searchString"
            [ngModelOptions]="{ standalone: true }"
            placeholder="חיפוש נהג"
            (input)="doSearch()"
          />
        </mat-form-field>
      </form>
      <mat-nav-list role="list" *ngIf="users">
        <ng-container *ngFor="let o of users">
          <mat-list-item
            role="listitem"
            style="height:36px"
            (click)="select(o)"
          >
            <span>{{ o.name }}</span>
            <span
              class="mat-subtitle-2"
              *ngIf="o.addressApiResult"
              style="color:gray"
            >
             &nbsp; - {{ getCity(o) }}
            </span>
          </mat-list-item>
          <mat-divider></mat-divider>
        </ng-container>
      </mat-nav-list>
    </div>
    <div mat-dialog-actions>
      <button mat-icon-button mat-dialog-close>
        <mat-icon>clear</mat-icon>
      </button>
    </div>
  `,
  styles: [],
})
export class SelectUserComponent implements OnInit {
  constructor(
    private remult: Remult,
    private busy: BusyService,
    private dialogRef: MatDialogRef<any>
  ) {}
  users: User[] = []
  ngOnInit() {
    this.loadProducts()
  }
  getCity(u: User) {
    return getCity(u.addressApiResult, u.address)
  }
  async loadProducts() {
    this.users = await repo(User).find({
      limit: 100,
      where: {
        name: { $contains: this.searchString },
      },
    })
  }
  async doSearch() {
    await this.busy.donotWait(async () => this.loadProducts())
  }

  searchString = ''

  args!: {
    onSelect: (p: User) => void
  }
  select(p: User) {
    this.args.onSelect(p)
    this.dialogRef.close()
  }
  selectFirst() {
    if (this.users.length > 0) this.select(this.users[0])
  }
}
