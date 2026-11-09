// The rules that decide whether a Refund Request may be raised. See
// GLOSSARY.md for Refund Request, Refund and Seat. These functions are pure;
// refunds.server.ts gathers the facts from the database.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundFacts = {
  purchasedAt: string;
  amountPaid: number;
  totalLessons: number;
  completedLessons: number;
  secondsWatched: number;
  hasOpenRefundRequest: boolean;
  hasClaimedSeat: boolean;
};

export type RefundIneligibleReason =
  | "open_request"
  | "window_closed"
  | "too_many_lessons_completed"
  | "too_much_watched"
  | "claimed_seat";

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

  if (
    facts.totalLessons > 0 &&
    facts.completedLessons / facts.totalLessons >= REFUND_COMPLETION_LIMIT
  ) {
    return {
      eligible: false,
      reason: "too_many_lessons_completed",
      message: "You have completed too much of this course to get a refund.",
    };
  }

  if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return {
      eligible: false,
      reason: "too_much_watched",
      message: "You have watched too much of this course to get a refund.",
    };
  }

  if (facts.hasClaimedSeat) {
    return {
      eligible: false,
      reason: "claimed_seat",
      message: "A Team Purchase with a claimed Seat cannot be refunded.",
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
