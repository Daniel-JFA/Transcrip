import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  JobCreatedResponse,
  JobResultResponse,
  TranscriptionJob,
  TranscriptionOptions,
} from '../models/transcription.model';

@Injectable({ providedIn: 'root' })
export class TranscriptionService {
  private readonly apiUrl = '/api/v1/transcriptions';

  constructor(private readonly http: HttpClient) {}

  createJob(file: File, options: TranscriptionOptions): Observable<JobCreatedResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('lang', options.lang);
    formData.append('model', options.model);
    formData.append('device', options.device);
    formData.append('compute_type', options.compute_type);
    formData.append('beam_size', String(options.beam_size));
    formData.append('generate_srt', String(options.generate_srt));
    formData.append('diarization', String(options.diarization));
    if (options.diarization_speakers != null) {
      formData.append('diarization_speakers', String(options.diarization_speakers));
    }
    return this.http.post<JobCreatedResponse>(this.apiUrl, formData);
  }

  getJob(jobId: string): Observable<TranscriptionJob> {
    return this.http.get<TranscriptionJob>(`${this.apiUrl}/${jobId}`);
  }

  getResult(jobId: string): Observable<JobResultResponse> {
    return this.http.get<JobResultResponse>(`${this.apiUrl}/${jobId}/result`);
  }
}

