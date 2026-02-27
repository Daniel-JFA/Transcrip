import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-result-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './result-viewer.component.html',
  styleUrls: ['./result-viewer.component.scss'],
})
export class ResultViewerComponent {
  @Input() text = '';
  @Input() srt: string | null = null;

  copyToClipboard(): void {
    if (!this.text) {
      return;
    }
    navigator.clipboard.writeText(this.text).catch(() => undefined);
  }

  download(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

