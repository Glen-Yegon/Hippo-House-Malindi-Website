
/* =========================================
   HIPPO HOUSE MALINDI
   BOOKING PAGE JAVASCRIPT
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* =====================================
     BOOKING CONFIGURATION
  ===================================== */

  const CONFIG = {
    nightlyRate: 18000,
    minimumNights: 2,
    maximumGuests: 6,
    currency: "KES"
  };

  /*
    TEMPORARY UNAVAILABLE DATES

    These are demonstration dates only.

    Keep them synchronized with the homepage
    calendar until we connect both calendars
    to the same backend.

    The backend will eventually control:
    - Available dates
    - Booked dates
    - Nightly pricing
    - Minimum stay
    - Booking confirmations
  */

  const bookedDates = new Set([
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-24",
    "2026-10-25",
    "2026-11-07",
    "2026-11-08"
  ]);

  /* =====================================
     ELEMENTS
  ===================================== */

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    steps: [
      $("#step1"),
      $("#step2"),
      $("#step3")
    ],

    progress: document.querySelectorAll(".booking-step"),

    calendarMonth: $("#calendarMonth"),
    calendarDays: $("#calendarDays"),
    prevMonth: $("#prevMonth"),
    nextMonth: $("#nextMonth"),

    selectedCheckin: $("#selectedCheckin"),
    selectedCheckout: $("#selectedCheckout"),

    guestCount: $("#guestCount"),
    stayMessage: $("#stayMessage"),

    continueDetails: $("#continueDetails"),
    backToStay: $("#backToStay"),

    guestForm: $("#guestDetailsForm"),
    detailsMessage: $("#detailsMessage"),
    backToDetails: $("#backToDetails"),

    editStay: $("#editStay"),
    editDetails: $("#editDetails"),

    submitBooking: $("#submitBooking"),
    submitMessage: $("#submitMessage"),

    summary: $("#bookingSummary")
  };

  /* =====================================
     STATE
  ===================================== */

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let displayedMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  const booking = {
    checkin: null,
    checkout: null,
    guests: 2,

    fullName: "",
    email: "",
    phone: "",
    specialRequests: ""
  };

  /* =====================================
     DATE UTILITIES
  ===================================== */

  function dateKey(date) {
    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
      date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function parseDate(key) {
    if (
      typeof key !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(key)
    ) {
      return null;
    }

    const [year, month, day] = key
      .split("-")
      .map(Number);

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  function formatDate(key, full = false) {
    const date = parseDate(key);

    if (!date) return "Select date";

    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(full ? { year: "numeric" } : {})
    });
  }

  function getNights(start, end) {
    const a = parseDate(start);
    const b = parseDate(end);

    if (!a || !b) return 0;

    const startUTC = Date.UTC(
      a.getFullYear(),
      a.getMonth(),
      a.getDate()
    );

    const endUTC = Date.UTC(
      b.getFullYear(),
      b.getMonth(),
      b.getDate()
    );

    return Math.round(
      (endUTC - startUTC) / 86400000
    );
  }

  function isBooked(key) {
    return bookedDates.has(key);
  }

  function isPast(key) {
    return key < dateKey(today);
  }

  function isUnavailable(key) {
    return isPast(key) || isBooked(key);
  }

  /* =====================================
     CHECK DATE RANGE
  ===================================== */

  function rangeIsAvailable(start, end) {
    const first = parseDate(start);
    const last = parseDate(end);

    if (!first || !last || last <= first) {
      return false;
    }

    /*
      Current rule:

      Both check-in and check-out must be
      available, and the selected range
      cannot cross unavailable dates.

      Same-day turnover rules can be
      implemented with the backend later.
    */

    const cursor = new Date(first);

    while (cursor <= last) {
      if (isUnavailable(dateKey(cursor))) {
        return false;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return true;
  }

  function validStay() {
    if (!booking.checkin || !booking.checkout) {
      return false;
    }

    const nights = getNights(
      booking.checkin,
      booking.checkout
    );

    return (
      nights >= CONFIG.minimumNights &&
      rangeIsAvailable(
        booking.checkin,
        booking.checkout
      ) &&
      booking.guests >= 1 &&
      booking.guests <= CONFIG.maximumGuests
    );
  }

  /* =====================================
     PRICING
  ===================================== */

  function getTotal() {
    if (!validStay()) return 0;

    return getNights(
      booking.checkin,
      booking.checkout
    ) * CONFIG.nightlyRate;
  }

  function money(amount) {
    return `KSh ${new Intl.NumberFormat("en-KE", {
      maximumFractionDigits: 0
    }).format(amount)}`;
  }

  /* =====================================
     MESSAGES
  ===================================== */

  function showMessage(element, message) {
    if (element) {
      element.textContent = message;
    }
  }

  function clearMessages() {
    [
      elements.stayMessage,
      elements.detailsMessage,
      elements.submitMessage
    ].forEach((element) => {
      if (element) {
        element.textContent = "";
      }
    });
  }

  /* =====================================
     CALENDAR RENDERING
  ===================================== */

  function renderCalendar() {
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();

    elements.calendarMonth.textContent =
      displayedMonth.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
      });

    elements.calendarDays.innerHTML = "";

    const firstDay = new Date(year, month, 1);

    const daysInMonth = new Date(
      year,
      month + 1,
      0
    ).getDate();

    // Monday-first calendar.
    const offset = (firstDay.getDay() + 6) % 7;

    // Empty cells before the first day.
    for (let i = 0; i < offset; i++) {
      const empty = document.createElement("span");

      empty.className = "calendar-day-empty";
      empty.setAttribute("aria-hidden", "true");

      elements.calendarDays.appendChild(empty);
    }

    // Generate all dates.
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);

      const past = isPast(key);
      const booked = isBooked(key);

      const selected =
        key === booking.checkin ||
        key === booking.checkout;

      const inRange =
        booking.checkin &&
        booking.checkout &&
        key > booking.checkin &&
        key < booking.checkout;

      const button = document.createElement("button");

      button.type = "button";
      button.className = "calendar-day";
      button.textContent = String(day);

      if (past) {
        button.classList.add("is-past");
      } else if (booked) {
        button.classList.add("is-booked");
      } else if (selected) {
        button.classList.add("is-selected");
      } else if (inRange) {
        button.classList.add("is-range");
      }

      // Prevent selecting unavailable dates.
      button.disabled = past || booked;

      const dateDescription = date.toLocaleDateString(
        "en-GB",
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        }
      );

      let status = "Available";

      if (past) {
        status = "Past date";
      } else if (booked) {
        status = "Unavailable";
      } else if (key === booking.checkin) {
        status = "Selected check-in";
      } else if (key === booking.checkout) {
        status = "Selected check-out";
      } else if (inRange) {
        status = "Within selected stay";
      }

      button.setAttribute(
        "aria-label",
        `${dateDescription}. ${status}`
      );

      if (selected) {
        button.setAttribute("aria-pressed", "true");
      }

      button.addEventListener("click", () => {
        selectDate(key);
      });

      elements.calendarDays.appendChild(button);
    }

    // Disable previous month when viewing current month.
    const firstCurrentMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    elements.prevMonth.disabled =
      displayedMonth <= firstCurrentMonth;
  }

  /* =====================================
     DATE SELECTION
  ===================================== */

  function selectDate(key) {
    if (isUnavailable(key)) return;

    clearMessages();

    /*
      First click: check-in.
      Second click: check-out.

      After a completed selection,
      clicking another date starts over.

      Clicking an earlier date also
      starts a new selection.
    */

    if (
      !booking.checkin ||
      booking.checkout ||
      key <= booking.checkin
    ) {
      booking.checkin = key;
      booking.checkout = null;
    } else {
      const nights = getNights(
        booking.checkin,
        key
      );

      if (nights < CONFIG.minimumNights) {
        showMessage(
          elements.stayMessage,
          `A minimum stay of ${CONFIG.minimumNights} nights is required.`
        );

        return;
      }

      if (!rangeIsAvailable(booking.checkin, key)) {
        showMessage(
          elements.stayMessage,
          "Your selected stay includes unavailable dates. Please choose another range."
        );

        return;
      }

      booking.checkout = key;
    }

    updateBookingUI();
  }

  /* =====================================
     UPDATE BOOKING SUMMARY
  ===================================== */

  function setText(selector, value) {
    const element = $(selector);

    if (element) {
      element.textContent = value;
    }
  }

  function updateBookingUI() {
    const nights = validStay()
      ? getNights(
          booking.checkin,
          booking.checkout
        )
      : 0;

    const total = getTotal();

    // Selected dates beneath calendar.
    elements.selectedCheckin.textContent =
      formatDate(booking.checkin);

    elements.selectedCheckout.textContent =
      formatDate(booking.checkout);

    // Sidebar summary.
    setText(
      "#summaryCheckin",
      booking.checkin
        ? formatDate(booking.checkin, true)
        : "Not selected"
    );

    setText(
      "#summaryCheckout",
      booking.checkout
        ? formatDate(booking.checkout, true)
        : "Not selected"
    );

    setText(
      "#summaryGuests",
      `${booking.guests} guest${booking.guests === 1 ? "" : "s"}`
    );

    setText(
      "#summaryRate",
      money(CONFIG.nightlyRate)
    );

    setText(
      "#summaryDuration",
      nights
        ? `${nights} night${nights === 1 ? "" : "s"}`
        : "—"
    );

    setText(
      "#summaryTotal",
      money(total)
    );

    renderCalendar();
  }

  /* =====================================
     STEP NAVIGATION
  ===================================== */

  function goToStep(step) {
    elements.steps.forEach((panel, index) => {
      panel.hidden = index + 1 !== step;
    });

    elements.summary.hidden = false;

    elements.progress.forEach((item, index) => {
      const number = index + 1;

      item.classList.toggle(
        "is-active",
        number === step
      );

      item.classList.toggle(
        "is-complete",
        number < step
      );

      if (number === step) {
        item.setAttribute(
          "aria-current",
          "step"
        );
      } else {
        item.removeAttribute("aria-current");
      }
    });

    window.scrollTo({
      top: 0,
      behavior: window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches ? "auto" : "smooth"
    });
  }

  /* =====================================
     STEP 1 — CONTINUE TO DETAILS
  ===================================== */

  elements.continueDetails.addEventListener(
    "click",
    () => {
      clearMessages();

      if (!booking.checkin) {
        showMessage(
          elements.stayMessage,
          "Please select your check-in date."
        );

        return;
      }

      if (!booking.checkout) {
        showMessage(
          elements.stayMessage,
          "Please select your check-out date."
        );

        return;
      }

      if (!validStay()) {
        showMessage(
          elements.stayMessage,
          "Please select a valid stay using available dates."
        );

        return;
      }

      goToStep(2);
    }
  );

  /* =====================================
     GUEST COUNT
  ===================================== */

  elements.guestCount.addEventListener(
    "change",
    () => {
      booking.guests = Number(
        elements.guestCount.value
      );

      updateBookingUI();
    }
  );

  /* =====================================
     STEP 2 — GUEST DETAILS
  ===================================== */

  function collectGuestDetails() {
    const form = elements.guestForm;

    if (!form.checkValidity()) {
      form.reportValidity();
      return false;
    }

    const name = $("#fullName").value.trim();
    const email = $("#emailAddress").value.trim();
    const phone = $("#phoneNumber").value.trim();

    if (!name || !email || !phone) {
      showMessage(
        elements.detailsMessage,
        "Please complete all required fields."
      );

      return false;
    }

    if (phone.replace(/\D/g, "").length < 7) {
      showMessage(
        elements.detailsMessage,
        "Please enter a valid phone number."
      );

      $("#phoneNumber").focus();

      return false;
    }

    booking.fullName = name;
    booking.email = email;
    booking.phone = phone;

    booking.specialRequests =
      $("#specialRequests").value.trim();

    return true;
  }

  elements.guestForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      clearMessages();

      if (!validStay()) {
        goToStep(1);

        showMessage(
          elements.stayMessage,
          "Please review your stay dates."
        );

        return;
      }

      if (!collectGuestDetails()) {
        return;
      }

      updateReview();
      goToStep(3);
    }
  );

  /* =====================================
     STEP 3 — REVIEW & PAY
  ===================================== */

  function updateReview() {
    setText(
      "#reviewCheckin",
      formatDate(booking.checkin, true)
    );

    setText(
      "#reviewCheckout",
      formatDate(booking.checkout, true)
    );

    setText(
      "#reviewGuests",
      `${booking.guests} guest${booking.guests === 1 ? "" : "s"}`
    );

    setText(
      "#reviewNights",
      String(
        getNights(
          booking.checkin,
          booking.checkout
        )
      )
    );

    setText(
      "#reviewName",
      booking.fullName
    );

    setText(
      "#reviewEmail",
      booking.email
    );

    setText(
      "#reviewPhone",
      booking.phone
    );

    setText(
      "#reviewRequests",
      booking.specialRequests || "None"
    );

    setText(
      "#reviewTotal",
      money(getTotal())
    );
  }

  /* =====================================
     BACK & EDIT BUTTONS
  ===================================== */

  elements.backToStay.addEventListener(
    "click",
    () => {
      clearMessages();
      goToStep(1);
    }
  );

  elements.backToDetails.addEventListener(
    "click",
    () => {
      clearMessages();
      goToStep(2);
    }
  );

  elements.editStay.addEventListener(
    "click",
    () => {
      clearMessages();
      goToStep(1);
    }
  );

  elements.editDetails.addEventListener(
    "click",
    () => {
      clearMessages();
      goToStep(2);
    }
  );

  /* =====================================
     PAY NOW — PAYSTACK PLACEHOLDER
  ===================================== */

  elements.submitBooking.addEventListener(
    "click",
    () => {
      clearMessages();

      // Validate stay again before payment.
      if (!validStay()) {
        goToStep(1);

        showMessage(
          elements.stayMessage,
          "Please review your selected dates before proceeding."
        );

        return;
      }

      // Validate guest information.
      if (!collectGuestDetails()) {
        goToStep(2);
        return;
      }

      // Update final reservation review.
      updateReview();

      /*
        PAYSTACK INTEGRATION WILL GO HERE.

        FUTURE PAYMENT FLOW:

        1. Send reservation details to backend.

        2. Backend verifies availability
           and calculates the correct amount.

        3. Backend creates a temporary
           reservation hold.

        4. Backend initializes Paystack.

        5. Guest completes payment through
           Paystack checkout.

        6. Backend verifies payment using
           Paystack's API/webhook.

        7. Backend confirms the reservation.

        8. Confirmed dates become unavailable
           on both booking calendars.

        9. Confirmation emails are sent
           to the guest and property owner.

        IMPORTANT:
        Never confirm a booking based only
        on frontend payment callbacks.
      */

      showMessage(
        elements.submitMessage,
        "Online payments are not yet enabled. No payment has been taken and your reservation has not been confirmed."
      );
    }
  );

  /* =====================================
     CALENDAR NAVIGATION
  ===================================== */

  elements.prevMonth.addEventListener(
    "click",
    () => {
      const previous = new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() - 1,
        1
      );

      const currentMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      );

      if (previous < currentMonth) {
        return;
      }

      displayedMonth = previous;

      renderCalendar();
    }
  );

  elements.nextMonth.addEventListener(
    "click",
    () => {
      displayedMonth = new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() + 1,
        1
      );

      renderCalendar();
    }
  );

  /* =====================================
     HOMEPAGE DATE PRESELECTION
  ===================================== */

  function loadDatesFromURL() {
    const params = new URLSearchParams(
      window.location.search
    );

    const checkin = params.get("checkin");
    const checkout = params.get("checkout");

    if (!checkin || !checkout) {
      return;
    }

    const start = parseDate(checkin);
    const end = parseDate(checkout);

    if (!start || !end) {
      showMessage(
        elements.stayMessage,
        "Please select valid check-in and check-out dates."
      );

      return;
    }

    const nights = getNights(
      checkin,
      checkout
    );

    if (
      nights < CONFIG.minimumNights ||
      !rangeIsAvailable(checkin, checkout)
    ) {
      showMessage(
        elements.stayMessage,
        "The dates from your previous selection are unavailable or do not meet the minimum stay. Please choose new dates."
      );

      return;
    }

    booking.checkin = checkin;
    booking.checkout = checkout;

    displayedMonth = new Date(
      start.getFullYear(),
      start.getMonth(),
      1
    );
  }

  /* =====================================
     INITIALIZE
  ===================================== */

  function initialize() {
    booking.guests = Number(
      elements.guestCount.value
    );

    loadDatesFromURL();

    updateBookingUI();
    goToStep(1);
  }

  initialize();

});
