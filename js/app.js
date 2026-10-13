// MBBS Attendance Tracker - Main Application Controller
// Coordinates state, IndexedDB persistence, view rendering, and user interactions

import { DBService } from './db.js';
import { AttendanceEngine } from './engine.js';
import { TimetableEngine } from './timetable.js';
import { TestRunner } from './test-runner.js';

class MBBSAttendanceApp {
  constructor() {
    this.currentView = 'dashboard';
    this.selectedDateStr = this.getTodayDateString();
    this.selectedTimetableDay = 1; // Mon
    this.pendingRestoreBackup = null;
    this.subjects = [];
    this.timetableVersions = [];
    this.rotations = [];
    this.currentSessions = [];
    this.safetyBuffer = 5;
    this.theoryMin = 75;
    this.clinicalMin = 80;
  }

  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  async init() {
    // 1. Register Service Worker for 100% offline caching
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js', { scope: './' });
        console.log('MBBS Attendance Tracker PWA Service Worker Registered with scope: ./');
      } catch (err) {
        console.warn('Service Worker registration skipped/failed:', err);
      }
    }

    // 2. Load settings and theme
    await this.loadSettings();

    // 3. Ensure a default timetable template exists
    await this.ensureDefaultTimetable();

    // 4. Setup event listeners
    this.setupNavigation();
    this.setupThemeToggle();
    this.setupDailyViewEvents();
    this.setupTimetableEvents();
    this.setupSubjectModalEvents();
    this.setupRotationModalEvents();
    this.setupExtraClassModalEvents();
    this.setupLeavePlannerEvents();
    this.setupReportsEvents();
    this.setupSettingsEvents();
    this.setupAcceptanceTestsEvents();

    // 5. Initial Data Load & Render
    await this.refreshData();
    this.renderCurrentView();

    // 6. Check last backup warning
    await this.checkBackupReminder();
  }

  async loadSettings() {
    const theme = await DBService.getSetting('appTheme', 'dark');
    document.documentElement.setAttribute('data-theme', theme);

    this.theoryMin = await DBService.getSetting('theoryMinPercent', 75);
    this.clinicalMin = await DBService.getSetting('clinicalMinPercent', 80);
    this.safetyBuffer = await DBService.getSetting('safetyBuffer', 5);

    document.getElementById('setting-theory-min').value = this.theoryMin;
    document.getElementById('setting-clinical-min').value = this.clinicalMin;
    document.getElementById('setting-safety-buffer').value = this.safetyBuffer;
  }

  async ensureDefaultTimetable() {
    const versions = await DBService.getTimetableVersions();
    if (versions.length === 0) {
      // Create initial MBBS 4th year template starting from beginning of academic year
      const defaultSlots = TimetableEngine.createDefaultSlots();
      const initialVersion = {
        id: 'tt_version_1',
        name: '4th Year Standard Timetable',
        effectiveStartDate: '2026-01-01',
        slots: defaultSlots
      };
      await DBService.saveTimetableVersion(initialVersion);
    }
  }

  async refreshData() {
    this.subjects = await DBService.getSubjects();
    this.timetableVersions = await DBService.getTimetableVersions();
    this.rotations = await DBService.getPostingRotations();
    this.currentSessions = await DBService.getAllSessions();
  }

  // ================= VIEW NAVIGATION =================

  setupNavigation() {
    const navItems = document.querySelectorAll('.bottom-nav .nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const targetView = item.getAttribute('data-view');
        this.switchView(targetView);
      });
    });

    // Quick links
    document.getElementById('btn-goto-today')?.addEventListener('click', () => {
      this.selectedDateStr = this.getTodayDateString();
      this.switchView('daily');
    });

    document.getElementById('dash-leave-quicklink')?.addEventListener('click', () => {
      this.switchView('leave');
    });

    document.getElementById('btn-dash-add-subj')?.addEventListener('click', () => {
      this.openSubjectModal();
    });

    document.getElementById('btn-empty-add-subj')?.addEventListener('click', () => {
      this.openSubjectModal();
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-view') === viewName);
    });

    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    this.renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  renderCurrentView() {
    switch (this.currentView) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'daily':
        this.renderDailyView();
        break;
      case 'timetable':
        this.renderTimetableView();
        break;
      case 'subjects':
        this.renderSubjectsView();
        break;
      case 'leave':
        this.renderLeaveView();
        break;
      case 'reports':
        this.renderReportsView();
        break;
      case 'settings':
        this.renderSettingsView();
        break;
    }
  }

  setupThemeToggle() {
    const btn = document.getElementById('theme-toggle-btn');
    btn?.addEventListener('click', async () => {
      const current = document.documentElement.getAttribute('data-theme');
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      await DBService.saveSetting('appTheme', nextTheme);
    });
  }

  // ================= 1. DASHBOARD LOGIC =================

  renderDashboard() {
    // 1. Date Header
    const today = this.getTodayDateString();
    document.getElementById('dash-today-date').textContent = this.formatDateDisplay(today);

    // 2. Pending Session Alert
    const pendingSessions = this.currentSessions.filter(s => s.status === 'pending');
    const pendingCount = pendingSessions.length;
    const pendingAlert = document.getElementById('dash-pending-alert');
    const pendingDot = document.getElementById('nav-pending-dot');

    if (pendingCount > 0) {
      pendingAlert.style.display = 'flex';
      document.getElementById('dash-pending-count').textContent = pendingCount;
      if (pendingDot) pendingDot.style.display = 'block';
    } else {
      pendingAlert.style.display = 'none';
      if (pendingDot) pendingDot.style.display = 'none';
    }

    // 3. Weighted Aggregates
    const aggTheory = AttendanceEngine.calculateAggregate(this.subjects, this.currentSessions, 'theory', this.theoryMin, this.safetyBuffer);
    const aggClinical = AttendanceEngine.calculateAggregate(this.subjects, this.currentSessions, 'clinical', this.clinicalMin, this.safetyBuffer);

    this.renderAggregateCard('agg-theory', aggTheory, this.theoryMin);
    this.renderAggregateCard('agg-clin', aggClinical, this.clinicalMin);

    // 4. Subject Cards
    const container = document.getElementById('dash-subjects-list');
    if (!this.subjects || this.subjects.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:24px;">
          <p style="margin-bottom:12px;">No subjects configured yet. Add your 4th-year MBBS subjects to start tracking!</p>
          <button id="btn-empty-add-subj-inner" class="btn btn-primary">+ Add First Subject</button>
        </div>
      `;
      document.getElementById('btn-empty-add-subj-inner')?.addEventListener('click', () => this.openSubjectModal());
      return;
    }

    container.innerHTML = '';
    this.subjects.forEach(subj => {
      const subjSessions = this.currentSessions.filter(s => s.subjectId === subj.id);
      const summary = AttendanceEngine.calculateSubjectSummary(subj, subjSessions, this.safetyBuffer);
      const card = document.createElement('div');
      card.className = 'card';

      card.innerHTML = `
        <div class="card-header">
          <div>
            <h3 style="margin:0; font-size:1.05rem;">${subj.name}</h3>
            <span style="font-size:0.75rem; color:var(--text-muted);">${subj.historicalBaseline?.referencePeriod || '4th Year'}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <span class="badge badge-${summary.theory.statusClass}">Theory: ${summary.theory.statusLabel}</span>
            <span class="badge badge-${summary.clinical.statusClass}">Clinical: ${summary.clinical.statusLabel}</span>
          </div>
        </div>

        <div class="form-row" style="margin-top:8px;">
          <!-- Theory Box -->
          <div style="background:var(--bg-surface-elevated); padding:10px; border-radius:var(--radius-md);">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:0.72rem; color:var(--text-muted); font-weight:700;">THEORY (${summary.theory.minPercent}%)</span>
              <strong style="font-size:1.15rem; color:${summary.theory.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${summary.theory.formattedPercentage}</strong>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
              ${summary.theory.attended} / ${summary.theory.conducted} confirmed
            </div>
            <div class="safe-bunk-callout" style="padding:4px 8px; margin-top:6px;">
              <span>Safe bunks:</span>
              <strong style="color:${summary.theory.safeAbsences === 0 ? 'var(--status-danger)' : 'var(--status-safe)'};">${summary.theory.safeAbsences}</strong>
            </div>
            ${summary.theory.deficitClassesToRecover > 0 ? `<div style="font-size:0.7rem; color:var(--status-danger); margin-top:4px;">Need ${summary.theory.deficitClassesToRecover} consecutive classes to recover 75%</div>` : ''}
          </div>

          <!-- Clinical Box -->
          <div style="background:var(--bg-surface-elevated); padding:10px; border-radius:var(--radius-md);">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:0.72rem; color:var(--text-muted); font-weight:700;">CLINICAL (${summary.clinical.minPercent}%)</span>
              <strong style="font-size:1.15rem; color:${summary.clinical.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${summary.clinical.formattedPercentage}</strong>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
              ${summary.clinical.attended} / ${summary.clinical.conducted} confirmed
            </div>
            <div class="safe-bunk-callout" style="padding:4px 8px; margin-top:6px;">
              <span>Safe bunks:</span>
              <strong style="color:${summary.clinical.safeAbsences === 0 ? 'var(--status-danger)' : 'var(--status-safe)'};">${summary.clinical.safeAbsences}</strong>
            </div>
            ${summary.clinical.deficitClassesToRecover > 0 ? `<div style="font-size:0.7rem; color:var(--status-danger); margin-top:4px;">Need ${summary.clinical.deficitClassesToRecover} consecutive classes to recover 80%</div>` : ''}
          </div>
        </div>
      `;

      container.appendChild(card);
    });
  }

  renderAggregateCard(prefix, aggregate, minPercent) {
    const percentEl = document.getElementById(`${prefix}-percent`);
    const countsEl = document.getElementById(`${prefix}-counts`);
    const progressEl = document.getElementById(`${prefix}-progress`);
    const badgeEl = document.getElementById(`${prefix}-badge`);
    const bunksEl = document.getElementById(`${prefix}-bunks`);

    percentEl.textContent = aggregate.formattedPercentage;
    countsEl.textContent = `${aggregate.attended} / ${aggregate.conducted} classes confirmed`;

    const pct = aggregate.percentage ?? 0;
    progressEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
    progressEl.className = `progress-bar-fill ${aggregate.statusClass}`;

    badgeEl.textContent = aggregate.statusLabel;
    badgeEl.className = `badge badge-${aggregate.statusClass}`;

    bunksEl.textContent = `Safe bunks: ${aggregate.safeAbsences}`;
  }

  // ================= 2. DAILY ATTENDANCE LOGIC =================

  setupDailyViewEvents() {
    const prevBtn = document.getElementById('btn-prev-day');
    const nextBtn = document.getElementById('btn-next-day');
    const trigger = document.getElementById('daily-date-picker-trigger');
    const nativePicker = document.getElementById('native-date-input');

    prevBtn?.addEventListener('click', () => {
      this.adjustSelectedDate(-1);
    });

    nextBtn?.addEventListener('click', () => {
      this.adjustSelectedDate(1);
    });

    trigger?.addEventListener('click', () => {
      nativePicker.value = this.selectedDateStr;
      nativePicker.showPicker ? nativePicker.showPicker() : nativePicker.click();
    });

    nativePicker?.addEventListener('change', (e) => {
      if (e.target.value) {
        this.selectedDateStr = e.target.value;
        this.renderDailyView();
      }
    });

    document.getElementById('btn-mark-all-present')?.addEventListener('click', async () => {
      await this.markAllSessionsForDate('present');
    });

    document.getElementById('btn-toggle-holiday')?.addEventListener('click', async () => {
      await this.toggleDayHoliday();
    });

    document.getElementById('btn-add-extra-session')?.addEventListener('click', () => {
      this.openExtraClassModal();
    });
  }

  adjustSelectedDate(days) {
    const d = new Date(this.selectedDateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    this.selectedDateStr = d.toISOString().split('T')[0];
    this.renderDailyView();
  }

  async renderDailyView() {
    const headingEl = document.getElementById('daily-date-heading');
    const subEl = document.getElementById('daily-date-sub');
    const container = document.getElementById('daily-sessions-list');

    const isToday = this.selectedDateStr === this.getTodayDateString();
    headingEl.textContent = isToday ? 'Today' : this.formatDateDisplay(this.selectedDateStr);
    subEl.textContent = this.formatDateDisplay(this.selectedDateStr);

    // Get date override if any
    const dateOverride = await DBService.getDateOverride(this.selectedDateStr);
    const existingSessions = await DBService.getSessionsForDate(this.selectedDateStr);

    const holidayBtn = document.getElementById('btn-toggle-holiday');
    if (holidayBtn) {
      holidayBtn.textContent = (dateOverride && dateOverride.isHoliday) ? 'Unmark Holiday' : 'Day is Holiday';
    }

    if (dateOverride && dateOverride.isHoliday) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:32px;">
          <h3 style="color:#6366f1;">College Holiday</h3>
          <p>This entire day is marked as a holiday. All scheduled classes are excluded from attendance calculations.</p>
        </div>
      `;
      return;
    }

    // Resolve sessions from timetable version if not already created
    const daySessions = TimetableEngine.resolveSessionsForDate({
      dateStr: this.selectedDateStr,
      existingSessions,
      timetableVersions: this.timetableVersions,
      rotations: this.rotations,
      dateOverride,
      subjects: this.subjects
    });

    // Auto-save generated pending sessions if not yet persisted in DB
    if (existingSessions.length === 0 && daySessions.length > 0) {
      await DBService.saveSessionsBatch(daySessions);
      await this.refreshData();
    }

    if (daySessions.length === 0) {
      const dateObj = new Date(this.selectedDateStr + 'T12:00:00');
      const isSunday = dateObj.getDay() === 0;
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:32px;">
          <h3>${isSunday ? 'Sunday - Weekly Off' : 'No Classes Scheduled'}</h3>
          <p>No classes scheduled for this date. You can add a special or rescheduled class if needed.</p>
          <button id="btn-empty-add-class" class="btn btn-secondary btn-sm" style="margin-top:10px;">+ Add Extra Class</button>
        </div>
      `;
      document.getElementById('btn-empty-add-class')?.addEventListener('click', () => this.openExtraClassModal());
      return;
    }

    container.innerHTML = '';
    daySessions.forEach(session => {
      const matchedSubj = this.subjects.find(s => s.id === session.subjectId);
      const subjName = matchedSubj ? matchedSubj.name : (session.postingDepartmentName || 'Clinical Posting');

      const card = document.createElement('div');
      card.className = 'session-item';

      card.innerHTML = `
        <div class="session-header">
          <div>
            <span class="session-time">${session.startTime} - ${session.endTime}</span>
            <div class="session-title">${subjName}</div>
            <div class="session-meta">
              <span>Category: <strong>${session.category === 'theory' ? 'Theory (1 class)' : 'Clinical Posting (1 class)'}</strong></span>
              ${session.postingDepartmentName ? `<span>Rotation: <strong>${session.postingDepartmentName}</strong></span>` : ''}
            </div>
          </div>
          <span class="badge badge-${this.getStatusBadgeClass(session.status)}">${this.formatStatus(session.status)}</span>
        </div>

        <div class="session-actions">
          <button class="status-btn ${session.status === 'present' ? 'active-present' : ''}" data-status="present">
            Present
          </button>
          <button class="status-btn ${session.status === 'absent' ? 'active-absent' : ''}" data-status="absent">
            Absent
          </button>
          <button class="status-btn ${session.status === 'cancelled' ? 'active-cancelled' : ''}" data-status="cancelled">
            Cancelled
          </button>
          <button class="status-btn ${session.status === 'holiday' ? 'active-holiday' : ''}" data-status="holiday">
            Holiday
          </button>
        </div>
      `;

      // Status button events
      const buttons = card.querySelectorAll('.status-btn');
      buttons.forEach(btn => {
        btn.addEventListener('click', async () => {
          const newStatus = btn.getAttribute('data-status');
          // If clicking active button, revert to pending
          const finalStatus = (session.status === newStatus) ? 'pending' : newStatus;
          session.status = finalStatus;
          await DBService.saveSession(session);
          await this.refreshData();
          this.renderDailyView();
          // Update dashboard pending badge
          this.renderDashboard();
        });
      });

      container.appendChild(card);
    });
  }

  async markAllSessionsForDate(status) {
    const existing = await DBService.getSessionsForDate(this.selectedDateStr);
    if (existing && existing.length > 0) {
      existing.forEach(s => s.status = status);
      await DBService.saveSessionsBatch(existing);
      await this.refreshData();
      this.renderDailyView();
      this.renderDashboard();
    }
  }

  async toggleDayHoliday() {
    const existingOverride = await DBService.getDateOverride(this.selectedDateStr);
    const isNowHoliday = !(existingOverride && existingOverride.isHoliday);

    await DBService.saveDateOverride({
      date: this.selectedDateStr,
      isHoliday: isNowHoliday,
      holidayTitle: isNowHoliday ? 'Full Day Holiday' : ''
    });

    // If marked holiday, update any existing sessions for this date to holiday
    if (isNowHoliday) {
      const existing = await DBService.getSessionsForDate(this.selectedDateStr);
      if (existing.length > 0) {
        existing.forEach(s => s.status = 'holiday');
        await DBService.saveSessionsBatch(existing);
      }
    }

    await this.refreshData();
    this.renderDailyView();
    this.renderDashboard();
  }

  getStatusBadgeClass(status) {
    switch (status) {
      case 'present': return 'safe';
      case 'absent': return 'danger';
      case 'cancelled': return 'neutral';
      case 'holiday': return 'neutral';
      default: return 'pending';
    }
  }

  formatStatus(status) {
    switch (status) {
      case 'present': return 'Present';
      case 'absent': return 'Absent';
      case 'cancelled': return 'Cancelled';
      case 'holiday': return 'Holiday';
      default: return 'Pending';
    }
  }

  // ================= 3. TIMETABLE VIEW LOGIC =================

  renderTimetableView() {
    const activeVersion = TimetableEngine.getActiveVersionForDate(this.timetableVersions, this.getTodayDateString());
    if (activeVersion) {
      document.getElementById('tt-active-version-name').textContent = activeVersion.name;
      document.getElementById('tt-active-version-date').textContent = `Effective from: ${activeVersion.effectiveStartDate}`;
    }

    const tabs = document.querySelectorAll('.tt-day-tab');
    tabs.forEach(tab => {
      tab.classList.toggle('active', parseInt(tab.getAttribute('data-day'), 10) === this.selectedTimetableDay);
      tab.onclick = () => {
        this.selectedTimetableDay = parseInt(tab.getAttribute('data-day'), 10);
        this.renderTimetableView();
      };
    });

    const container = document.getElementById('tt-slots-list');
    container.innerHTML = '';

    if (!activeVersion || !activeVersion.slots) return;

    const daySlots = activeVersion.slots.filter(s => s.dayOfWeek === this.selectedTimetableDay);

    daySlots.forEach((slot, idx) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginBottom = '8px';

      const matchedSubj = this.subjects.find(s => s.id === slot.subjectId);
      const displayTitle = matchedSubj ? matchedSubj.name : (slot.type === 'clinical' ? 'Clinical Posting' : 'Unassigned');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span class="session-time">${slot.startTime} - ${slot.endTime}</span>
            <h4 style="margin:4px 0 2px 0;">${displayTitle}</h4>
            <span style="font-size:0.75rem; color:var(--text-muted);">${slot.type === 'theory' ? 'Theory (1 class)' : 'Clinical Posting (1 class)'}</span>
          </div>
          <button class="btn btn-secondary btn-sm btn-edit-slot" data-slot-id="${slot.id}">Assign</button>
        </div>
      `;

      card.querySelector('.btn-edit-slot').onclick = () => {
        this.openSlotAssignPrompt(slot, activeVersion);
      };

      container.appendChild(card);
    });

    // 4-6 PM extra weekday class configuration button
    const extraCard = document.createElement('div');
    extraCard.className = 'card';
    extraCard.style.borderStyle = 'dashed';
    extraCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span class="session-time">16:00 - 18:00</span>
          <h4 style="margin:4px 0 2px 0;">4–6 PM Additional Class</h4>
          <span style="font-size:0.75rem; color:var(--text-muted);">Configure optional 4-6 PM class on this weekday</span>
        </div>
        <button id="btn-add-4to6-slot" class="btn btn-secondary btn-sm">+ Add Slot</button>
      </div>
    `;
    extraCard.querySelector('#btn-add-4to6-slot').onclick = () => {
      this.add4to6Slot(activeVersion);
    };
    container.appendChild(extraCard);
  }

  async openSlotAssignPrompt(slot, version) {
    if (this.subjects.length === 0) {
      alert('Please add your subjects first in the Subjects tab!');
      this.switchView('subjects');
      return;
    }

    const options = this.subjects.map(s => `${s.name}`).join('\n');
    const selected = prompt(`Assign subject to slot (${slot.startTime}-${slot.endTime}):\n\nEnter subject name or number:\n` + 
      this.subjects.map((s, i) => `${i + 1}. ${s.name}`).join('\n'));

    if (selected) {
      const idx = parseInt(selected.trim(), 10) - 1;
      let matched = null;
      if (!isNaN(idx) && this.subjects[idx]) {
        matched = this.subjects[idx];
      } else {
        matched = this.subjects.find(s => s.name.toLowerCase() === selected.trim().toLowerCase());
      }

      if (matched) {
        slot.subjectId = matched.id;
        await DBService.saveTimetableVersion(version);
        await this.refreshData();
        this.renderTimetableView();
      }
    }
  }

  async add4to6Slot(version) {
    const existing = version.slots.find(s => s.dayOfWeek === this.selectedTimetableDay && s.startTime === '16:00');
    if (existing) {
      alert('A 4-6 PM slot already exists on this day.');
      return;
    }

    const newSlot = {
      id: `slot_${this.selectedTimetableDay}_4to6`,
      dayOfWeek: this.selectedTimetableDay,
      startTime: '16:00',
      endTime: '18:00',
      type: 'theory',
      subjectId: null,
      label: 'Additional Class (4-6 PM)'
    };

    version.slots.push(newSlot);
    await DBService.saveTimetableVersion(version);
    await this.refreshData();
    this.renderTimetableView();
  }

  setupTimetableEvents() {
    const modal = document.getElementById('modal-timetable-version');
    const form = document.getElementById('form-timetable-version');
    const openBtn = document.getElementById('btn-new-timetable-version');
    const closeBtns = modal ? modal.querySelectorAll('.btn-close-modal') : [];

    openBtn?.addEventListener('click', () => {
      form.reset();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      document.getElementById('tt-new-start-date').value = tomorrow.toISOString().split('T')[0];
      modal.classList.add('active');
    });

    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => modal.classList.remove('active'));
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('tt-new-name').value.trim();
      const startDate = document.getElementById('tt-new-start-date').value;

      // Duplicate slots from latest version or default
      const latestVersion = this.timetableVersions[this.timetableVersions.length - 1];
      const clonedSlots = latestVersion && latestVersion.slots ? JSON.parse(JSON.stringify(latestVersion.slots)) : TimetableEngine.createDefaultSlots();

      const newVersion = {
        id: 'tt_' + Date.now(),
        name,
        effectiveStartDate: startDate,
        slots: clonedSlots
      };

      await DBService.saveTimetableVersion(newVersion);
      await this.refreshData();
      modal.classList.remove('active');
      this.renderTimetableView();
      alert(`New timetable version "${name}" created, effective from ${startDate}!`);
    });
  }

  // ================= 4. SUBJECTS & ROTATIONS VIEW =================

  setupSubjectModalEvents() {
    const modal = document.getElementById('modal-subject');
    const form = document.getElementById('form-subject');
    const closeBtns = modal.querySelectorAll('.btn-close-modal');

    document.getElementById('btn-add-subject-modal')?.addEventListener('click', () => {
      this.openSubjectModal();
    });

    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modal.classList.remove('active');
      });
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveSubjectFromForm();
      modal.classList.remove('active');
    });
  }

  openSubjectModal(subjectToEdit = null) {
    const modal = document.getElementById('modal-subject');
    const form = document.getElementById('form-subject');
    const title = document.getElementById('modal-subject-title');

    form.reset();
    if (subjectToEdit) {
      title.textContent = 'Edit Subject';
      document.getElementById('subj-edit-id').value = subjectToEdit.id;
      document.getElementById('subj-name').value = subjectToEdit.name;
      document.getElementById('subj-theory-min').value = subjectToEdit.theoryMinPercent;
      document.getElementById('subj-clinical-min').value = subjectToEdit.clinicalMinPercent;
      document.getElementById('subj-base-theory-conducted').value = subjectToEdit.historicalBaseline?.theoryConducted || 0;
      document.getElementById('subj-base-theory-attended').value = subjectToEdit.historicalBaseline?.theoryAttended || 0;
      document.getElementById('subj-base-clin-conducted').value = subjectToEdit.historicalBaseline?.clinicalConducted || 0;
      document.getElementById('subj-base-clin-attended').value = subjectToEdit.historicalBaseline?.clinicalAttended || 0;
      document.getElementById('subj-base-ref').value = subjectToEdit.historicalBaseline?.referencePeriod || '';
      document.getElementById('subj-exam-cutoff').value = subjectToEdit.examCutoffDate || '';
    } else {
      title.textContent = 'Add 4th-Year Subject';
      document.getElementById('subj-edit-id').value = '';
    }

    modal.classList.add('active');
  }

  async saveSubjectFromForm() {
    const id = document.getElementById('subj-edit-id').value;
    const name = document.getElementById('subj-name').value.trim();
    const theoryMin = parseInt(document.getElementById('subj-theory-min').value, 10);
    const clinicalMin = parseInt(document.getElementById('subj-clinical-min').value, 10);

    const baseTheoryConducted = parseInt(document.getElementById('subj-base-theory-conducted').value, 10) || 0;
    const baseTheoryAttended = parseInt(document.getElementById('subj-base-theory-attended').value, 10) || 0;
    const baseClinConducted = parseInt(document.getElementById('subj-base-clin-conducted').value, 10) || 0;
    const baseClinAttended = parseInt(document.getElementById('subj-base-clin-attended').value, 10) || 0;
    const baseRef = document.getElementById('subj-base-ref').value.trim();
    const cutoff = document.getElementById('subj-exam-cutoff').value;

    // Strict validation
    if (baseTheoryAttended > baseTheoryConducted) {
      alert('Validation Error: Past theory attended cannot exceed conducted classes.');
      return;
    }
    if (baseClinAttended > baseClinConducted) {
      alert('Validation Error: Past clinical attended cannot exceed conducted classes.');
      return;
    }

    const subjectObj = {
      id: id || undefined,
      name,
      theoryMinPercent: theoryMin,
      clinicalMinPercent: clinicalMin,
      examCutoffDate: cutoff || null,
      historicalBaseline: {
        theoryConducted: baseTheoryConducted,
        theoryAttended: baseTheoryAttended,
        clinicalConducted: baseClinConducted,
        clinicalAttended: baseClinAttended,
        referencePeriod: baseRef,
        updatedAt: new Date().toISOString()
      }
    };

    await DBService.saveSubject(subjectObj);
    await this.refreshData();
    this.renderSubjectsView();
    this.renderDashboard();
  }

  renderSubjectsView() {
    const container = document.getElementById('subjects-management-list');
    container.innerHTML = '';

    if (this.subjects.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:24px;">
          <p>No subjects added yet. Tap "+ New Subject" above to add your MBBS subjects!</p>
        </div>
      `;
    } else {
      this.subjects.forEach(subj => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-header">
            <div>
              <h3 style="margin:0;">${subj.name}</h3>
              <span style="font-size:0.75rem; color:var(--text-muted);">Thresholds: Theory ${subj.theoryMinPercent}% • Clinical ${subj.clinicalMinPercent}%</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm btn-edit-subj">Edit</button>
              <button class="btn btn-outline-danger btn-sm btn-del-subj">Delete</button>
            </div>
          </div>
          <div style="font-size:0.8rem; background:var(--bg-surface-elevated); padding:8px 12px; border-radius:var(--radius-sm);">
            <strong>Historical Baseline:</strong> Theory: ${subj.historicalBaseline?.theoryAttended || 0}/${subj.historicalBaseline?.theoryConducted || 0} • Clinical: ${subj.historicalBaseline?.clinicalAttended || 0}/${subj.historicalBaseline?.clinicalConducted || 0}
            ${subj.historicalBaseline?.referencePeriod ? `<br><span style="color:var(--text-subtle);">${subj.historicalBaseline.referencePeriod}</span>` : ''}
          </div>
        `;

        card.querySelector('.btn-edit-subj').onclick = () => this.openSubjectModal(subj);
        card.querySelector('.btn-del-subj').onclick = async () => {
          if (confirm(`Delete subject "${subj.name}"? This will not delete recorded attendance sessions.`)) {
            await DBService.deleteSubject(subj.id);
            await this.refreshData();
            this.renderSubjectsView();
            this.renderDashboard();
          }
        };

        container.appendChild(card);
      });
    }

    this.renderRotationsList();
  }

  setupRotationModalEvents() {
    const modal = document.getElementById('modal-rotation');
    const form = document.getElementById('form-rotation');
    const closeBtns = modal.querySelectorAll('.btn-close-modal');

    document.getElementById('btn-add-rotation-modal')?.addEventListener('click', () => {
      this.openRotationModal();
    });

    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => modal.classList.remove('active'));
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveRotationFromForm();
      modal.classList.remove('active');
    });
  }

  openRotationModal() {
    const modal = document.getElementById('modal-rotation');
    const select = document.getElementById('rot-linked-subject');
    select.innerHTML = '';

    this.subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    });

    document.getElementById('form-rotation').reset();
    document.getElementById('rot-edit-id').value = '';
    modal.classList.add('active');
  }

  async saveRotationFromForm() {
    const deptName = document.getElementById('rot-dept-name').value.trim();
    const linkedSubjectId = document.getElementById('rot-linked-subject').value;
    const startDate = document.getElementById('rot-start-date').value;
    const endDate = document.getElementById('rot-end-date').value;
    const minThreshold = parseInt(document.getElementById('rot-threshold').value, 10) || 80;

    if (endDate < startDate) {
      alert('End date cannot be earlier than start date.');
      return;
    }

    await DBService.savePostingRotation({
      departmentName: deptName,
      linkedSubjectId,
      startDate,
      endDate,
      minimumThreshold: minThreshold
    });

    await this.refreshData();
    this.renderSubjectsView();
  }

  renderRotationsList() {
    const container = document.getElementById('rotations-management-list');
    container.innerHTML = '';

    if (this.rotations.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:20px;">
          <p>No clinical posting rotations configured. Tap "+ New Posting" to define postings.</p>
        </div>
      `;
      return;
    }

    this.rotations.forEach(rot => {
      const matchedSubj = this.subjects.find(s => s.id === rot.linkedSubjectId);
      const rep = AttendanceEngine.calculateRotationReport(rot, this.currentSessions);

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-header">
          <div>
            <h3 style="margin:0;">${rot.departmentName}</h3>
            <span style="font-size:0.75rem; color:var(--text-muted);">${this.formatDateDisplay(rot.startDate)} to ${this.formatDateDisplay(rot.endDate)}</span>
          </div>
          <span class="badge badge-${rep.isBelowMinimum ? 'danger' : 'safe'}">${rep.statusLabel}</span>
        </div>
        <div style="font-size:0.85rem; display:flex; justify-content:space-between; margin-top:6px;">
          <span>Linked: <strong>${matchedSubj ? matchedSubj.name : 'Unknown'}</strong></span>
          <span>Attendance: <strong>${rep.formattedPercentage}</strong> (${rep.attended}/${rep.conducted})</span>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:8px;">
          <button class="btn btn-outline-danger btn-sm btn-del-rot">Delete</button>
        </div>
      `;

      card.querySelector('.btn-del-rot').onclick = async () => {
        if (confirm(`Delete rotation "${rot.departmentName}"?`)) {
          await DBService.deletePostingRotation(rot.id);
          await this.refreshData();
          this.renderRotationsList();
        }
      };

      container.appendChild(card);
    });
  }

  // ================= 5. EXTRA CLASS MODAL =================

  setupExtraClassModalEvents() {
    const modal = document.getElementById('modal-extra-class');
    const form = document.getElementById('form-extra-class');
    const closeBtns = modal.querySelectorAll('.btn-close-modal');

    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => modal.classList.remove('active'));
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveExtraClassFromForm();
      modal.classList.remove('active');
    });
  }

  openExtraClassModal() {
    if (this.subjects.length === 0) {
      alert('Please configure subjects first.');
      this.switchView('subjects');
      return;
    }

    const modal = document.getElementById('modal-extra-class');
    const select = document.getElementById('extra-subject');
    select.innerHTML = '';
    this.subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    });

    modal.classList.add('active');
  }

  async saveExtraClassFromForm() {
    const subjectId = document.getElementById('extra-subject').value;
    const category = document.getElementById('extra-category').value;
    const startTime = document.getElementById('extra-start-time').value;
    const endTime = document.getElementById('extra-end-time').value;
    const status = document.getElementById('extra-status').value;

    const matchedSubj = this.subjects.find(s => s.id === subjectId);

    const extraSession = {
      id: `${this.selectedDateStr}_extra_${Date.now()}`,
      date: this.selectedDateStr,
      startTime,
      endTime,
      subjectId,
      subjectName: matchedSubj ? matchedSubj.name : 'Extra Class',
      category,
      postingRotationId: null,
      status,
      source: 'manual_override'
    };

    await DBService.saveSession(extraSession);
    await this.refreshData();
    this.renderDailyView();
    this.renderDashboard();
  }

  // ================= 6. LEAVE PLANNER LOGIC =================

  setupLeavePlannerEvents() {
    const runBtn = document.getElementById('btn-run-leave-simulation');
    runBtn?.addEventListener('click', () => {
      this.runLeaveSimulation();
    });
  }

  renderLeaveView() {
    // Set default dates
    const startInput = document.getElementById('leave-start-date');
    const endInput = document.getElementById('leave-end-date');
    const cutoffInput = document.getElementById('leave-cutoff-date');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);

    if (!startInput.value) startInput.value = tomorrow.toISOString().split('T')[0];
    if (!endInput.value) endInput.value = inThreeDays.toISOString().split('T')[0];
    if (!cutoffInput.value) {
      // Default to 60 days ahead
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 60);
      cutoffInput.value = cutoff.toISOString().split('T')[0];
    }
  }

  runLeaveSimulation() {
    const startDate = document.getElementById('leave-start-date').value;
    const endDate = document.getElementById('leave-end-date').value;
    const cutoffDate = document.getElementById('leave-cutoff-date').value;

    if (!startDate || !endDate || !cutoffDate) {
      alert('Please fill in all date fields.');
      return;
    }
    if (endDate < startDate) {
      alert('Leave end date cannot be earlier than leave start date.');
      return;
    }

    // Generate future scheduled sessions up to cut-off
    const futureSessions = TimetableEngine.generateFutureSchedule({
      startDate: this.getTodayDateString(),
      cutoffDate,
      timetableVersions: this.timetableVersions,
      rotations: this.rotations,
      dateOverrides: [],
      subjects: this.subjects
    });

    const simulation = AttendanceEngine.simulateLeaveForecast({
      subjects: this.subjects,
      currentSessions: this.currentSessions,
      futureScheduledSessions: futureSessions,
      leaveStartDate: startDate,
      leaveEndDate: endDate,
      safetyBuffer: this.safetyBuffer
    });

    this.renderSimulationResults(simulation);
  }

  renderSimulationResults(sim) {
    const container = document.getElementById('leave-results-container');
    container.style.display = 'block';

    const statusBadgeClass = sim.planStatus === 'SAFE' ? 'safe' : (sim.planStatus === 'RISKY' ? 'risk' : 'danger');

    let violationsHTML = '';
    if (sim.violationReasons.length > 0) {
      violationsHTML = `
        <div class="alert-banner danger" style="margin-top:12px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div>
            <strong>Warnings Identified:</strong>
            <ul style="margin-left:16px; margin-top:4px;">
              ${sim.violationReasons.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        </div>
      `;
    }

    let subjectsTableHTML = sim.subjectForecasts.map(sf => `
      <tr>
        <td style="padding:8px; border-bottom:1px solid var(--border-color);"><strong>${sf.subject.name}</strong></td>
        <td style="padding:8px; border-bottom:1px solid var(--border-color);">${sf.missedTheory} theory, ${sf.missedClinical} clinical</td>
        <td style="padding:8px; border-bottom:1px solid var(--border-color); color:${sf.theory.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${sf.theory.formattedPercentage}</td>
        <td style="padding:8px; border-bottom:1px solid var(--border-color); color:${sf.clinical.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${sf.clinical.formattedPercentage}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0;">Leave Impact Analysis</h3>
          <span class="badge badge-${statusBadgeClass}" style="font-size:0.85rem; padding:4px 12px;">Plan: ${sim.planStatus}</span>
        </div>
        <p style="margin-top:4px;">Forecast for leave from ${this.formatDateDisplay(sim.leaveStartDate)} to ${this.formatDateDisplay(sim.leaveEndDate)}</p>

        ${violationsHTML}

        <div style="overflow-x:auto; margin-top:12px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead>
              <tr style="text-align:left; color:var(--text-muted); border-bottom:1px solid var(--border-color);">
                <th style="padding:8px;">Subject</th>
                <th style="padding:8px;">Missed Classes</th>
                <th style="padding:8px;">Projected Theory</th>
                <th style="padding:8px;">Projected Clinical</th>
              </tr>
            </thead>
            <tbody>
              ${subjectsTableHTML}
            </tbody>
          </table>
        </div>

        <div class="form-row" style="margin-top:14px;">
          <div style="background:var(--bg-surface-elevated); padding:10px; border-radius:var(--radius-md);">
            <div style="font-size:0.75rem; color:var(--text-muted);">PROJECTED AGGREGATE THEORY</div>
            <strong style="font-size:1.2rem; color:${sim.aggregateTheory.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${sim.aggregateTheory.formattedPercentage}</strong>
            <span style="font-size:0.75rem;">(${sim.aggregateTheory.attended}/${sim.aggregateTheory.conducted})</span>
          </div>
          <div style="background:var(--bg-surface-elevated); padding:10px; border-radius:var(--radius-md);">
            <div style="font-size:0.75rem; color:var(--text-muted);">PROJECTED AGGREGATE CLINICAL</div>
            <strong style="font-size:1.2rem; color:${sim.aggregateClinical.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${sim.aggregateClinical.formattedPercentage}</strong>
            <span style="font-size:0.75rem;">(${sim.aggregateClinical.attended}/${sim.aggregateClinical.conducted})</span>
          </div>
        </div>
      </div>
    `;
  }

  // ================= 7. REPORTS VIEW =================

  setupReportsEvents() {
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      this.exportCSVReport();
    });

    document.getElementById('btn-print-report')?.addEventListener('click', () => {
      window.print();
    });
  }

  renderReportsView() {
    const container = document.getElementById('reports-content-container');
    const aggTheory = AttendanceEngine.calculateAggregate(this.subjects, this.currentSessions, 'theory', this.theoryMin, this.safetyBuffer);
    const aggClinical = AttendanceEngine.calculateAggregate(this.subjects, this.currentSessions, 'clinical', this.clinicalMin, this.safetyBuffer);

    let rowsHTML = this.subjects.map(subj => {
      const subjSessions = this.currentSessions.filter(s => s.subjectId === subj.id);
      const rep = AttendanceEngine.calculateSubjectSummary(subj, subjSessions, this.safetyBuffer);

      return `
        <tr>
          <td style="padding:10px; border-bottom:1px solid var(--border-color);"><strong>${subj.name}</strong></td>
          <td style="padding:10px; border-bottom:1px solid var(--border-color);">${rep.theory.attended} / ${rep.theory.conducted}</td>
          <td style="padding:10px; border-bottom:1px solid var(--border-color); color:${rep.theory.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${rep.theory.formattedPercentage}</td>
          <td style="padding:10px; border-bottom:1px solid var(--border-color);">${rep.clinical.attended} / ${rep.clinical.conducted}</td>
          <td style="padding:10px; border-bottom:1px solid var(--border-color); color:${rep.clinical.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${rep.clinical.formattedPercentage}</td>
          <td style="padding:10px; border-bottom:1px solid var(--border-color);"><span class="badge badge-${rep.theory.statusClass}">${rep.theory.statusLabel}</span></td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card">
        <h3 class="card-title">Comprehensive Attendance Audit</h3>
        <p style="margin-bottom:14px;">Complete verified subject-wise records including historical baselines and current sessions.</p>

        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead>
              <tr style="text-align:left; color:var(--text-muted); border-bottom:1px solid var(--border-color);">
                <th style="padding:10px;">Subject</th>
                <th style="padding:10px;">Theory (Att/Total)</th>
                <th style="padding:10px;">Theory %</th>
                <th style="padding:10px;">Clinical (Att/Total)</th>
                <th style="padding:10px;">Clinical %</th>
                <th style="padding:10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHTML || '<tr><td colspan="6" style="padding:16px; text-align:center;">No subjects available</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="font-weight:700; background:var(--bg-surface-elevated);">
                <td style="padding:10px;">Weighted Aggregate</td>
                <td style="padding:10px;">${aggTheory.attended} / ${aggTheory.conducted}</td>
                <td style="padding:10px; color:${aggTheory.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${aggTheory.formattedPercentage}</td>
                <td style="padding:10px;">${aggClinical.attended} / ${aggClinical.conducted}</td>
                <td style="padding:10px; color:${aggClinical.isBelowMinimum ? 'var(--status-danger)' : 'var(--text-main)'};">${aggClinical.formattedPercentage}</td>
                <td style="padding:10px;"><span class="badge badge-${aggTheory.statusClass}">${aggTheory.statusLabel}</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  exportCSVReport() {
    let csv = 'Subject,Theory Attended,Theory Total,Theory %,Clinical Attended,Clinical Total,Clinical %,Theory Safe Bunks,Clinical Safe Bunks\n';

    this.subjects.forEach(subj => {
      const subjSessions = this.currentSessions.filter(s => s.subjectId === subj.id);
      const rep = AttendanceEngine.calculateSubjectSummary(subj, subjSessions, this.safetyBuffer);

      csv += `"${subj.name}",${rep.theory.attended},${rep.theory.conducted},${rep.theory.percentage ?? 0},${rep.clinical.attended},${rep.clinical.conducted},${rep.clinical.percentage ?? 0},${rep.theory.safeAbsences},${rep.clinical.safeAbsences}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mbbs_attendance_report_${this.getTodayDateString()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ================= 8. SETTINGS, BACKUP & ACCEPTANCE TESTS =================

  setupSettingsEvents() {
    document.getElementById('btn-backup-data')?.addEventListener('click', async () => {
      await this.exportBackupFile();
    });

    const restoreTrigger = document.getElementById('btn-restore-trigger');
    const fileInput = document.getElementById('backup-file-input');

    restoreTrigger?.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.handleBackupFileSelected(file);
        fileInput.value = '';
      }
    });

    document.getElementById('btn-confirm-restore')?.addEventListener('click', async () => {
      if (this.pendingRestoreBackup) {
        await DBService.restoreFullBackup(this.pendingRestoreBackup);
        this.pendingRestoreBackup = null;
        document.getElementById('modal-restore-preview').classList.remove('active');
        alert('Backup successfully restored! Your attendance records have been reloaded.');
        await this.refreshData();
        this.renderCurrentView();
      }
    });

    document.getElementById('btn-save-threshold-settings')?.addEventListener('click', async () => {
      const tm = parseInt(document.getElementById('setting-theory-min').value, 10);
      const cm = parseInt(document.getElementById('setting-clinical-min').value, 10);
      const sb = parseInt(document.getElementById('setting-safety-buffer').value, 10);

      await DBService.saveSetting('theoryMinPercent', tm);
      await DBService.saveSetting('clinicalMinPercent', cm);
      await DBService.saveSetting('safetyBuffer', sb);

      this.theoryMin = tm;
      this.clinicalMin = cm;
      this.safetyBuffer = sb;

      alert('Threshold preferences saved!');
      await this.refreshData();
      this.renderDashboard();
    });
  }

  async exportBackupFile() {
    const backup = await DBService.exportFullBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = this.getTodayDateString();
    link.href = url;
    link.download = `mbbs_attendance_backup_${dateStr}.json`;
    link.click();
    URL.revokeObjectURL(url);

    await DBService.saveSetting('lastBackupDate', new Date().toISOString());
    this.renderSettingsView();
  }

  async handleBackupFileSelected(file) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const validation = await DBService.validateBackupFile(json);

      this.pendingRestoreBackup = json;
      const modal = document.getElementById('modal-restore-preview');
      const summaryEl = document.getElementById('restore-summary-content');

      summaryEl.innerHTML = `
        <div><strong>Backup Export Date:</strong> ${this.formatDateDisplay(validation.summary.exportDate.split('T')[0])}</div>
        <div><strong>Subjects:</strong> ${validation.summary.subjectCount}</div>
        <div><strong>Attendance Sessions:</strong> ${validation.summary.sessionCount}</div>
        <div><strong>Timetable Versions:</strong> ${validation.summary.timetableCount}</div>
        <div><strong>Posting Rotations:</strong> ${validation.summary.rotationCount}</div>
      `;

      modal.classList.add('active');
    } catch (err) {
      alert(`Invalid backup file: ${err.message}`);
    }
  }

  async checkBackupReminder() {
    const lastBackup = await DBService.getSetting('lastBackupDate');
    const statusText = document.getElementById('backup-status-text');
    if (!statusText) return;

    if (!lastBackup) {
      statusText.textContent = 'Last backup: Never. Please create a backup to safeguard your data.';
      statusText.style.color = 'var(--status-risk)';
    } else {
      const days = Math.floor((new Date() - new Date(lastBackup)) / (1000 * 60 * 60 * 24));
      statusText.textContent = `Last backup: ${days === 0 ? 'Today' : `${days} day(s) ago`}`;
      if (days >= 7) {
        statusText.textContent += ' (Backup recommended)';
        statusText.style.color = 'var(--status-risk)';
      }
    }
  }

  renderSettingsView() {
    this.checkBackupReminder();
  }

  // ================= ACCEPTANCE TEST RUNNER =================

  setupAcceptanceTestsEvents() {
    const runBtn = document.getElementById('btn-run-acceptance-tests');
    runBtn?.addEventListener('click', async () => {
      runBtn.textContent = 'Running tests...';
      runBtn.disabled = true;

      const results = await TestRunner.runAllTests();
      this.renderTestResults(results);

      runBtn.textContent = 'Run Acceptance Tests Now';
      runBtn.disabled = false;
    });
  }

  renderTestResults(results) {
    const container = document.getElementById('test-results-container');
    container.style.display = 'block';

    const allPassed = results.every(r => r.passed);

    let html = `
      <div class="alert-banner ${allPassed ? 'info' : 'danger'}" style="margin-bottom:12px;">
        <strong>${allPassed ? 'All Acceptance Tests Passed (100%)' : 'Some Tests Failed'}</strong>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
    `;

    results.forEach(r => {
      html += `
        <div style="background:var(--bg-surface-elevated); padding:10px 12px; border-radius:var(--radius-md); font-size:0.82rem; border-left:4px solid ${r.passed ? 'var(--status-safe)' : 'var(--status-danger)'};">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${r.name}</strong>
            <span class="badge badge-${r.passed ? 'safe' : 'danger'}">${r.passed ? 'PASS' : 'FAIL'}</span>
          </div>
          <div style="color:var(--text-muted); margin-top:4px;">${r.note || ''}</div>
          <div style="font-size:0.75rem; color:var(--text-subtle); margin-top:2px;">
            Expected: <code>${r.expected}</code> | Actual: <code>${r.actual}</code>
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }
}

// Instantiate and start app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new MBBSAttendanceApp();
  app.init();
});
