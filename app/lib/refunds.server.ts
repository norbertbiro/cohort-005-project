import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import { checkRefundEligibility, type RefundEligibility } from "~/lib/refunds";

export function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
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

export function getCompletedLessonCount(userId: number, lessonIds: number[]) {
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
export function getSecondsWatched(userId: number, lessonIds: number[]) {
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

function hasClaimedSeat(purchaseId: number) {
  const claimed = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return claimed !== undefined;
}

/**
 * Whether this Student may raise a Refund Request for their latest Purchase
 * of the course. Null when they have not bought it. The course page and the
 * refund action both call this, so they can never disagree.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): {
  purchase: typeof purchases.$inferSelect;
  eligibility: RefundEligibility;
} | null {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return null;

  const lessonIds = getCourseLessonIds(courseId);

  const eligibility = checkRefundEligibility(
    {
      purchasedAt: purchase.createdAt,
      amountPaid: purchase.amountPaid,
      totalLessons: lessonIds.length,
      completedLessons: getCompletedLessonCount(userId, lessonIds),
      secondsWatched: getSecondsWatched(userId, lessonIds),
      hasOpenRefundRequest: hasOpenRefundRequest(purchase.id),
      hasClaimedSeat: hasClaimedSeat(purchase.id),
    },
    now
  );

  return { purchase, eligibility };
}
