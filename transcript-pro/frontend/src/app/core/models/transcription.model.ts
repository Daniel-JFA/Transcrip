export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TranscriptionOptions {
  lang: string;
  model: string;
  device: 'cuda' | 'cpu';
  compute_type: string;
  beam_size: number;
  generate_srt: boolean;
  diarization: boolean;
  diarization_speakers?: number | null;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface TranscriptionJob {
  id: string;
  filename: string;
  status: JobStatus;
  progress: number;
  message: string;
  created_at: string;
  updated_at: string;
  text?: string | null;
  srt?: string | null;
  segments?: TranscriptionSegment[];
  error?: string | null;
}

export interface JobCreatedResponse {
  job: TranscriptionJob;
  ws_url: string;
}

export interface JobResultResponse {
  text: string;
  srt: string | null;
  segments: TranscriptionSegment[];
}

export interface JobUpdateEvent {
  type: 'job.update' | 'ping' | 'socket.error' | 'socket.closed';
  data?: TranscriptionJob;
}
