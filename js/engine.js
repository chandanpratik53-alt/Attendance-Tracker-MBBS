// MBBS Attendance Tracker - Pure Mathematical Calculation Engine
// Strictly follows MBBS one-class-per-session rule, weighted aggregates, and theoretical safe bunks

export const AttendanceEngine = {
  /**
   * Calculate statistics for a single subject and category (theory or clinical)
   * @param {Object} subject - The subject definition including historicalBaseline and thresholds
   * @param {Array} sessions - Confirmed and recorded sessions for this subject
   * @param {string} category - 'theory' or 'clinical'
   * @param {number} safetyBuffer - Extra percentage points (e.g. 5 for +5%)
   */
  calculateSubjectCategory(subject, sessions, category, safetyBuffer = 5) {
    const isClinical = category === 'clinical';
    const minPercent = isClinical 
      ? (subject.clinicalMinPercent ?? 80)
      : (subject.theoryMinPercent ?? 75);
    
    const baseline = subject.historicalBaseline || {};
    const baselineConducted = isClinical 
      ? (parseInt(baseline.clinicalConducted, 10) || 0)
      : (parseInt(baseline.theoryConducted, 10) || 0);
    const baselineAttended = isClinical 
      ? (parseInt(baseline.clinicalAttended, 10) || 0)
      : (parseInt(baseline.theoryAttended, 10) || 0);

    let recordedPresent = 0;
    let recordedAbsent = 0;
    let recordedCancelled = 0;
    let recordedHoliday = 0;
    let recordedPending = 0;

    for (const s of sessions) {
      if (s.category !== category) continue;
      
      switch (s.status) {
        case 'present':
          recordedPresent++;
          break;
        case 'absent':
          recordedAbsent++;
          break;
        case 'cancelled':
          recordedCancelled++;
          break;
        case 'holiday':
          recordedHoliday++;
          break;
        case 'pending':
          recordedPending++;
          break;
      }
    }

    const attended = baselineAttended + recordedPresent;
    const conducted = baselineConducted + recordedPresent + recordedAbsent;
    const p = minPercent / 100;

    let percentage = null;
    let formattedPercentage = 'No attendance data';
    let safeAbsences = 0;
    let deficitClassesToRecover = 0;
    let isBelowMinimum = false;
    let isAtRisk = false;
    let isSafe = false;

    if (conducted > 0) {
      percentage = (attended / conducted) * 100;
      formattedPercentage = percentage.toFixed(1) + '%';

      if (percentage < minPercent) {
        isBelowMinimum = true;
        safeAbsences = 0;
        // Classes needed to recover threshold: ceil((p * T - A) / (1 - p))
        if (p < 1) {
          deficitClassesToRecover = Math.max(0, Math.ceil((p * conducted - attended) / (1 - p)));
        }
      } else {
        // Safe absences theoretical formula: floor(A / p - T)
        safeAbsences = Math.max(0, Math.floor(attended / p - conducted));
        if (percentage < (minPercent + safetyBuffer)) {
          isAtRisk = true;
        } else {
          isSafe = true;
        }
      }
    }

    // Status label
    let statusLabel = 'No data';
    let statusClass = 'neutral';
    if (conducted === 0) {
      statusLabel = 'No records';
      statusClass = 'neutral';
    } else if (isBelowMinimum) {
      statusLabel = 'Below minimum';
      statusClass = 'danger';
    } else if (isAtRisk) {
      statusLabel = 'At risk';
      statusClass = 'risk';
    } else {
      statusLabel = 'Safe';
      statusClass = 'safe';
    }

    return {
      category,
      attended,
      conducted,
      percentage,
      formattedPercentage,
      minPercent,
      targetPercent: minPercent + safetyBuffer,
      safeAbsences,
      deficitClassesToRecover,
      pendingCount: recordedPending,
      cancelledCount: recordedCancelled,
      holidayCount: recordedHoliday,
      isBelowMinimum,
      isAtRisk,
      isSafe,
      statusLabel,
      statusClass,
      baselineAttended,
      baselineConducted
    };
  },

  /**
   * Calculate complete subject report (theory + clinical + combined)
   */
  calculateSubjectSummary(subject, subjectSessions, safetyBuffer = 5) {
    const theory = this.calculateSubjectCategory(subject, subjectSessions, 'theory', safetyBuffer);
    const clinical = this.calculateSubjectCategory(subject, subjectSessions, 'clinical', safetyBuffer);

    return {
      subject,
      theory,
      clinical
    };
  },

  /**
   * Calculate weighted aggregate attendance across all subjects
   * Sum of attended / Sum of conducted * 100. Never average of percentages.
   */
  calculateAggregate(subjects, allSessions, category, defaultMinPercent = null, safetyBuffer = 5) {
    const isClinical = category === 'clinical';
    const minPercent = defaultMinPercent ?? (isClinical ? 80 : 75);

    let totalAttended = 0;
    let totalConducted = 0;
    let totalPending = 0;

    for (const subj of subjects) {
      if (subj.isActive === false) continue;

      const subjSessions = allSessions.filter(s => s.subjectId === subj.id && s.category === category);
      const res = this.calculateSubjectCategory(subj, subjSessions, category, safetyBuffer);
      
      totalAttended += res.attended;
      totalConducted += res.conducted;
      totalPending += res.pendingCount;
    }

    let percentage = null;
    let formattedPercentage = 'No attendance data';
    let safeAbsences = 0;
    let deficitClassesToRecover = 0;
    let isBelowMinimum = false;
    let isAtRisk = false;
    let isSafe = false;

    if (totalConducted > 0) {
      percentage = (totalAttended / totalConducted) * 100;
      formattedPercentage = percentage.toFixed(1) + '%';
      const p = minPercent / 100;

      if (percentage < minPercent) {
        isBelowMinimum = true;
        safeAbsences = 0;
        if (p < 1) {
          deficitClassesToRecover = Math.max(0, Math.ceil((p * totalConducted - totalAttended) / (1 - p)));
        }
      } else {
        safeAbsences = Math.max(0, Math.floor(totalAttended / p - totalConducted));
        if (percentage < (minPercent + safetyBuffer)) {
          isAtRisk = true;
        } else {
          isSafe = true;
        }
      }
    }

    let statusLabel = 'No data';
    let statusClass = 'neutral';
    if (totalConducted === 0) {
      statusLabel = 'No records';
      statusClass = 'neutral';
    } else if (isBelowMinimum) {
      statusLabel = 'Below minimum';
      statusClass = 'danger';
    } else if (isAtRisk) {
      statusLabel = 'At risk';
      statusClass = 'risk';
    } else {
      statusLabel = 'Safe';
      statusClass = 'safe';
    }

    return {
      category,
      attended: totalAttended,
      conducted: totalConducted,
      percentage,
      formattedPercentage,
      minPercent,
      targetPercent: minPercent + safetyBuffer,
      safeAbsences,
      deficitClassesToRecover,
      pendingCount: totalPending,
      isBelowMinimum,
      isAtRisk,
      isSafe,
      statusLabel,
      statusClass
    };
  },

  /**
   * Calculate drill-down statistics for a posting rotation
   */
  calculateRotationReport(rotation, sessions) {
    const rotationSessions = sessions.filter(s => s.postingRotationId === rotation.id);
    
    let present = 0;
    let absent = 0;
    let cancelled = 0;
    let pending = 0;

    for (const s of rotationSessions) {
      switch (s.status) {
        case 'present': present++; break;
        case 'absent': absent++; break;
        case 'cancelled': cancelled++; break;
        case 'pending': pending++; break;
      }
    }

    const conducted = present + absent;
    let percentage = null;
    let formattedPercentage = 'No data';

    if (conducted > 0) {
      percentage = (present / conducted) * 100;
      formattedPercentage = percentage.toFixed(1) + '%';
    }

    const minPercent = rotation.minimumThreshold ?? 80;
    const isBelow = percentage !== null && percentage < minPercent;

    return {
      rotation,
      recordedCount: rotationSessions.length,
      attended: present,
      absent,
      cancelled,
      pending,
      conducted,
      percentage,
      formattedPercentage,
      minPercent,
      isBelowMinimum: isBelow,
      statusLabel: conducted === 0 ? 'Not started' : (isBelow ? 'Below minimum' : 'Satisfactory')
    };
  },

  /**
   * Leave Planner Forecast Simulation
   * Calculates the exact attendance impact of missing classes within a proposed date range
   */
  simulateLeaveForecast({
    subjects,
    currentSessions,
    futureScheduledSessions, // list of generated future sessions up to cut-off
    leaveStartDate,
    leaveEndDate,
    safetyBuffer = 5
  }) {
    // Treat future sessions within [leaveStartDate, leaveEndDate] as ABSENT.
    // Treat future sessions outside that range as ATTENDED.
    const simulatedSessions = [...currentSessions];

    for (const fs of futureScheduledSessions) {
      if (fs.status === 'cancelled' || fs.status === 'holiday') continue;

      const isDuringLeave = fs.date >= leaveStartDate && fs.date <= leaveEndDate;
      simulatedSessions.push({
        ...fs,
        status: isDuringLeave ? 'absent' : 'present'
      });
    }

    // Evaluate subject summaries
    const subjectForecasts = subjects.map(subj => {
      const subjSessions = simulatedSessions.filter(s => s.subjectId === subj.id);
      const theory = this.calculateSubjectCategory(subj, subjSessions, 'theory', safetyBuffer);
      const clinical = this.calculateSubjectCategory(subj, subjSessions, 'clinical', safetyBuffer);

      // Count missed classes during leave
      const missedTheory = futureScheduledSessions.filter(
        fs => fs.subjectId === subj.id && fs.category === 'theory' && fs.date >= leaveStartDate && fs.date <= leaveEndDate
      ).length;
      const missedClinical = futureScheduledSessions.filter(
        fs => fs.subjectId === subj.id && fs.category === 'clinical' && fs.date >= leaveStartDate && fs.date <= leaveEndDate
      ).length;

      return {
        subject: subj,
        theory,
        clinical,
        missedTheory,
        missedClinical
      };
    });

    const aggregateTheory = this.calculateAggregate(subjects, simulatedSessions, 'theory', 75, safetyBuffer);
    const aggregateClinical = this.calculateAggregate(subjects, simulatedSessions, 'clinical', 80, safetyBuffer);

    let isSafeOverall = true;
    let isAtRiskOverall = false;
    let violationReasons = [];

    // Check theory & clinical subjects
    for (const sf of subjectForecasts) {
      if (sf.theory.conducted > 0 && sf.theory.isBelowMinimum) {
        isSafeOverall = false;
        violationReasons.push(`${sf.subject.name} Theory falls below ${sf.theory.minPercent}% (${sf.theory.formattedPercentage})`);
      } else if (sf.theory.isAtRisk) {
        isAtRiskOverall = true;
      }

      if (sf.clinical.conducted > 0 && sf.clinical.isBelowMinimum) {
        isSafeOverall = false;
        violationReasons.push(`${sf.subject.name} Clinical falls below ${sf.clinical.minPercent}% (${sf.clinical.formattedPercentage})`);
      } else if (sf.clinical.isAtRisk) {
        isAtRiskOverall = true;
      }
    }

    if (aggregateTheory.conducted > 0 && aggregateTheory.isBelowMinimum) {
      isSafeOverall = false;
      violationReasons.push(`Aggregate Theory falls below 75% (${aggregateTheory.formattedPercentage})`);
    }
    if (aggregateClinical.conducted > 0 && aggregateClinical.isBelowMinimum) {
      isSafeOverall = false;
      violationReasons.push(`Aggregate Clinical falls below 80% (${aggregateClinical.formattedPercentage})`);
    }

    let planStatus = 'SAFE';
    if (!isSafeOverall) {
      planStatus = 'BELOW MINIMUM';
    } else if (isAtRiskOverall) {
      planStatus = 'RISKY';
    }

    return {
      leaveStartDate,
      leaveEndDate,
      planStatus,
      isSafeOverall,
      isAtRiskOverall,
      violationReasons,
      subjectForecasts,
      aggregateTheory,
      aggregateClinical
    };
  }
};
