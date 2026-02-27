import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ThemeService } from '../../../../core/services/theme.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent implements OnInit {
  constructor(public readonly theme: ThemeService) {}

  ngOnInit(): void {
    this.theme.init();
  }
}
