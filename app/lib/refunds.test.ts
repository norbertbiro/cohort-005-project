import { describe, expect, it } from "vitest";
import {
  checkRefundEligibility,
  checkSeatRefundEligibility,
  lastDayOfRefundWindow,
  REFUND_WATCH_LIMIT_SECONDS,
  seatRefundAmount,
  type RefundFacts,
  type SeatRefundFacts,
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
});

function seat(overrides: Partial<SeatRefundFacts> = {}): SeatRefundFacts {
  return {
    purchasedAt,
    isRefunded: false,
    isInOpenRefundRequest: false,
    claimedBy: null,
    ...overrides,
  };
}

const lightUse = { totalLessons: 10, completedLessons: 1, secondsWatched: 600 };

describe("checkSeatRefundEligibility", () => {
  it("allows an unclaimed Seat inside the window", () => {
    expect(checkSeatRefundEligibility(seat(), dayAfterPurchase)).toEqual({
      eligible: true,
    });
  });

  it("allows a claimed Seat whose Student has barely started", () => {
    const result = checkSeatRefundEligibility(
      seat({ claimedBy: lightUse }),
      dayAfterPurchase
    );
    expect(result.eligible).toBe(true);
  });

  it("blocks a Seat whose Student watched 2 hours or more", () => {
    const result = checkSeatRefundEligibility(
      seat({
        claimedBy: { ...lightUse, secondsWatched: REFUND_WATCH_LIMIT_SECONDS },
      }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({ eligible: false, reason: "too_much_watched" });
  });

  it("blocks a Seat whose Student completed half the lessons", () => {
    const result = checkSeatRefundEligibility(
      seat({ claimedBy: { ...lightUse, completedLessons: 5 } }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({
      eligible: false,
      reason: "too_many_lessons_completed",
    });
  });

  it("counts the window from the Purchase, not the claim", () => {
    const result = checkSeatRefundEligibility(
      seat({ claimedBy: lightUse }),
      new Date(2026, 0, 16, 9, 0)
    );
    expect(result).toMatchObject({ eligible: false, reason: "window_closed" });
  });

  it("blocks a Seat that is already refunded", () => {
    const result = checkSeatRefundEligibility(
      seat({ isRefunded: true }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({ eligible: false, reason: "refunded" });
  });

  it("blocks a Seat already in an open Refund Request", () => {
    const result = checkSeatRefundEligibility(
      seat({ isInOpenRefundRequest: true }),
      dayAfterPurchase
    );
    expect(result).toMatchObject({ eligible: false, reason: "open_request" });
  });

  it("lets 4 of 5 Seats through when 2 are claimed and 1 Student watched too much", () => {
    const seats = [
      seat({ claimedBy: lightUse }),
      seat({
        claimedBy: { ...lightUse, secondsWatched: REFUND_WATCH_LIMIT_SECONDS + 60 },
      }),
      seat(),
      seat(),
      seat(),
    ];
    const eligible = seats.filter(
      (s) => checkSeatRefundEligibility(s, dayAfterPurchase).eligible
    );
    expect(eligible).toHaveLength(4);
  });
});

describe("seatRefundAmount", () => {
  it("gives each Seat an equal share", () => {
    expect(
      seatRefundAmount({
        amountPaid: 50000,
        totalSeats: 5,
        alreadyRefundedSeats: 0,
        count: 2,
      })
    ).toBe(20000);
  });

  it("uses the purchasing-power price that was paid", () => {
    // 5 Seats at a 40% purchasing-power discount on a 4900 list price.
    const amountPaid = 2940 * 5;
    expect(
      seatRefundAmount({ amountPaid, totalSeats: 5, alreadyRefundedSeats: 0, count: 1 })
    ).toBe(2940);
  });

  it("adds up to exactly the amount paid across several requests", () => {
    const amountPaid = 3333;
    const first = seatRefundAmount({
      amountPaid,
      totalSeats: 5,
      alreadyRefundedSeats: 0,
      count: 2,
    });
    const second = seatRefundAmount({
      amountPaid,
      totalSeats: 5,
      alreadyRefundedSeats: 2,
      count: 3,
    });
    expect(first + second).toBe(amountPaid);
  });

  it("is zero for no Seats", () => {
    expect(
      seatRefundAmount({ amountPaid: 1000, totalSeats: 5, alreadyRefundedSeats: 0, count: 0 })
    ).toBe(0);
  });
});
