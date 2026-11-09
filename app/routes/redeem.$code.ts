import { redirect } from "react-router";
import type { Route } from "./+types/redeem.$code";

// Seat Code links used to live under /redeem. Keep them working.
export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/claim/${encodeURIComponent(params.code)}`, 301);
}
