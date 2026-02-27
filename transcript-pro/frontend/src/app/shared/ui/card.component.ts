import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: '<section class="card"><ng-content /></section>',
  styles: [
    `
      .card {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 1rem;
        background: var(--color-surface);
      }
    `,
  ],
})
export class CardComponent {}
