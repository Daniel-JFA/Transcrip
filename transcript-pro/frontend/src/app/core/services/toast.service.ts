import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastType = 'success' | 'error';

export interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private timerId: number | null = null;

  private readonly stateSubject = new BehaviorSubject<ToastState>({
    visible: false,
    message: 'Operación exitosa',
    type: 'success',
  });

  readonly state$ = this.stateSubject.asObservable();

  show(message: string, type: ToastType = 'success'): void {
    if (this.timerId) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.stateSubject.next({
      visible: true,
      message,
      type,
    });

    this.timerId = window.setTimeout(() => {
      this.hide();
    }, 3000);
  }

  hide(): void {
    const current = this.stateSubject.getValue();
    this.stateSubject.next({
      ...current,
      visible: false,
    });
  }
}
