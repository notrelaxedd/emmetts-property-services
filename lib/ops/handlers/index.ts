/**
 * Registers one side-effect handler per approval kind. Import this module (for its side effects)
 * anywhere `applyApproval` is called: server actions in /admin, the fleet workers, and tests.
 */
import { registerApprovalHandler, registerRejectHandler } from "../approvals";
import { rejectAd, rejectBooking, rejectCrewChange, rejectDrop, rejectFollowup, rejectQuote } from "./reject";
import { adHandler } from "./ad";
import { quoteHandler } from "./quote";
import { custom_itemHandler } from "./custom_item";
import { bookingHandler } from "./booking";
import { followupHandler } from "./followup";
import { crew_changeHandler } from "./crew_change";
import { dropHandler } from "./drop";
import { weather_holdHandler } from "./weather_hold";
import { ai_capHandler } from "./ai_cap";

export function registerAllApprovalHandlers() {
  registerApprovalHandler("ad", adHandler);
  registerApprovalHandler("quote", quoteHandler);
  registerApprovalHandler("custom_item", custom_itemHandler);
  registerApprovalHandler("booking", bookingHandler);
  registerApprovalHandler("followup", followupHandler);
  registerApprovalHandler("crew_change", crew_changeHandler);
  registerApprovalHandler("drop", dropHandler);
  registerApprovalHandler("weather_hold", weather_holdHandler);
  registerApprovalHandler("ai_cap", ai_capHandler);

  registerRejectHandler("drop", rejectDrop);
  registerRejectHandler("crew_change", rejectCrewChange);
  registerRejectHandler("quote", rejectQuote);
  registerRejectHandler("booking", rejectBooking);
  registerRejectHandler("followup", rejectFollowup);
  registerRejectHandler("ad", rejectAd);
}

registerAllApprovalHandlers();
