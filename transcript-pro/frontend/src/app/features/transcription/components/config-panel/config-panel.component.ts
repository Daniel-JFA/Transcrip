import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { TranscriptionOptions } from '../../../../core/models/transcription.model';

@Component({
  selector: 'app-config-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './config-panel.component.html',
  styleUrls: ['./config-panel.component.scss'],
})
export class ConfigPanelComponent implements OnInit {
  @Input() disabled = false;
  @Output() optionsChange = new EventEmitter<TranscriptionOptions>();
  @Output() startClicked = new EventEmitter<void>();

  private readonly fb = inject(FormBuilder);

  form = this.fb.nonNullable.group({
    lang: 'es',
    model: 'medium',
    device: 'cuda' as 'cuda' | 'cpu',
    compute_type: 'float16',
    beam_size: 5,
    generate_srt: true,
    diarization: false,
  });

  ngOnInit(): void {
    this.optionsChange.emit(this.form.getRawValue());
    this.form.valueChanges.subscribe(() => {
      this.optionsChange.emit(this.form.getRawValue());
    });
  }
}
