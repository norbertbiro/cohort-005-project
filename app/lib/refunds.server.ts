import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  notExists,
  sql,
} from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refundRequestSeats,
  refunds,
  seats,
  teamMembers,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
  TeamMemberRole,
} from "~/db/schema";
import {
  checkRefundEligibility,
  checkSeatRefundEligibility,
  isWithinRefundWindow,
  seatRefundAmount,
  type CourseUsage,
  type RefundEligibility,
  type SeatRefundEligibility,
} from "~/lib/refunds";

type Purchase = typeof purchases.$inferSelect;

// ─── Facts about a Purchase and the Students using it ───

/**
 * The Student's latest single Purchase of the course. Team Purchases are left
 * out: their Seats are refunded by the Team Admin, one Seat at a time.
 */
export function getLatestSinglePurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notExists(
          db
            .select({ id: seats.id })
            .from(seats)
            .where(eq(seats.purchaseId, purchases.id))
        )
      )
    )
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

export function getCourseLessonIds(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

// Watching is measured as the furthest point reached in each lesson's video,
// added up across the course.
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

function getCourseUsage(userId: number, lessonIds: number[]): CourseUsage {
  return {
    totalLessons: lessonIds.length,
    completedLessons: getCompletedLessonCount(userId, lessonIds),
    secondsWatched: getSecondsWatched(userId, lessonIds),
  };
}

function hasOpenRefundRequest(purchaseId: number) {
  const open = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Requested)
      )
    )
    .get();
  return open !== undefined;
}

// ─── Single Purchase ───

/**
 * Whether this Student may raise a Refund Request for their latest single
 * Purchase of the course. Null when they have not bought it. The course page
 * and the refund action both call this, so they can never disagree.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): { purchase: Purchase; eligibility: RefundEligibility } | null {
  const purchase = getLatestSinglePurchase(userId, courseId);
  if (!purchase) return null;

  const eligibility = checkRefundEligibility(
    {
      ...getCourseUsage(userId, getCourseLessonIds(courseId)),
      purchasedAt: purchase.createdAt,
      amountPaid: purchase.amountPaid,
      hasOpenRefundRequest: hasOpenRefundRequest(purchase.id),
    },
    now
  );

  return { purchase, eligibility };
}

// ─── Team Purchases and Seats ───

export function isTeamAdminOf(userId: number, teamId: number) {
  const membership = db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.role, TeamMemberRole.TeamAdmin)
      )
    )
    .get();
  return membership !== undefined;
}

function getSeatIdsInOpenRefundRequests(purchaseId: number): Set<number> {
  const rows = db
    .select({ seatId: refundRequestSeats.seatId })
    .from(refundRequestSeats)
    .innerJoin(refunds, eq(refundRequestSeats.refundId, refunds.id))
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Requested)
      )
    )
    .all();
  return new Set(rows.map((row) => row.seatId));
}

function countRefundedSeats(purchaseId: number) {
  const row = db
    .select({ n: count() })
    .from(seats)
    .where(and(eq(seats.purchaseId, purchaseId), isNotNull(seats.refundedAt)))
    .get();
  return row?.n ?? 0;
}

export type SeatRefundOption = {
  seatId: number;
  code: string;
  claimedByEmail: string | null;
  eligibility: SeatRefundEligibility;
};

export type TeamPurchaseRefundOptions = {
  purchaseId: number;
  courseTitle: string;
  purchasedAt: string;
  amountPaid: number;
  totalSeats: number;
  refundedSeats: number;
  seats: SeatRefundOption[];
};

/** Every Seat of one Team Purchase, each with its own refund verdict. */
export function getTeamPurchaseRefundOptions(
  purchaseId: number,
  now: Date = new Date()
): TeamPurchaseRefundOptions | null {
  const purchase = db
    .select({
      id: purchases.id,
      courseId: purchases.courseId,
      createdAt: purchases.createdAt,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.id, purchaseId))
    .get();
  if (!purchase) return null;

  const seatRows = db
    .select({
      id: seats.id,
      code: seats.code,
      claimedByUserId: seats.claimedByUserId,
      refundedAt: seats.refundedAt,
      claimedByEmail: users.email,
    })
    .from(seats)
    .leftJoin(users, eq(seats.claimedByUserId, users.id))
    .where(eq(seats.purchaseId, purchaseId))
    .orderBy(seats.id)
    .all();
  if (seatRows.length === 0) return null;

  const lessonIds = getCourseLessonIds(purchase.courseId);
  const inOpenRequest = getSeatIdsInOpenRefundRequests(purchaseId);

  return {
    purchaseId: purchase.id,
    courseTitle: purchase.courseTitle,
    purchasedAt: purchase.createdAt,
    amountPaid: purchase.amountPaid,
    totalSeats: seatRows.length,
    refundedSeats: seatRows.filter((row) => row.refundedAt !== null).length,
    seats: seatRows.map((row) => ({
      seatId: row.id,
      code: row.code,
      claimedByEmail: row.claimedByEmail,
      eligibility: checkSeatRefundEligibility(
        {
          purchasedAt: purchase.createdAt,
          isRefunded: row.refundedAt !== null,
          isInOpenRefundRequest: inOpenRequest.has(row.id),
          claimedBy:
            row.claimedByUserId === null
              ? null
              : getCourseUsage(row.claimedByUserId, lessonIds),
        },
        now
      ),
    })),
  };
}

/** The team's Team Purchases that are still inside the refund window. */
export function getTeamRefundOptions(
  teamId: number,
  now: Date = new Date()
): TeamPurchaseRefundOptions[] {
  const purchaseIds = db
    .selectDistinct({ purchaseId: seats.purchaseId })
    .from(seats)
    .where(eq(seats.teamId, teamId))
    .all()
    .map((row) => row.purchaseId);

  return purchaseIds
    .map((id) => getTeamPurchaseRefundOptions(id, now))
    .filter((options): options is TeamPurchaseRefundOptions => {
      return (
        options !== null && isWithinRefundWindow(options.purchasedAt, now)
      );
    });
}

// ─── Refund Requests ───

function getSeatIdsForRefundRequest(refundId: number): number[] {
  return db
    .select({ seatId: refundRequestSeats.seatId })
    .from(refundRequestSeats)
    .where(eq(refundRequestSeats.refundId, refundId))
    .all()
    .map((row) => row.seatId);
}

function countSeats(purchaseId: number) {
  const row = db
    .select({ n: count() })
    .from(seats)
    .where(eq(seats.purchaseId, purchaseId))
    .get();
  return row?.n ?? 0;
}

/**
 * What a Refund Request would give back if approved now: the amount paid on
 * a single Purchase, or the Seats' share of a Team Purchase.
 */
export function getRefundRequestAmount(refundId: number): number {
  const request = db
    .select({ purchaseId: refunds.purchaseId, amountPaid: purchases.amountPaid })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(eq(refunds.id, refundId))
    .get();
  if (!request) return 0;

  const seatIds = getSeatIdsForRefundRequest(refundId);
  if (seatIds.length === 0) return request.amountPaid;

  return seatRefundAmount({
    amountPaid: request.amountPaid,
    totalSeats: countSeats(request.purchaseId),
    alreadyRefundedSeats: countRefundedSeats(request.purchaseId),
    count: seatIds.length,
  });
}

export function createRefundRequest(input: {
  purchaseId: number;
  reason: string;
  seatIds?: number[];
}) {
  return db.transaction((tx) => {
    const refund = tx
      .insert(refunds)
      .values({
        purchaseId: input.purchaseId,
        status: RefundStatus.Requested,
        reason: input.reason,
      })
      .returning()
      .get();

    for (const seatId of input.seatIds ?? []) {
      tx.insert(refundRequestSeats)
        .values({ refundId: refund.id, seatId })
        .run();
    }

    return refund;
  });
}

export type OpenRefundRequest = {
  id: number;
  reason: string;
  requestedAt: string;
  courseTitle: string;
  courseSlug: string;
  requesterName: string;
  requesterEmail: string;
  seatCount: number;
  amount: number;
};

export function getOpenRefundRequests(): OpenRefundRequest[] {
  const rows = db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      requesterName: users.name,
      requesterEmail: users.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(eq(refunds.status, RefundStatus.Requested))
    .orderBy(refunds.requestedAt)
    .all();

  return rows.map((row) => ({
    ...row,
    seatCount: getSeatIdsForRefundRequest(row.id).length,
    amount: getRefundRequestAmount(row.id),
  }));
}

export type RefundDecision = "approve" | "decline";

export type ResolvedRefundRequest = {
  decision: RefundDecision;
  amount: number;
  courseTitle: string;
  requesterName: string;
  requesterEmail: string;
  endedEnrollmentUserIds: number[];
};

/**
 * An Admin's decision on an open Refund Request. Approving records the
 * Refund, marks any Seats as refunded and ends the Enrollment of each Student
 * involved. Lesson progress and watch history are kept. Returns null when the
 * request does not exist or is no longer open.
 */
export function resolveRefundRequest(input: {
  refundId: number;
  adminUserId: number;
  decision: RefundDecision;
  now?: Date;
}): ResolvedRefundRequest | null {
  const resolvedAt = (input.now ?? new Date()).toISOString();

  return db.transaction((tx) => {
    const request = tx
      .select({
        id: refunds.id,
        status: refunds.status,
        purchaseId: purchases.id,
        purchaserId: purchases.userId,
        courseId: purchases.courseId,
        courseTitle: courses.title,
        requesterName: users.name,
        requesterEmail: users.email,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .innerJoin(users, eq(purchases.userId, users.id))
      .where(eq(refunds.id, input.refundId))
      .get();

    if (!request || request.status !== RefundStatus.Requested) return null;

    const base = {
      courseTitle: request.courseTitle,
      requesterName: request.requesterName,
      requesterEmail: request.requesterEmail,
    };

    if (input.decision === "decline") {
      tx.update(refunds)
        .set({
          status: RefundStatus.Declined,
          resolvedAt,
          resolvedByUserId: input.adminUserId,
        })
        .where(eq(refunds.id, request.id))
        .run();
      return {
        ...base,
        decision: "decline",
        amount: 0,
        endedEnrollmentUserIds: [],
      };
    }

    const amount = getRefundRequestAmount(request.id);
    const seatIds = getSeatIdsForRefundRequest(request.id);

    // A single Purchase ends the buyer's own Enrollment. A Seat Refund ends
    // the Enrollment of each Student who claimed one of the Seats.
    let studentIds: number[];
    if (seatIds.length === 0) {
      studentIds = [request.purchaserId];
    } else {
      const refundedSeats = tx
        .update(seats)
        .set({ refundedAt: resolvedAt })
        .where(inArray(seats.id, seatIds))
        .returning({ claimedByUserId: seats.claimedByUserId })
        .all();
      studentIds = refundedSeats
        .map((seat) => seat.claimedByUserId)
        .filter((id): id is number => id !== null);
    }

    if (studentIds.length > 0) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.courseId, request.courseId),
            inArray(enrollments.userId, studentIds)
          )
        )
        .run();
    }

    tx.update(refunds)
      .set({
        status: RefundStatus.Approved,
        amountRefunded: amount,
        resolvedAt,
        resolvedByUserId: input.adminUserId,
      })
      .where(eq(refunds.id, request.id))
      .run();

    return {
      ...base,
      decision: "approve",
      amount,
      endedEnrollmentUserIds: studentIds,
    };
  });
}
