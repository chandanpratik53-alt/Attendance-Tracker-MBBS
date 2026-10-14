// MBBS Attendance Tracker - Timetable Engine & Schedule Resolver
// Handles versioning, clinical posting rotation matching, and slot expansion

export const TimetableEngine = {
  /**
   * Generates the default MBBS 4th Year Weekly Timetable slots
   */
  createDefaultSlots() {
    const slots = [];
    // Mon (1) to Fri (5)
    for (let day = 1; day <= 5; day++) {
      slots.push({ id: `slot_${day}_1`, dayOfWeek: day, startTime: '08:00', endTime: '09:00', type: 'theory', subjectId: null, label: 'Theory Class 1' });
      slots.push({ id: `slot_${day}_2`, dayOfWeek: day, startTime: '09:00', endTime: '10:00', type: 'theory', subjectId: null, label: 'Theory Class 2' });
      slots.push({ id: `slot_${day}_3`, dayOfWeek: day, startTime: '10:00', endTime: '13:00', type: 'clinical', subjectId: null, defaultPostingDepartment: '', label: 'Clinical Posting (10am-1pm)' });
      // 1:00-2:00 PM is Lunch (Excluded)
      slots.push({ id: `slot_${day}_4`, dayOfWeek: day, startTime: '14:00', endTime: '16:00', type: 'theory', subjectId: null, label: 'Theory Class 3 (2-4pm)' });
    }

    // Saturday (6)
    slots.push({ id: `slot_6_1`, dayOfWeek: 6, startTime: '08:00', endTime: '09:00', type: 'theory', subjectId: null, label: 'Theory Class 1' });
    slots.push({ id: `slot_6_2`, dayOfWeek: 6, startTime: '09:00', endTime: '10:00', type: 'theory', subjectId: null, label: 'Theory Class 2' });
    slots.push({ id: `slot_6_3`, dayOfWeek: 6, startTime: '10:00', endTime: '13:00', type: 'clinical', subjectId: null, defaultPostingDepartment: '', label: 'Clinical Posting (10am-1pm)' });

    // Sunday (0) has no slots by default
    return slots;
  },

  /**
   * Find the applicable timetable version for a given date
   * @param {Array} versions - Sorted by effectiveStartDate ascending
   * @param {string} dateStr - 'YYYY-MM-DD'
   */
  getActiveVersionForDate(versions, dateStr) {
    if (!versions || versions.length === 0) return null;
    // Filter versions effective on or before dateStr
    const valid = versions.filter(v => v.effectiveStartDate <= dateStr);
    if (valid.length === 0) {
      // If date is before earliest version, fall back to earliest
      return versions[0];
    }
    // Return latest version that took effect on or before dateStr
    return valid[valid.length - 1];
  },

  /**
   * Find any active clinical rotation on a given date
   */
  getActiveRotationForDate(rotations, dateStr) {
    if (!rotations) return null;
    return rotations.find(r => dateStr >= r.startDate && dateStr <= r.endDate) || null;
  },

  /**
   * Resolves or generates the sessions for a specific date
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {Array} existingSessions - Any already saved sessions from DB
   * @param {Array} timetableVersions - All timetable versions
   * @param {Array} rotations - All clinical rotations
   * @param {Object} dateOverride - Full-day holiday or day swap override
   * @param {Array} subjects - List of all configured subjects
   */
  /**
   * Calculates the ordinal occurrence of a weekday in its calendar month (1st, 2nd, 3rd, 4th, 5th)
   * Invariant: Day 1-7 = 1st, Day 8-14 = 2nd, Day 15-21 = 3rd, Day 22-28 = 4th, Day 29-31 = 5th
   * @param {Date} date
   * @returns {number} 1, 2, 3, 4, or 5
   */
  getOrdinalOccurrence(date) {
    return Math.ceil(date.getDate() / 7);
  },

  /**
   * Returns human-readable ordinal label (1st, 2nd, 3rd, 4th, 5th)
   */
  getOrdinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd', 'th'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },

  /**
   * Returns weekday name from dayOfWeek (0=Sun..6=Sat)
   */
  getWeekdayName(dayOfWeek) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[dayOfWeek] || 'Day';
  },

  /**
   * Calculates calendar week number of month (with configurable weekStart: 1=Mon, 0=Sun)
   */
  getCalendarWeekOfMonth(date, weekStart = 1) {
    const d = new Date(date.getTime());
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    const firstDayOfWeek = firstDay.getDay();
    const offset = (firstDayOfWeek - weekStart + 7) % 7;
    return Math.ceil((d.getDate() + offset) / 7);
  },

  /**
   * Resolves or generates the sessions for a specific date
   * Fully supports weekly, monthly ordinal rotation (1st, 2nd, 3rd, 4th, 5th occurrence),
   * calendar week rotation, and clinical rotations.
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {Array} existingSessions - Any already saved sessions from DB (Ground truth)
   * @param {Array} timetableVersions - All timetable versions
   * @param {Array} rotations - All clinical rotations
   * @param {Object} dateOverride - Full-day holiday or day swap override
   * @param {Array} subjects - List of all configured subjects
   */
  resolveSessionsForDate({
    dateStr,
    existingSessions = [],
    timetableVersions = [],
    rotations = [],
    dateOverride = null,
    subjects = []
  }) {
    // 1. Precedence 1: Existing sessions in DB are Ground Truth (never overwritten)
    if (existingSessions && existingSessions.length > 0) {
      return existingSessions;
    }

    // 2. Precedence 2: Full-day holiday override
    if (dateOverride && dateOverride.isHoliday) {
      return [];
    }

    const dateObj = new Date(dateStr + 'T12:00:00');
    let dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat

    // Day of week swap (e.g. college decides Wednesday schedule runs on Saturday)
    if (dateOverride && typeof dateOverride.timetableDaySwap === 'number') {
      dayOfWeek = dateOverride.timetableDaySwap;
    }

    // Sunday is off by default unless specially scheduled
    if (dayOfWeek === 0) {
      return [];
    }

    const version = this.getActiveVersionForDate(timetableVersions, dateStr);
    if (!version || !version.slots) {
      return [];
    }

    // Find slots matching this day of week
    const daySlots = version.slots.filter(s => s.dayOfWeek === dayOfWeek);
    const activeRotation = this.getActiveRotationForDate(rotations, dateStr);

    const occurrence = this.getOrdinalOccurrence(dateObj); // 1..5
    const occurrenceLabel = this.getOrdinalSuffix(occurrence);
    const weekdayName = this.getWeekdayName(dayOfWeek);

    const generated = [];
    const occupiedTimeWindows = new Set();

    for (const slot of daySlots) {
      // Slot-level effective date boundary check
      if (slot.effectiveStartDate && dateStr < slot.effectiveStartDate) continue;
      if (slot.effectiveEndDate && dateStr > slot.effectiveEndDate) continue;

      // Prevent duplicate sessions in the exact same time window
      const timeWindowKey = `${slot.startTime}_${slot.endTime}`;
      if (occupiedTimeWindows.has(timeWindowKey)) {
        continue;
      }

      let slotSubjectId = slot.subjectId;
      let slotType = slot.type || 'theory';
      let rotationNote = '';

      // Determine subject based on recurrenceMode
      if (slot.recurrenceMode === 'monthly_ordinal') {
        const occRules = slot.monthlyOccurrences || {};
        const occConfig = occRules[occurrence];
        
        if (occConfig) {
          if (typeof occConfig === 'string') {
            slotSubjectId = occConfig;
          } else if (typeof occConfig === 'object') {
            slotSubjectId = occConfig.subjectId !== undefined ? occConfig.subjectId : slotSubjectId;
            slotType = occConfig.type || slotType;
          }
          rotationNote = `${occurrenceLabel} ${weekdayName}`;
        } else if (slot.skipUnassignedOccurrences) {
          // If configured to skip occurrences with no assigned subject
          continue;
        }
      } else if (slot.recurrenceMode === 'calendar_week') {
        const calWeek = this.getCalendarWeekOfMonth(dateObj, slot.calendarWeekStart ?? 1);
        const calRules = slot.calendarWeekOccurrences || {};
        const calConfig = calRules[calWeek];
        if (calConfig) {
          slotSubjectId = typeof calConfig === 'string' ? calConfig : (calConfig.subjectId || slotSubjectId);
          rotationNote = `Week ${calWeek} of Month`;
        }
      }

      let postingRotationId = null;
      let postingName = slot.defaultPostingDepartment || '';

      // Clinical slot and posting rotation matching
      if (slotType === 'clinical' && activeRotation) {
        postingRotationId = activeRotation.id;
        postingName = activeRotation.departmentName;
        if (activeRotation.linkedSubjectId) {
          slotSubjectId = activeRotation.linkedSubjectId;
        }
      }

      occupiedTimeWindows.add(timeWindowKey);

      // Match subject from subjects collection
      const matchedSubject = subjects.find(s => s.id === slotSubjectId);
      const subjectDisplayName = matchedSubject 
        ? matchedSubject.name 
        : (postingName || 'Unassigned Subject');

      generated.push({
        id: `${dateStr}_${slot.id}`,
        date: dateStr,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subjectId: slotSubjectId,
        subjectName: subjectDisplayName,
        category: slotType,
        postingRotationId,
        postingDepartmentName: postingName,
        status: 'pending', // Starts visibly pending, never assumed absent
        source: 'timetable',
        timetableVersionId: version.id,
        notes: slot.notes || '',
        rotationNote // e.g. "1st Wednesday", "3rd Thursday"
      });
    }

    return generated;
  },

  /**
   * Generates future scheduled sessions for Leave Forecasting
   * From startDate up to cutoffDate
   */
  generateFutureSchedule({
    startDate, // tomorrow or future start
    cutoffDate,
    timetableVersions,
    rotations,
    dateOverrides = [],
    subjects
  }) {
    const futureSessions = [];
    let cur = new Date(startDate + 'T12:00:00');
    const end = new Date(cutoffDate + 'T12:00:00');

    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      const override = dateOverrides.find(o => o.date === dateStr);

      const daySessions = this.resolveSessionsForDate({
        dateStr,
        existingSessions: [],
        timetableVersions,
        rotations,
        dateOverride: override,
        subjects
      });

      for (const s of daySessions) {
        // Exclude unassigned placeholder sessions from future forecast
        if (s.subjectId) {
          futureSessions.push(s);
        }
      }

      // Next day
      cur.setDate(cur.getDate() + 1);
    }

    return futureSessions;
  }
};
