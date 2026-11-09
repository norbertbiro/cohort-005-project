import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/team.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { seats, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  createRefundRequest,
  getTeamPurchaseRefundOptions,
  isTeamAdminOf,
} from "~/lib/refunds.server";
import { seatRefundAmount } from "~/lib/refunds";

const seatRefundSchema = z.object({
  purchaseId: z.coerce.number().int().positive(),
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

// Checkboxes send one `seatId` entry per ticked Seat, which a plain object
// cannot hold, so they are read and checked on their own.
const seatIdsSchema = z
  .array(z.coerce.number().int().positive())
  .min(1, "Pick at least one Seat.");

// A Seat Refund is asked for by the Team Admin, never by the Student who
// claimed the Seat. See docs/adr/0001-refunds-per-seat.md.
export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, seatRefundSchema);
  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const seatIds = seatIdsSchema.safeParse(formData.getAll("seatId"));
  if (!seatIds.success) {
    return data(
      { errors: { seatId: seatIds.error.issues[0]?.message ?? "Pick a Seat." } },
      { status: 400 }
    );
  }

  const { purchaseId, reason } = parsed.data;
  const options = getTeamPurchaseRefundOptions(purchaseId);

  if (!options) {
    throw data("Team Purchase not found.", { status: 404 });
  }

  const firstSeat = db
    .select({ teamId: seats.teamId })
    .from(seats)
    .where(eq(seats.purchaseId, purchaseId))
    .get();

  if (!firstSeat || !isTeamAdminOf(currentUserId, firstSeat.teamId)) {
    throw data("Only the Team Admin can request a refund for these Seats.", {
      status: 403,
    });
  }

  const requested = new Set(seatIds.data);
  const picked = options.seats.filter((seat) => requested.has(seat.seatId));

  if (picked.length !== requested.size) {
    throw data("A picked Seat does not belong to this Team Purchase.", {
      status: 400,
    });
  }

  const ineligible = picked.find((seat) => !seat.eligibility.eligible);
  if (ineligible && !ineligible.eligibility.eligible) {
    throw data(
      `Seat ${ineligible.code} cannot be refunded: ${ineligible.eligibility.label}.`,
      { status: 403 }
    );
  }

  createRefundRequest({
    purchaseId,
    reason,
    seatIds: picked.map((seat) => seat.seatId),
  });

  const teamAdmin = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  const amount = seatRefundAmount({
    amountPaid: options.amountPaid,
    totalSeats: options.totalSeats,
    alreadyRefundedSeats: options.refundedSeats,
    count: picked.length,
  });

  if (teamAdmin) {
    console.log(
      [
        `[email] to=${teamAdmin.email} subject=Refund requested: ${options.courseTitle}`,
        `Hi ${teamAdmin.name},`,
        "",
        `We have your Refund Request for ${picked.length} Seat(s) of "${options.courseTitle}".`,
        `The Refund is for ${formatPrice(amount)}, those Seats' share of what you paid.`,
        "",
        "Our team reviews every Refund Request by hand. We will email you again when it is done.",
        "",
        "The Cadence team",
      ].join("\n")
    );
  }

  return redirect("/team");
}
