import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface HistoryItem {
  name: string;
  date: Date;
  duration: string;
  model: string;
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly itemsSubject = new BehaviorSubject<HistoryItem[]>([]);
  readonly items$ = this.itemsSubject.asObservable();

  load(): void {
    if (this.itemsSubject.getValue().length > 0) {
      return;
    }

    this.itemsSubject.next([
      {
        name: 'reunion_equipo_2024.mp3',
        date: new Date(Date.now() - 86400000),
        duration: '32:15',
        model: 'medium',
      },
      {
        name: 'entrevista_cliente.wav',
        date: new Date(Date.now() - 172800000),
        duration: '45:30',
        model: 'large-v3',
      },
      {
        name: 'podcast_tecnologia.mp3',
        date: new Date(Date.now() - 259200000),
        duration: '1:12:45',
        model: 'medium',
      },
    ]);
  }

  add(item: HistoryItem): void {
    const current = this.itemsSubject.getValue();
    this.itemsSubject.next([item, ...current]);
  }

  delete(index: number): void {
    const current = [...this.itemsSubject.getValue()];
    current.splice(index, 1);
    this.itemsSubject.next(current);
  }
}
