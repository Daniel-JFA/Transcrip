import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: '',
    loadChildren: () =>
      import('./features/transcription/transcription.routes').then(
        (m) => m.TRANSCRIPTION_ROUTES
      ),
  },
];
