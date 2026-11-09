import { describe, expect, it } from "vitest";
import {
  checkRefundEligibility,
  lastDayOfRefundWindow,
  REFUND_WATCH_LIMIT_SECONDS,
  type RefundFacts,
} from "./refunds";

// Local times, so calendar-day maths matches what the server does.
const purchasedAt = new Date(2026, 0, 1, 23, 0).toISOString();
const dayAfterPurchase = new Date(2026, 0, 2, 12, 0);

function facts(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchasedAt,
    amountPaid: 4900,
    totalLessons: 10,
    completedLessons: 0,
    secondsWatched: 0,
    hasOpenRefundRequest: false,
    hasClaimedSeat: false,
    ...overrides,
  };
}

describe("checkRefundEligibility", () => {
  it("allows a fresh Purchase and refunds the amount paid", () => {
    expect(checkRefundEligibility(facts(), dayAfterPurchase)).toEqual({
      eligible: true,
      amount: 4900,
      lastDayInWindow: "2026-01-15",
    });
  });

  it("refunds the amount paid, not some other price", () => {
    const result = checkRefundEligibility(
      facts({ amountPaid: 1234 }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({ eligible: true, amount: 1234 });
  });

  it("blocks a second Refund Request while one is open", () => {
    const result = checkRefundEligibility(
      facts({ hasOpenRefundRequest: true }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({ eligible: false, reason: "open_request" });
  });

  describe("the 14-day window", () => {
    it("is still open on the last calendar day, late in the evening", () => {
      const result = checkRefundEligibility(
        facts(),
        new Date(2026, 0, 15, 23, 59)
      );
      expect(result.eligible).toBe(true);
    });

    it("is closed the day after", () => {
      const result = checkRefundEligibility(facts(), new Date(2026, 0, 16, 0, 1));
      expect(result).toMatchObject({ eligible: false, reason: "window_closed" });
    });

    it("counts from the Purchase day", () => {
      expect(lastDayOfRefundWindow(purchasedAt)).toBe("2026-01-15");
    });
  });

  describe("lessons completed", () => {
    it("allows just under half", () => {
      const result = checkRefundEligibility(
        facts({ completedLessons: 4 }),
        dayAfterPurchase
      );
      expect(result.eligible).toBe(true);
    });

    it("blocks half or more", () => {
      const result = checkRefundEligibility(
        facts({ completedLessons: 5 }),
        dayAfterPurchase
      );
      expect(result).toMatchObject({
        eligible: false,
        reason: "too_many_lessons_completed",
      });
    });

    it("ignores the rule for a course with no lessons", () => {
      const result = checkRefundEligibility(
        facts({ totalLessons: 0, completedLessons: 0 }),
        dayAfterPurchase
      );
      expect(result.eligible).toBe(true);
    });
  });

  describe("video watched", () => {
    it("allows just under 2 hours", () => {
      const result = checkRefundEligibility(
        facts({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS - 1 }),
        dayAfterPurchase
      );
      expect(result.eligible).toBe(true);
    });

    it("blocks 2 hours or more", () => {
      const result = checkRefundEligibility(
        facts({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS }),
        dayAfterPurchase
      );
      expect(result).toMatchObject({
        eligible: false,
        reason: "too_much_watched",
      });
    });
  });

  it("blocks a Team Purchase with a claimed Seat", () => {
    const result = checkRefundEligibility(
      facts({ hasClaimedSeat: true }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({ eligible: false, reason: "claimed_seat" });
  });
});
