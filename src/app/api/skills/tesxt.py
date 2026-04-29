from datetime import datetime, time
from typing import Any, Dict


def build_response(**kwargs):
    return {
        "booking_id": kwargs.get("booking_id"),
        "booking_checkin_date": kwargs.get("booking_checkin_date"),
        "booking_checkout_date": kwargs.get("booking_checkout_date"),
        "guest_stage": kwargs.get("guest_stage"),
        "guest_stage_context": kwargs.get("guest_stage_context"),
        "has_active_booking": kwargs.get("has_active_booking"),
        "booking_status": kwargs.get("booking_status"),
        "days_to_checkin": kwargs.get("days_to_checkin"),
        "days_since_checkout": kwargs.get("days_since_checkout"),
    }



def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def execute(**inputs):
    BOOKING_STATUS_LABEL: Dict[int, str] = {
        1: "pending",
        2: "confirmed",
        3: "cancellation",
        4: "no_show",
        5: "checked_in",
        6: "checked_out",
    }

    bookings = inputs.get("user_all_bookings", [])
    details = inputs.get("user_current_booking_details", {})
    booking_id = details.get("booking_id")
    checkin_str = details.get("booking_checkin_date")
    checkout_str = details.get("booking_checkout_date")
    status = next(
        (
            b.get("status")
            for b in bookings
            if str(b.get("code", "")).strip() == str(booking_id)
        ),
        None,
    )
    booking_status_label = (
        BOOKING_STATUS_LABEL.get(_safe_int(status), "unknown")
        if status is not None
        else "unknown"
    )

    if not booking_id or booking_id == "":
        return {"user_current_booking_details":build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="pre_booking",
            guest_stage_context="No booking found for this guest. They are in exploratory/pre-booking stage.",
            has_active_booking=False,
            booking_status=booking_status_label,
            days_to_checkin=None,
            days_since_checkout=None,
        )}

    if booking_status_label == BOOKING_STATUS_LABEL.get(3):
        return {"user_current_booking_details": build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="post_checkout",
            guest_stage_context=f"Booking {booking_id} exists but is CANCELLED. Guest may be reaching out about refund, rebooking, or complaint about cancellation.",
            has_active_booking=False,
            booking_status=booking_status_label,
            days_to_checkin=None,
            days_since_checkout=None,
        )}

    if booking_status_label == BOOKING_STATUS_LABEL.get(1):
        return {"user_current_booking_details": build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="pre_booking",
            guest_stage_context=f"Booking {booking_id} exists but payment is {booking_status_label}. Guest may need help completing the booking.",
            has_active_booking=False,
            booking_status=booking_status_label,
            days_to_checkin=None,
            days_since_checkout=None,
        )}

    try:
        checkin = datetime.strptime(checkin_str, "%Y-%m-%d").date()
        checkout = datetime.strptime(checkout_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return {"user_current_booking_details": build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="post_booking_pre_arrival",
            guest_stage_context=f"Booking {booking_id} exists but dates could not be determined. Treating as post-booking.",
            has_active_booking=True,
            booking_status=booking_status_label,
            days_to_checkin=None,
            days_since_checkout=None,
        )}

    now = datetime.now()
    today = now.date()
    days_to_checkin = (checkin - today).days
    days_since_checkout = (today - checkout).days
    CHECKIN_TIME = time(12, 0)
    CHECKOUT_TIME = time(11, 0)
    current_time = now.time()

    if today == checkin:
        if current_time < CHECKIN_TIME:
            return {"user_current_booking_details": build_response(
                booking_id=booking_id,
                booking_checkin_date=checkin_str,
                booking_checkout_date=checkout_str,
                guest_stage="post_booking_pre_arrival",
                guest_stage_context=f"Booking {booking_id}. Today is check-in day ({checkin_str}) but it's before 12 PM — guest likely hasn't arrived yet.",
                has_active_booking=True,
                booking_status=booking_status_label,
                days_to_checkin=0,
                days_since_checkout=None,
            )}
        else:
            return {"user_current_booking_details": build_response(
                booking_id=booking_id,
                booking_checkin_date=checkin_str,
                booking_checkout_date=checkout_str,
                guest_stage="at_property",
                guest_stage_context=f"Booking {booking_id}. Today is check-in day ({checkin_str}) and it's past 12 PM — guest is at the property.",
                has_active_booking=True,
                booking_status=booking_status_label,
                days_to_checkin=0,
                days_since_checkout=None,
            )}

    if today == checkout:
        if current_time < CHECKOUT_TIME:
            return {"user_current_booking_details": build_response(
                booking_id=booking_id,
                booking_checkin_date=checkin_str,
                booking_checkout_date=checkout_str,
                guest_stage="at_property",
                guest_stage_context=f"Booking {booking_id}. Today is checkout day ({checkout_str}) but it's before 11 AM — guest is still at the property.",
                has_active_booking=True,
                booking_status=booking_status_label,
                days_to_checkin=None,
                days_since_checkout=0,
            )}
        else:
            return {"user_current_booking_details": build_response(
                booking_id=booking_id,
                booking_checkin_date=checkin_str,
                booking_checkout_date=checkout_str,
                guest_stage="post_checkout",
                guest_stage_context=f"Booking {booking_id}. Today is checkout day ({checkout_str}) and it's past 11 AM — guest has checked out.",
                has_active_booking=True,
                booking_status=booking_status_label,
                days_to_checkin=None,
                days_since_checkout=0,
            )}

    if today < checkin:
        return {"user_current_booking_details": build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="post_booking_pre_arrival",
            guest_stage_context=f"Booking {booking_id}. Check-in is {checkin_str} ({days_to_checkin} days away). Guest has not arrived yet.",
            has_active_booking=True,
            booking_status=booking_status_label,
            days_to_checkin=days_to_checkin,
            days_since_checkout=None,
        )}

    if checkin < today < checkout:
        return {"user_current_booking_details": build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="at_property",
            guest_stage_context=f"Booking {booking_id}. Guest is currently at the property (check-in: {checkin_str}, check-out: {checkout_str}).",
            has_active_booking=True,
            booking_status=booking_status_label,
            days_to_checkin=0,
            days_since_checkout=None,
        )}

    if today > checkout:
        return {"user_current_booking_details": build_response(
            booking_id=booking_id,
            booking_checkin_date=checkin_str,
            booking_checkout_date=checkout_str,
            guest_stage="post_checkout",
            guest_stage_context=f"Booking {booking_id}. Guest checked out on {checkout_str} ({days_since_checkout} days ago).",
            has_active_booking=True,
            booking_status=booking_status_label,
            days_to_checkin=None,
            days_since_checkout=days_since_checkout,
        )}

    return {"user_current_booking_details": build_response(
        booking_id=booking_id,
        booking_checkin_date=checkin_str,
        booking_checkout_date=checkout_str,
        guest_stage="pre_booking",
        guest_stage_context="Could not determine stage. Defaulting to pre-booking.",
        has_active_booking=False,
        booking_status=booking_status_label,
        days_to_checkin=None,
        days_since_checkout=None,
    )}