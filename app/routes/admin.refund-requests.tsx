import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { AlertTriangle, ReceiptText } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/admin.refund-requests";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { formatPrice } from "~/lib/utils";
import { parseFormData } from "~/lib/validation";
import {
  getOpenRefundRequests,
  resolveRefundRequest,
} from "~/lib/refunds.server";

const decisionSchema = z.object({
  refundId: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "decline"]),
});

// Only the platform Admin decides Refund Requests, never a Team Admin or the
// course's Instructor.
async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only Admins can decide Refund Requests.", { status: 403 });
  }

  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { requests: getOpenRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const resolved = resolveRefundRequest({
    refundId: parsed.data.refundId,
    adminUserId: admin.id,
    decision: parsed.data.decision,
  });

  if (!resolved) {
    return data(
      { error: "This Refund Request is not open any more." },
      { status: 409 }
    );
  }

  // No payment provider or mail transport is wired up yet, so the payout and
  // the email go to the server log.
  if (resolved.decision === "approve") {
    console.log(
      `[payout] ${formatPrice(resolved.amount)} to ${resolved.requesterEmail} for "${resolved.courseTitle}"`
    );
  }
  console.log(
    [
      `[email] to=${resolved.requesterEmail} subject=Refund Request ${
        resolved.decision === "approve" ? "approved" : "declined"
      }: ${resolved.courseTitle}`,
      `Hi ${resolved.requesterName},`,
      "",
      resolved.decision === "approve"
        ? `Your Refund of ${formatPrice(resolved.amount)} for "${resolved.courseTitle}" is approved. The money goes back to the card you paid with.`
        : `We have looked at your Refund Request for "${resolved.courseTitle}" and declined it. Nothing changes on your Purchase.`,
      "",
      "The Cadence team",
    ].join("\n")
  );

  return { decision: resolved.decision };
}

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { requests } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline each open Refund Request. Approving ends the
          Enrollment of each Student involved.
        </p>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No open Refund Requests.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <RefundRequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </div>
  );
}

function RefundRequestCard({
  request,
}: {
  request: Route.ComponentProps["loaderData"]["requests"][number];
}) {
  const fetcher = useFetcher<{ error?: string; decision?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              to={`/courses/${request.courseSlug}`}
              className="font-medium hover:underline"
            >
              {request.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {request.requesterName} ({request.requesterEmail}) · raised{" "}
              {new Date(request.requestedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">
              {formatPrice(request.amount)}
            </div>
            <div className="text-xs text-muted-foreground">
              {request.seatCount > 0
                ? `${request.seatCount} ${request.seatCount === 1 ? "Seat" : "Seats"}`
                : "Single Purchase"}
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm">{request.reason}</p>
        <fetcher.Form method="post" className="mt-4 flex gap-2">
          <input type="hidden" name="refundId" value={request.id} />
          <Button
            type="submit"
            name="decision"
            value="approve"
            size="sm"
            disabled={isSubmitting}
          >
            Approve
          </Button>
          <Button
            type="submit"
            name="decision"
            value="decline"
            size="sm"
            variant="outline"
            disabled={isSubmitting}
          >
            Decline
          </Button>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
