import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import {
  JobResultResponse,
  JobUpdateEvent,
  TranscriptionOptions,
  TranscriptionSegment,
} from '../../core/models/transcription.model';
import { TranscriptionService } from '../../core/services/transcription.service';
import { WebsocketService } from '../../core/services/websocket.service';

interface SegmentItem {
  id: number;
  start: string;
  end: string;
  text: string;
  speaker: string;
}

interface HistoryItem {
  name: string;
  date: Date;
  duration: string;
  model: string;
}

@Component({
  selector: 'app-transcription',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transcription.component.html',
  styleUrls: ['./transcription.component.scss'],
})
export class TranscriptionComponent implements AfterViewInit, OnDestroy {
  private file: File | null = null;
  private isProcessing = false;
  private segments: SegmentItem[] = [];
  private showTimestamps = true;
  private isPlaying = false;
  private historyItems: HistoryItem[] = [];
  private audioDurationSeconds = 45 * 60 + 30;
  private currentProgress = 0;
  private playbackInterval: number | null = null;
  private toastTimeout: number | null = null;
  private wsSubscription?: Subscription;

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly websocketService: WebsocketService
  ) {}

  ngAfterViewInit(): void {
    this.initTheme();
    this.initUpload();

    document.querySelectorAll('.checkbox-wrapper input').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        // Visual feedback handled by CSS.
      });
    });

    const configModel = document.getElementById('configModel') as HTMLSelectElement | null;
    configModel?.addEventListener('change', () => {
      if (this.file) {
        this.handleFile(this.file);
      }
    });

    const beamInput = document.getElementById('configBeam') as HTMLInputElement | null;
    const beamValue = document.getElementById('beamValue');
    beamInput?.addEventListener('input', () => {
      if (beamValue) {
        beamValue.textContent = beamInput.value;
      }
    });
  }

  ngOnDestroy(): void {
    if (this.playbackInterval) {
      window.clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }

    if (this.toastTimeout) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    this.closeJobUpdates();
  }

  initTheme(): void {
    const root = document.documentElement;
    if (
      localStorage['theme'] === 'dark' ||
      (!('theme' in localStorage) &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    ) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }

  toggleTheme(): void {
    const root = document.documentElement;
    if (root.classList.contains('dark')) {
      root.classList.remove('dark');
      localStorage['theme'] = 'light';
    } else {
      root.classList.add('dark');
      localStorage['theme'] = 'dark';
    }
  }

  navigate(view: 'home' | 'history' | 'settings'): void {
    document.querySelectorAll('.view').forEach((item) => {
      item.classList.remove('active');
    });

    const target = document.getElementById(`view-${view}`);
    target?.classList.add('active');

    document.querySelectorAll('.nav-link').forEach((link) => {
      if ((link as HTMLElement).dataset['view'] === view) {
        link.classList.add('text-primary');
        link.classList.remove('text-gray-600', 'dark:text-gray-300');
      } else {
        link.classList.remove('text-primary');
        link.classList.add('text-gray-600', 'dark:text-gray-300');
      }
    });

    const titles: Record<'home' | 'history' | 'settings', string> = {
      home: 'Inicio',
      history: 'Historial',
      settings: 'Configuración',
    };
    document.title = `TranscriptPro - ${titles[view]}`;

    if (view === 'history') {
      this.loadHistory();
    }
  }

  initUpload(): void {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;

    if (!dropzone || !fileInput) {
      return;
    }

    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
      const dataEvent = event as DragEvent;
      const files = dataEvent.dataTransfer?.files;
      if (files && files.length) {
        this.handleFile(files[0]);
      }
    });

    dropzone.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.files && target.files.length) {
        this.handleFile(target.files[0]);
      }
    });
  }

  handleFile(file: File): void {
    const validExtensions = ['.mp3', '.wav', '.m4a', '.mp4'];
    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;

    if (!validExtensions.includes(extension)) {
      this.showToast('Formato no soportado. Usa MP3, WAV, M4A o MP4.', 'error');
      return;
    }

    this.file = file;

    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const dropzone = document.getElementById('dropzone');
    const filePreview = document.getElementById('filePreview');
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    const audioPreview = document.getElementById('audioPreview') as HTMLAudioElement | null;

    if (fileName) {
      fileName.textContent = file.name;
    }
    if (fileSize) {
      fileSize.textContent = this.formatFileSize(file.size);
    }
    dropzone?.classList.add('hidden');
    filePreview?.classList.remove('hidden');

    if (startBtn) {
      startBtn.disabled = false;
    }

    const url = URL.createObjectURL(file);
    if (audioPreview) {
      audioPreview.src = url;
    }

    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.audioDurationSeconds = audio.duration;
      }

      const model =
        (document.getElementById('configModel') as HTMLSelectElement | null)?.value ||
        'medium';
      const multipliers: Record<string, number> = {
        tiny: 0.5,
        base: 0.8,
        small: 1.2,
        medium: 2,
        'large-v3': 4,
      };
      const estimatedSeconds =
        (this.audioDurationSeconds * (multipliers[model] || 2)) / 60;
      const mins = Math.ceil(estimatedSeconds);
      const timeEstimate = document.getElementById('timeEstimate');
      if (timeEstimate) {
        timeEstimate.textContent = `~${mins} minuto${mins !== 1 ? 's' : ''}`;
      }

      if (fileSize) {
        fileSize.textContent = `${this.formatFileSize(file.size)} • ${this.formatTime(
          this.audioDurationSeconds
        )} minutos`;
      }
    };

    this.showToast('Archivo cargado correctamente');
  }

  clearUpload(): void {
    this.file = null;
    this.isProcessing = false;
    this.closeJobUpdates();

    const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = '';
    }

    document.getElementById('dropzone')?.classList.remove('hidden');
    document.getElementById('filePreview')?.classList.add('hidden');

    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.innerHTML = '<i class="fas fa-magic"></i><span>Iniciar Transcripción</span>';
    }

    document.getElementById('resultsSection')?.classList.add('hidden');
    document.getElementById('progressSection')?.classList.add('hidden');
    this.updateProgressUi(0, 'Inicializando modelo Whisper...');
    this.currentProgress = 0;
  }

  startUpload(): void {
    if (!this.file || this.isProcessing) {
      return;
    }

    this.closeJobUpdates();
    this.isProcessing = true;
    document.getElementById('filePreview')?.classList.add('hidden');
    document.getElementById('progressSection')?.classList.remove('hidden');

    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.innerHTML =
        '<i class="fas fa-circle-notch fa-spin"></i><span>Procesando...</span>';
    }

    this.updateProgressUi(1, 'Creando trabajo de transcripción...');
    this.currentProgress = 1;

    const options = this.getSelectedOptions();
    this.transcriptionService.createJob(this.file, options).subscribe({
      next: (response) => {
        this.connectJobUpdates(response.ws_url);
      },
      error: (error: unknown) => {
        this.isProcessing = false;
        this.restoreStartButton();
        this.updateProgressUi(0, 'No se pudo iniciar la transcripción');
        this.showToast(
          this.extractErrorMessage(error) || 'Error al crear la transcripción',
          'error'
        );
      },
    });
  }

  renderSegments(): void {
    const container = document.getElementById('transcriptionContent');
    if (!container) {
      return;
    }

    container.innerHTML = '';
    this.segments.forEach((segment, index) => {
      const row = document.createElement('div');
      row.className = 'segment p-3 rounded-lg cursor-pointer';
      row.dataset['index'] = `${index}`;
      row.addEventListener('click', () => this.seekTo(index));

      const showSpeaker = (document.getElementById('configDiarization') as HTMLInputElement | null)?.checked;
      const timestamp = this.showTimestamps
        ? `<span class="text-xs font-mono text-primary mr-3 select-none">${segment.start}</span>`
        : '';
      const speaker = showSpeaker
        ? `<span class="text-xs font-semibold text-secondary mr-2">[${segment.speaker}]</span>`
        : '';

      row.innerHTML = `
        <div class="flex items-start">
          ${timestamp}
          <div class="flex-1">
            ${speaker}
            <span class="text-gray-800 dark:text-gray-200">${segment.text}</span>
          </div>
        </div>
      `;

      container.appendChild(row);
    });
  }

  toggleTimestamps(): void {
    this.showTimestamps = !this.showTimestamps;
    this.renderSegments();
  }

  seekTo(index: number): void {
    document.querySelectorAll('.segment').forEach((segment) => {
      segment.classList.remove('active');
    });

    const row = document.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
    if (row) {
      row.classList.add('active');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  copyResults(): void {
    const text = this.segments.map((segment) => segment.text).join(' ');
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Texto copiado al portapapeles');
    });
  }

  downloadResults(format: 'txt' | 'srt'): void {
    let content = '';
    let filename = '';

    if (format === 'txt') {
      content = this.segments.map((segment) => segment.text).join('\n\n');
      filename = 'transcripcion.txt';
    } else {
      content = this.segments
        .map(
          (segment, index) =>
            `${index + 1}\n${segment.start.replace('.', ',')} --> ${segment.end.replace(
              '.',
              ','
            )}\n${segment.text}\n`
        )
        .join('\n');
      filename = 'transcripcion.srt';
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    this.showToast(`Descargando ${format.toUpperCase()}...`);
  }

  togglePlayer(): void {
    this.isPlaying = !this.isPlaying;
    const icon = document.querySelector('#playPauseBtn i');

    if (!icon) {
      return;
    }

    if (this.isPlaying) {
      icon.classList.remove('fa-play');
      icon.classList.add('fa-pause');
      this.simulatePlayback();
    } else {
      icon.classList.remove('fa-pause');
      icon.classList.add('fa-play');
    }
  }

  simulatePlayback(): void {
    if (!this.isPlaying) {
      return;
    }

    const currentTimeElement = document.getElementById('currentTime');
    let seconds = 0;

    this.playbackInterval = window.setInterval(() => {
      if (!this.isPlaying) {
        if (this.playbackInterval) {
          window.clearInterval(this.playbackInterval);
          this.playbackInterval = null;
        }
        return;
      }

      seconds += 1;
      if (currentTimeElement) {
        currentTimeElement.textContent = this.formatTime(seconds);
      }

      const segmentIndex = Math.floor(seconds / 20);
      if (segmentIndex < this.segments.length) {
        this.seekTo(segmentIndex);
      }

      if (seconds > 900) {
        this.togglePlayer();
        if (this.playbackInterval) {
          window.clearInterval(this.playbackInterval);
          this.playbackInterval = null;
        }
      }
    }, 1000);
  }

  loadHistory(): void {
    if (this.historyItems.length === 0) {
      this.historyItems = [
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
      ];
    }
    this.renderHistory();
  }

  addHistory(item: HistoryItem): void {
    this.historyItems.unshift(item);
    this.renderHistory();
  }

  renderHistory(): void {
    const container = document.getElementById('historyList');
    if (!container) {
      return;
    }

    container.innerHTML = '';

    this.historyItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className =
        'p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-center justify-between group';

      const dateString = item.date.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      row.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-primary">
            <i class="fas fa-file-audio text-xl"></i>
          </div>
          <div>
            <h4 class="font-semibold text-gray-900 dark:text-white">${item.name}</h4>
            <div class="flex items-center gap-3 text-sm text-gray-500 mt-1">
              <span><i class="far fa-calendar mr-1"></i>${dateString}</span>
              <span><i class="far fa-clock mr-1"></i>${item.duration}</span>
              <span class="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-xs">${item.model}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button data-action="txt" class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400" title="Descargar TXT">
            <i class="fas fa-file-alt"></i>
          </button>
          <button data-action="srt" class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400" title="Descargar SRT">
            <i class="fas fa-closed-captioning"></i>
          </button>
          <button data-action="delete" class="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500" title="Eliminar">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;

      const txtButton = row.querySelector('button[data-action="txt"]');
      const srtButton = row.querySelector('button[data-action="srt"]');
      const deleteButton = row.querySelector('button[data-action="delete"]');

      txtButton?.addEventListener('click', () => this.showToast('Descargando TXT...'));
      srtButton?.addEventListener('click', () => this.showToast('Descargando SRT...'));
      deleteButton?.addEventListener('click', () => this.deleteHistory(index));

      container.appendChild(row);
    });
  }

  deleteHistory(index: number): void {
    if (confirm('¿Eliminar esta transcripción?')) {
      this.historyItems.splice(index, 1);
      this.renderHistory();
      this.showToast('Transcripción eliminada');
    }
  }

  showToast(message: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const messageElement = document.getElementById('toastMessage');

    if (!toast || !icon || !messageElement) {
      return;
    }

    messageElement.textContent = message;

    if (type === 'error') {
      icon.className = 'fas fa-exclamation-circle text-red-500 text-xl';
    } else {
      icon.className = 'fas fa-check-circle text-green-500 text-xl';
    }

    toast.classList.remove('translate-y-20', 'opacity-0');

    if (this.toastTimeout) {
      window.clearTimeout(this.toastTimeout);
    }

    const hideAfterMs = type === 'error' ? 10000 : 3000;
    this.toastTimeout = window.setTimeout(() => {
      toast.classList.add('translate-y-20', 'opacity-0');
    }, hideAfterMs);
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) {
      return '0 Bytes';
    }

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const index = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, index)).toFixed(2))} ${sizes[index]}`;
  }

  formatTime(seconds: number): string {
    const safe = Math.max(0, seconds);
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    }

    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  private connectJobUpdates(wsPath: string): void {
    const wsUrl = this.toWebSocketUrl(wsPath);
    this.wsSubscription = this.websocketService.connect(wsUrl).subscribe({
      next: (event: JobUpdateEvent) => this.handleJobEvent(event),
      error: () => {
        this.isProcessing = false;
        this.restoreStartButton();
        this.showToast('Se perdió la conexión de progreso', 'error');
      },
    });
  }

  private handleJobEvent(event: JobUpdateEvent): void {
    if (event.type !== 'job.update' || !event.data) {
      return;
    }

    const job = event.data;
    const incomingProgress = Math.max(0, Math.min(100, Math.round(job.progress ?? 0)));
    const progress = Math.max(this.currentProgress, incomingProgress);
    this.currentProgress = progress;
    this.updateProgressUi(progress, job.message || 'Procesando...');

    const detailVAD = document.getElementById('detailVAD');
    if (
      detailVAD &&
      ((job.message || '').toLowerCase().includes('vad') ||
        (job.message || '').toLowerCase().includes('distinguishing speakers') ||
        progress >= 30)
    ) {
      detailVAD.classList.remove('opacity-50');
      detailVAD.innerHTML =
        '<i class="fas fa-check-circle text-green-500"></i><span>VAD aplicado</span>';
    }

    if (job.status === 'completed') {
      this.isProcessing = false;
      this.currentProgress = 100;
      this.updateProgressUi(100, job.message || 'Completed');
      this.closeJobUpdates();
      this.loadResult(job.id);
      return;
    }

    if (job.status === 'failed') {
      this.isProcessing = false;
      this.closeJobUpdates();
      this.restoreStartButton();
      this.showToast(job.error || 'La transcripción falló', 'error');
    }
  }

  private loadResult(jobId: string): void {
    this.transcriptionService.getResult(jobId).subscribe({
      next: (result: JobResultResponse) => {
        this.segments = this.buildSegmentsFromResult(result);
        this.renderSegments();
        document.getElementById('progressSection')?.classList.add('hidden');
        document.getElementById('resultsSection')?.classList.remove('hidden');
        this.restoreStartButton();

        if (this.file) {
          this.addHistory({
            name: this.file.name,
            date: new Date(),
            duration: this.formatTime(this.audioDurationSeconds),
            model:
              (document.getElementById('configModel') as HTMLSelectElement | null)?.value ||
              'medium',
          });
        }

        this.showToast('¡Transcripción completada!');
      },
      error: (error: unknown) => {
        this.restoreStartButton();
        this.showToast(
          this.extractErrorMessage(error) || 'No se pudo cargar el resultado',
          'error'
        );
      },
    });
  }

  private buildSegmentsFromResult(result: JobResultResponse): SegmentItem[] {
    if (result.segments && result.segments.length > 0) {
      return result.segments.map((segment: TranscriptionSegment, index: number) => ({
        id: index + 1,
        start: this.formatTime(segment.start),
        end: this.formatTime(segment.end),
        text: segment.text,
        speaker: segment.speaker || 'SPEAKER_01',
      }));
    }

    const fromSrt = this.parseSrtSegments(result.srt);
    if (fromSrt.length > 0) {
      return fromSrt.map((segment, index) => ({
        id: index + 1,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        speaker: segment.speaker,
      }));
    }

    return this.splitTextToSegments(result.text);
  }

  private parseSrtSegments(
    srt: string | null
  ): Array<{ start: string; end: string; text: string; speaker: string }> {
    if (!srt) {
      return [];
    }

    return srt
      .split(/\r?\n\r?\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .map((block) => {
        const lines = block.split(/\r?\n/).map((line) => line.trim());
        if (lines.length < 3) {
          return null;
        }

        const match = lines[1].match(
          /(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/
        );
        if (!match) {
          return null;
        }

        const fullText = lines.slice(2).join(' ').trim();
        const speakerMatch = fullText.match(/^\[(.*?)\]\s+(.*)$/);
        return {
          start: match[1].replace(',', '.').slice(0, 8),
          end: match[2].replace(',', '.').slice(0, 8),
          text: (speakerMatch ? speakerMatch[2] : fullText).trim(),
          speaker: speakerMatch ? speakerMatch[1] : 'SPEAKER_01',
        };
      })
      .filter(
        (
          item
        ): item is {
          start: string;
          end: string;
          text: string;
          speaker: string;
        } => item !== null && item.text.length > 0
      );
  }

  private splitTextToSegments(text: string): SegmentItem[] {
    const clean = (text || '').trim();
    if (!clean) {
      return [];
    }

    const chunks = clean
      .split(/(?<=[.!?])\s+/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
    const lines = chunks.length > 0 ? chunks : [clean];

    const segmentDuration = Math.max(2, this.audioDurationSeconds / lines.length);
    let cursor = 0;

    return lines.map((line, index) => {
      const start = cursor;
      const end = Math.min(this.audioDurationSeconds, start + segmentDuration);
      cursor = end;
      return {
        id: index + 1,
        start: this.formatTime(start),
        end: this.formatTime(end),
        text: line,
        speaker: 'SPEAKER_01',
      };
    });
  }

  private getSelectedOptions(): TranscriptionOptions {
    const lang =
      (document.getElementById('configLang') as HTMLSelectElement | null)?.value || 'es';
    const model =
      (document.getElementById('configModel') as HTMLSelectElement | null)?.value ||
      'medium';
    const computeType =
      (document.getElementById('configCompute') as HTMLSelectElement | null)?.value ||
      'float16';
    const beamSize = Number(
      (document.getElementById('configBeam') as HTMLInputElement | null)?.value || '5'
    );
    const deviceInput = document.querySelector<HTMLInputElement>(
      'input[name="device"]:checked'
    );
    const generateSrt =
      (document.getElementById('configSRT') as HTMLInputElement | null)?.checked ?? true;
    const diarization =
      (document.getElementById('configDiarization') as HTMLInputElement | null)?.checked ??
      false;

    return {
      lang,
      model,
      device: deviceInput?.value === 'cpu' ? 'cpu' : 'cuda',
      compute_type: computeType,
      beam_size: Number.isFinite(beamSize) ? beamSize : 5,
      generate_srt: generateSrt,
      diarization,
      diarization_speakers: null,
    };
  }

  private updateProgressUi(percent: number, status: string): void {
    const progressBar = document.getElementById('progressBar') as HTMLElement | null;
    const progressPercent = document.getElementById('progressPercent');
    const progressStatus = document.getElementById('progressStatus');
    const progressTime = document.getElementById('progressTime');

    const safe = Math.max(0, Math.min(100, percent));

    if (progressBar) {
      progressBar.style.width = `${safe}%`;
    }
    if (progressPercent) {
      progressPercent.textContent = `${safe}%`;
    }
    if (progressStatus) {
      progressStatus.textContent = status;
    }
    if (progressTime) {
      const current = (safe / 100) * this.audioDurationSeconds;
      progressTime.textContent = `${this.formatTime(current)} / ${this.formatTime(
        this.audioDurationSeconds
      )}`;
    }
  }

  private restoreStartButton(): void {
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    if (!startBtn) {
      return;
    }

    startBtn.innerHTML = '<i class="fas fa-magic"></i><span>Iniciar Transcripción</span>';
    startBtn.disabled = !this.file;
  }

  private toWebSocketUrl(path: string): string {
    if (path.startsWith('ws://') || path.startsWith('wss://')) {
      return path;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://localhost:8000${path}`;
  }

  private closeJobUpdates(): void {
    this.wsSubscription?.unsubscribe();
    this.wsSubscription = undefined;
    this.websocketService.close();
  }

  private extractErrorMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('error' in error)) {
      return undefined;
    }

    const payload = (error as { error?: { detail?: string } }).error;
    return payload?.detail;
  }
}
