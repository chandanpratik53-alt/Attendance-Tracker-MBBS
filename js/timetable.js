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
  resolveSessionsForDate({
    dateStr,
    existingSessions = [],
    timetableVersions = [],
    rotations = [],
    dateOverride = null,
    subjects = []
  }) {
    // If sessions already exist in DB for this date, return them (they are ground truth)
    if (existingSessions && existingSessions.length > 0) {
      return existingSessions;
    }

    // Check full-day holiday override
    if (dateOverride && dateOverride.isHoliday) {
      return [];
    }

    const dateObj = new Date(dateStr + 'T12:00:00');
    let dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat

    // Day of week swap (e.g. college decides Wednesday schedule runs on Saturday)
    if (dateOverride && typeof dateOverride.timetableDaySwap === 'number') {
      dayOfWeek = dateOverride.timetableDaySwap;
    }

    // Sunday is off by default
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

    const generated = [];
    for (const slot of daySlots) {
      // Determine subjectId and posting
      let slotSubjectId = slot.subjectId;
      let postingRotationId = null;
      let postingName = slot.defaultPostingDepartment || '';

      if (slot.type === 'clinical' && activeRotation) {
        postingRotationId = activeRotation.id;
        postingName = activeRotation.departmentName;
        // Clinical slot inherits rotation's linked subject if not explicitly specified
        if (activeRotation.linkedSubjectId) {
          slotSubjectId = activeRotation.linkedSubjectId;
        }
      }

      // If subject was deleted or not found, fallback gracefully
      const matchedSubject = subjects.find(s => s.id === slotSubjectId);

      generated.push({
        id: `${dateStr}_${slot.id}`,
        date: dateStr,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subjectId: slotSubjectId,
        subjectName: matchedSubject ? matchedSubject.name : (postingName || 'Unassigned Subject'),
        category: slot.type,
        postingRotationId,
        postingDepartmentName: postingName,
        status: 'pending', // Starts visibly pending, never assumed absent
        source: 'timetable',
        timetableVersionId: version.id,
        notes: slot.notes || ''
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
