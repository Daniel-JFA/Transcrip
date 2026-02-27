import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-upload-zone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload-zone.component.html',
  styleUrls: ['./upload-zone.component.scss'],
})
export class UploadZoneComponent {
  @Output() fileSelected = new EventEmitter<File>();

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (file) {
      this.fileSelected.emit(file);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.item(0);
    if (file) {
      this.fileSelected.emit(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }
}

