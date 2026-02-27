import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { TranscriptionJob } from '../../../../core/models/transcription.model';

@Component({
  selector: 'app-progress-tracker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress-tracker.component.html',
  styleUrls: ['./progress-tracker.component.scss'],
})
export class ProgressTrackerComponent {
  @Input() job: TranscriptionJob | null = null;
}

