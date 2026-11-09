import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/team";
import { getCurrentUserId } from "~/lib/session";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Users, BookOpen, Copy, Check, AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { db } from "~/db";
import {
  teams,
  teamMembers,
  seats,
  courses,
  users,
  TeamMemberRole,
} from "~/db/schema";
import { eq, and } from "drizzle-orm";
import { Textarea } from "~/components/ui/textarea";
import { formatPrice } from "~/lib/utils";
import { seatRefundAmount } from "~/lib/refunds";
import {
  getTeamRefundOptions,
  type TeamPurchaseRefundOptions,
} from "~/lib/refunds.server";

function getTeamForTeamAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.TeamAdmin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function getSeatsForTeam(teamId: number) {
  return db.select().from(seats).where(eq(seats.teamId, teamId)).all();
}

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

interface CourseStats {
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  totalSeats: number;
  claimedSeats: number;
}

interface SeatRow {
  id: number;
  code: string;
  courseId: number;
  courseTitle: string;
  claimedByEmail: string | null;
  isRefunded: boolean;
  createdAt: string;
}

export function meta() {
  return [
    { title: "Team — Cadence" },
    { name: "description", content: "Manage your team's course seats" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const team = getTeamForTeamAdmin(currentUserId);

  if (!team) {
    throw data("You don't have a team. Purchase team seats to create one.", {
      status: 403,
    });
  }

  const allSeats = getSeatsForTeam(team.id);

  // Build per-course stats
  const courseMap = new Map<
    number,
    {
      courseId: number;
      courseTitle: string;
      courseSlug: string;
      total: number;
      claimed: number;
    }
  >();

  // A refunded Seat no longer counts towards the team's Seats.
  for (const seat of allSeats.filter((s) => s.refundedAt === null)) {
    if (!courseMap.has(seat.courseId)) {
      const course = getCourseById(seat.courseId);
      courseMap.set(seat.courseId, {
        courseId: seat.courseId,
        courseTitle: course?.title ?? "Unknown Course",
        courseSlug: course?.slug ?? "",
        total: 0,
        claimed: 0,
      });
    }
    const entry = courseMap.get(seat.courseId)!;
    entry.total++;
    if (seat.claimedByUserId !== null) {
      entry.claimed++;
    }
  }

  const courseStats: CourseStats[] = Array.from(courseMap.values()).map(
    (e) => ({
      courseId: e.courseId,
      courseTitle: e.courseTitle,
      courseSlug: e.courseSlug,
      totalSeats: e.total,
      claimedSeats: e.claimed,
    })
  );

  // Build seat rows with claimer email
  const seatRows: SeatRow[] = allSeats.map((seat) => {
    let claimedByEmail: string | null = null;
    if (seat.claimedByUserId !== null) {
      const user = getUserById(seat.claimedByUserId);
      claimedByEmail = user?.email ?? null;
    }
    const course = getCourseById(seat.courseId);
    return {
      id: seat.id,
      code: seat.code,
      courseId: seat.courseId,
      courseTitle: course?.title ?? "Unknown Course",
      claimedByEmail,
      isRefunded: seat.refundedAt !== null,
      createdAt: seat.createdAt,
    };
  });

  return {
    courseStats,
    seatRows,
    refundOptions: getTeamRefundOptions(team.id),
  };
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/claim/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
      title="Copy claim link"
    >
      {copied ? (
        <>
          <Check className="size-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" />
          Copy link
        </>
      )}
    </button>
  );
}

export default function Team({ loaderData }: Route.ComponentProps) {
  const { courseStats, seatRows, refundOptions } = loaderData;
  const [courseFilter, setCourseFilter] = useState<number | "all">("all");

  const filteredSeats =
    courseFilter === "all"
      ? seatRows
      : seatRows.filter((c) => c.courseId === courseFilter);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Team</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Team Management</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your team&apos;s course Seats and Seat Codes
        </p>
      </div>

      {/* Per-course stats */}
      {courseStats.length > 0 && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courseStats.map((stat) => (
            <Card key={stat.courseId}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold truncate">{stat.courseTitle}</h3>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">
                      {stat.claimedSeats}
                      <span className="text-base font-normal text-muted-foreground">
                        {" "}
                        / {stat.totalSeats}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      seats claimed
                    </p>
                  </div>
                  <Link to={`/courses/${stat.courseSlug}/purchase?mode=team`}>
                    <Button variant="outline" size="sm">
                      Buy more seats
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Seat list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Seats</h2>
          {courseStats.length > 1 && (
            <select
              value={courseFilter}
              onChange={(e) =>
                setCourseFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value)
                )
              }
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All courses</option>
              {courseStats.map((stat) => (
                <option key={stat.courseId} value={stat.courseId}>
                  {stat.courseTitle}
                </option>
              ))}
            </select>
          )}
        </div>

        {filteredSeats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Seats yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Course</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSeats.map((seat) => (
                  <tr key={seat.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-2 py-0.5 text-xs">
                        {seat.code}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {seat.courseTitle}
                    </td>
                    <td className="px-4 py-3">
                      {seat.isRefunded ? (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Refunded
                        </span>
                      ) : seat.claimedByEmail ? (
                        <span className="text-muted-foreground">
                          Claimed by {seat.claimedByEmail}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Unclaimed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!seat.claimedByEmail && !seat.isRefunded && (
                        <CopyButton code={seat.code} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {refundOptions.length > 0 && (
        <div className="mt-10 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Request a refund</h2>
            <p className="text-sm text-muted-foreground">
              Pick the Seats you want to hand back. A Seat can be refunded
              within 14 days of the Purchase, if its Student has watched under
              2 hours and completed under half the lessons.
            </p>
          </div>
          {refundOptions.map((options) => (
            <RequestSeatRefund key={options.purchaseId} options={options} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestSeatRefund({
  options,
}: {
  options: TeamPurchaseRefundOptions;
}) {
  const fetcher = useFetcher<{ errors?: Record<string, string> }>();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const firstError = Object.values(fetcher.data?.errors ?? {})[0];
    if (firstError) {
      toast.error(firstError);
    } else {
      // Sent: the Seats are now in an open Refund Request.
      setPicked(new Set());
    }
  }, [fetcher.state, fetcher.data]);

  const eligibleCount = options.seats.filter(
    (seat) => seat.eligibility.eligible
  ).length;

  const amount = seatRefundAmount({
    amountPaid: options.amountPaid,
    totalSeats: options.totalSeats,
    alreadyRefundedSeats: options.refundedSeats,
    count: picked.size,
  });

  function toggle(seatId: number) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">{options.courseTitle}</h3>
          <span className="text-xs text-muted-foreground">
            Bought {new Date(options.purchasedAt).toLocaleDateString()} ·{" "}
            {options.totalSeats} Seats · {formatPrice(options.amountPaid)}
          </span>
        </div>
        {eligibleCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            None of these Seats can be refunded.
          </p>
        ) : null}
        <fetcher.Form method="post" action="/team/refund" className="space-y-3">
          <input type="hidden" name="purchaseId" value={options.purchaseId} />
          <ul className="divide-y rounded-md border text-sm">
            {options.seats.map((seat) => (
              <li key={seat.seatId} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  name="seatId"
                  value={seat.seatId}
                  disabled={!seat.eligibility.eligible}
                  checked={picked.has(seat.seatId)}
                  onChange={() => toggle(seat.seatId)}
                  aria-label={`Refund Seat ${seat.code}`}
                />
                <code className="rounded bg-muted px-2 py-0.5 text-xs">
                  {seat.code}
                </code>
                <span className="text-muted-foreground">
                  {seat.claimedByEmail ?? "Unclaimed"}
                </span>
                {!seat.eligibility.eligible && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {seat.eligibility.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {eligibleCount > 0 && (
            <>
              <Textarea
                name="reason"
                rows={3}
                required
                placeholder="Why do you want these Seats refunded?"
              />
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || picked.size === 0}
              >
                {isSubmitting
                  ? "Sending..."
                  : picked.size === 0
                    ? "Pick Seats to refund"
                    : `Request a refund of ${formatPrice(amount)} for ${picked.size} ${picked.size === 1 ? "Seat" : "Seats"}`}
              </Button>
            </>
          )}
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "No team found";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have a team yet.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
