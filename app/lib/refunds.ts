// The rules that decide whether a Refund Request may be raised. See
// GLOSSARY.md for Refund Request, Refund and Seat, and
// docs/adr/0001-refunds-per-seat.md for why Seats are refunded one by one.
// These functions are pure; refunds.server.ts gathers the facts.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

/** How much of the course one Student has used. */
export type CourseUsage = {
  totalLessons: number;
  completedLessons: number;
  secondsWatched: number;
};

export type RefundFacts = CourseUsage & {
  purchasedAt: string;
  amountPaid: number;
  hasOpenRefundRequest: boolean;
};

export type RefundIneligibleReason =
  | "open_request"
  | "window_closed"
  | "too_many_lessons_completed"
  | "too_much_watched";

export type RefundEligibility =
  | { eligible: true; amount: number; lastDayInWindow: string }
  | { eligible: false; reason: RefundIneligibleReason; message: string };

// The window is counted in whole calendar days, not hours: someone who buys
// at 23:00 still gets the whole of their fourteenth day.
export function calendarDay(when: Date): string {
  const year = when.getFullYear();
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAtIso: string): string {
  const deadline = new Date(purchasedAtIso);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function isWithinRefundWindow(purchasedAtIso: string, now: Date) {
  const today = calendarDay(now);
  return (
    today >= calendarDay(new Date(purchasedAtIso)) &&
    today <= lastDayOfRefundWindow(purchasedAtIso)
  );
}

type UsageVerdict = "too_many_lessons_completed" | "too_much_watched" | null;

function checkUsage(usage: CourseUsage): UsageVerdict {
  if (
    usage.totalLessons > 0 &&
    usage.completedLessons / usage.totalLessons >= REFUND_COMPLETION_LIMIT
  ) {
    return "too_many_lessons_completed";
  }
  if (usage.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return "too_much_watched";
  }
  return null;
}

/** For a single Purchase, raised by the Student who bought it. */
export function checkRefundEligibility(
  facts: RefundFacts,
  now: Date
): RefundEligibility {
  if (facts.hasOpenRefundRequest) {
    return {
      eligible: false,
      reason: "open_request",
      message: "You already have a Refund Request open on this purchase.",
    };
  }

  if (!isWithinRefundWindow(facts.purchasedAt, now)) {
    return {
      eligible: false,
      reason: "window_closed",
      message: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    };
  }

  const usage = checkUsage(facts);
  if (usage === "too_many_lessons_completed") {
    return {
      eligible: false,
      reason: usage,
      message: "You have completed too much of this course to get a refund.",
    };
  }
  if (usage === "too_much_watched") {
    return {
      eligible: false,
      reason: usage,
      message: "You have watched too much of this course to get a refund.",
    };
  }

  // A Refund is always the amount paid on the Purchase, never the course's
  // current list price.
  return {
    eligible: true,
    amount: facts.amountPaid,
    lastDayInWindow: lastDayOfRefundWindow(facts.purchasedAt),
  };
}

export type SeatRefundFacts = {
  purchasedAt: string;
  isRefunded: boolean;
  isInOpenRefundRequest: boolean;
  /** Usage of the Student who claimed the Seat, or null if unclaimed. */
  claimedBy: CourseUsage | null;
};

export type SeatIneligibleReason =
  | "refunded"
  | "open_request"
  | "window_closed"
  | "too_many_lessons_completed"
  | "too_much_watched";

export type SeatRefundEligibility =
  | { eligible: true }
  | { eligible: false; reason: SeatIneligibleReason; label: string };

/**
 * For one Seat of a Team Purchase. The window counts from the Purchase date;
 * usage is measured on the Student who claimed the Seat, never on the Team
 * Admin who paid. An unclaimed Seat passes the usage checks.
 */
export function checkSeatRefundEligibility(
  facts: SeatRefundFacts,
  now: Date
): SeatRefundEligibility {
  if (facts.isRefunded) {
    return { eligible: false, reason: "refunded", label: "Refunded" };
  }
  if (facts.isInOpenRefundRequest) {
    return {
      eligible: false,
      reason: "open_request",
      label: "In an open Refund Request",
    };
  }
  if (!isWithinRefundWindow(facts.purchasedAt, now)) {
    return {
      eligible: false,
      reason: "window_closed",
      label: "Refund window closed",
    };
  }
  if (facts.claimedBy) {
    const usage = checkUsage(facts.claimedBy);
    if (usage === "too_many_lessons_completed") {
      return {
        eligible: false,
        reason: usage,
        label: "Student has completed half the lessons",
      };
    }
    if (usage === "too_much_watched") {
      return {
        eligible: false,
        reason: usage,
        label: "Student has watched 2 hours or more",
      };
    }
  }
  return { eligible: true };
}

/**
 * The Refund for `count` more Seats of a Team Purchase, in cents. Each Seat is
 * an equal share of the amount paid. Shares are rounded on the running total,
 * so refunding every Seat, in any number of Refund Requests, gives back
 * exactly the amount paid and never a cent more.
 */
export function seatRefundAmount(input: {
  amountPaid: number;
  totalSeats: number;
  alreadyRefundedSeats: number;
  count: number;
}): number {
  const { amountPaid, totalSeats, alreadyRefundedSeats, count } = input;
  if (totalSeats <= 0 || count <= 0) return 0;
  const cumulative = (seats: number) =>
    Math.floor((amountPaid * seats) / totalSeats);
  return (
    cumulative(alreadyRefundedSeats + count) - cumulative(alreadyRefundedSeats)
  );
}
