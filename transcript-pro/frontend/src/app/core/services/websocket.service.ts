import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { JobUpdateEvent } from '../models/transcription.model';

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private socket: WebSocket | null = null;
  private readonly updatesSubject = new Subject<JobUpdateEvent>();

  connect(url: string): Observable<JobUpdateEvent> {
    this.close();
    this.socket = new WebSocket(url);

    this.socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as JobUpdateEvent;
        this.updatesSubject.next(parsed);
      } catch {
        // Ignore malformed payloads from server.
      }
    };

    this.socket.onerror = () => {
      this.updatesSubject.next({ type: 'socket.error' });
    };

    this.socket.onclose = () => {
      this.updatesSubject.next({ type: 'socket.closed' });
    };

    return this.updatesSubject.asObservable();
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
