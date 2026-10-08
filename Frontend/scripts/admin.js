
/* =========================================
   HIPPO HOUSE MALINDI
   ADMIN DASHBOARD JAVASCRIPT

   FRONTEND DEMONSTRATION

   No Firebase, payment processing,
   authentication or backend connection yet.

   Demo reservations and date blocks are
   stored in memory only and disappear
   when the page is refreshed.
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* =====================================
     HELPERS
  ===================================== */

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const state = {
    page: "overview",
    reservations: [],
    manualBlocks: new Map(),
    selectedStart: null,
    selectedEnd: null,
    calendarMonth: new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    ),
    pricing: {
      nightlyRate: 18000,
      minimumNights: 2,
      maximumGuests: 6
    },
    settings: {
      name: "Hippo House Malindi",
      location: "Malindi, Kenya",
      email: "",
      phone: "",
      checkin: "14:00",
      checkout: "11:00"
    }
  };

  let toastTimeout = null;
  let lastModalTrigger = null;

  const pageTitles = {
    overview: "Overview",
    reservations: "Reservations",
    availability: "Availability",
    payments: "Payments",
    pricing: "Pricing",
    settings: "Settings"
  };

  /* =====================================
     DATE UTILITIES
  ===================================== */

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
  }

  function parseDate(key) {
    if (
      typeof key !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(key)
    ) {
      return null;
    }

    const [year, month, day] = key.split("-").map(Number);
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

  function formatDate(key, includeYear = true) {
    const date = parseDate(key);
    if (!date) return "—";

    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" } : {})
    });
  }

  function nightsBetween(start, end) {
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

    return Math.round((endUTC - startUTC) / 86400000);
  }

  function datesBetween(start, end) {
    const first = parseDate(start);
    const last = parseDate(end);

    if (!first || !last || first >= last) return [];

    const dates = [];
    const cursor = new Date(first);

    // End date is exclusive (checkout date).
    while (cursor < last) {
      dates.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function money(amount) {
    return `KSh ${new Intl.NumberFormat("en-KE", {
      maximumFractionDigits: 0
    }).format(amount)}`;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 3500);
  }

  function setFeedback(selector, message, isError = false) {
    const element = $(selector);
    if (!element) return;

    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  /* =====================================
     NAVIGATION
  ===================================== */

  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#sidebarOverlay").classList.remove("show");
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
    $("#sidebarOverlay").classList.add("show");
  }

  function navigateTo(page) {
    if (!pageTitles[page]) return;

    state.page = page;

    $$(".page-section").forEach((section) => {
      const active = section.id === `page-${page}`;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });

    $$(".nav-item").forEach((button) => {
      const active = button.dataset.page === page;

      button.classList.toggle("active", active);

      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    $("#breadcrumbCurrent").textContent = pageTitles[page];

    closeSidebar();

    if (page === "availability") {
      renderCalendar();
    }

    if (page === "reservations") {
      renderReservations();
    }

    window.scrollTo({
      top: 0,
      behavior: "auto"
    });
  }

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.page);
    });
  });

  $$("[data-page-target]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.pageTarget);
    });
  });

  $("#openSidebar").addEventListener("click", openSidebar);
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#sidebarOverlay").addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!$("#reservationModal").hidden) {
        closeReservationModal();
      } else {
        closeSidebar();
      }
    }
  });

  /* =====================================
     HEADER & DAILY DATE
  ===================================== */

  function initializeDates() {
    const formatted = today.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    $("#topbarDate").textContent = formatted;
    $("#activityDate").textContent = formatted;
  }

  /* =====================================
     MANUAL RESERVATION MODAL
  ===================================== */

  function openReservationModal() {
    lastModalTrigger = document.activeElement;

    $("#reservationForm").reset();

    $("#reservationGuests").max = state.pricing.maximumGuests;
    $("#reservationGuests").value = Math.min(
      2,
      state.pricing.maximumGuests
    );

    $("#reservationCheckin").min = dateKey(today);
    $("#reservationCheckout").min = dateKey(today);

    $("#reservationTotal").value = "";
    $("#reservationPaid").value = "0";

    $("#bookingCalculation").textContent =
      "Select dates to calculate the estimated total.";

    setFeedback("#reservationFeedback", "");

    $("#reservationModal").hidden = false;
    document.body.classList.add("modal-open");

    $("#guestName").focus();
  }

  function closeReservationModal() {
    $("#reservationModal").hidden = true;
    document.body.classList.remove("modal-open");

    if (lastModalTrigger?.focus) {
      lastModalTrigger.focus();
    }
  }

  $$('[data-action="new-reservation"]').forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo("reservations");
      openReservationModal();
    });
  });

  $("#addReservationBtn").addEventListener(
    "click",
    openReservationModal
  );

  $("#closeReservationModal").addEventListener(
    "click",
    closeReservationModal
  );

  $("#cancelReservation").addEventListener(
    "click",
    closeReservationModal
  );

  $("#reservationModal").addEventListener("click", (event) => {
    if (event.target === $("#reservationModal")) {
      closeReservationModal();
    }
  });

  // Keep keyboard focus inside the modal.
  $("#reservationModal").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;

    const focusable = $$(
      '#reservationModal button:not([disabled]), ' +
      '#reservationModal input:not([disabled]), ' +
      '#reservationModal select:not([disabled]), ' +
      '#reservationModal textarea:not([disabled])'
    );

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* =====================================
     RESERVATION PRICE CALCULATION
  ===================================== */

  function updateReservationEstimate() {
    const checkin = $("#reservationCheckin").value;
    const checkout = $("#reservationCheckout").value;

    const nights = nightsBetween(checkin, checkout);

    if (nights <= 0) {
      $("#bookingCalculation").textContent =
        "Select valid check-in and check-out dates.";
      return;
    }

    const total = nights * state.pricing.nightlyRate;

    $("#bookingCalculation").textContent =
      `${nights} night${nights === 1 ? "" : "s"} × ` +
      `${money(state.pricing.nightlyRate)} = ${money(total)} ` +
      "(estimated demo rate).";

    $("#reservationTotal").value = total;
  }

  $("#reservationCheckin").addEventListener("change", () => {
    $("#reservationCheckout").min =
      $("#reservationCheckin").value || dateKey(today);

    updateReservationEstimate();
  });

  $("#reservationCheckout").addEventListener(
    "change",
    updateReservationEstimate
  );

  /* =====================================
     AVAILABILITY VALIDATION

     Pending reservations do not block dates.
     Confirmed reservations do.

     Manual date blocks also prevent a
     confirmed reservation from being added.
  ===================================== */

  function hasConfirmedConflict(start, end, ignoreId = null) {
    return state.reservations.some((reservation) => {
      if (reservation.id === ignoreId) return false;
      if (reservation.status !== "confirmed") return false;

      return rangesOverlap(
        start,
        end,
        reservation.checkin,
        reservation.checkout
      );
    });
  }

  function hasManualBlockConflict(start, end) {
    return datesBetween(start, end).some((key) =>
      state.manualBlocks.has(key)
    );
  }

  function isDemoReserved(key) {
    return state.reservations.some((reservation) => {
      return (
        reservation.status === "confirmed" &&
        key >= reservation.checkin &&
        key < reservation.checkout
      );
    });
  }

  /* =====================================
     CREATE MANUAL RESERVATION
  ===================================== */

  $("#reservationForm").addEventListener("submit", (event) => {
    event.preventDefault();

    setFeedback("#reservationFeedback", "");

    const form = $("#reservationForm");

    if (!form.reportValidity()) return;

    const checkin = $("#reservationCheckin").value;
    const checkout = $("#reservationCheckout").value;
    const guests = Number($("#reservationGuests").value);
    const total = Number($("#reservationTotal").value);
    const paid = Number($("#reservationPaid").value);
    const status = $("#reservationStatus").value;

    const nights = nightsBetween(checkin, checkout);

    if (!parseDate(checkin) || !parseDate(checkout)) {
      setFeedback(
        "#reservationFeedback",
        "Please select valid dates.",
        true
      );
      return;
    }

    if (checkin < dateKey(today)) {
      setFeedback(
        "#reservationFeedback",
        "Check-in cannot be in the past.",
        true
      );
      return;
    }

    if (nights < state.pricing.minimumNights) {
      setFeedback(
        "#reservationFeedback",
        `The minimum stay is ${state.pricing.minimumNights} nights.`,
        true
      );
      return;
    }

    if (
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > state.pricing.maximumGuests
    ) {
      setFeedback(
        "#reservationFeedback",
        `Guest count must be between 1 and ${state.pricing.maximumGuests}.`,
        true
      );
      return;
    }

    if (
      !Number.isFinite(total) ||
      !Number.isFinite(paid) ||
      total < 0 ||
      paid < 0 ||
      paid > total
    ) {
      setFeedback(
        "#reservationFeedback",
        "The amount paid cannot exceed the total amount.",
        true
      );
      return;
    }

    if (status === "confirmed") {
      if (hasConfirmedConflict(checkin, checkout)) {
        setFeedback(
          "#reservationFeedback",
          "These dates overlap an existing confirmed demo reservation.",
          true
        );
        return;
      }

      if (hasManualBlockConflict(checkin, checkout)) {
        setFeedback(
          "#reservationFeedback",
          "These dates include manually blocked days. Remove the block first.",
          true
        );
        return;
      }
    }

    const reservation = {
      id: `DEMO-${String(state.reservations.length + 1).padStart(3, "0")}`,
      name: $("#guestName").value.trim(),
      email: $("#guestEmail").value.trim(),
      phone: $("#guestPhone").value.trim(),
      checkin,
      checkout,
      nights,
      guests,
      total,
      paid,
      status,
      notes: $("#reservationNotes").value.trim(),
      source: "manual_demo",
      createdAt: new Date().toISOString()
    };

    if (!reservation.name || !reservation.phone) {
      setFeedback(
        "#reservationFeedback",
        "Guest name and phone number are required.",
        true
      );
      return;
    }

    state.reservations.push(reservation);

    closeReservationModal();
    renderReservations();
    renderCalendar();

    showToast(
      "Demo reservation added. It has not been saved to a database."
    );
  });

  /* =====================================
     RESERVATIONS TABLE
  ===================================== */

  function createCell(row, text, tag = "td") {
    const cell = document.createElement(tag);
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
  }

  function renderReservations() {
    const tbody = $("#reservationTableBody");
    const empty = $("#reservationEmpty");

    tbody.innerHTML = "";

    const search = $("#reservationSearch").value
      .trim()
      .toLowerCase();

    const filter = $("#reservationFilter").value;

    const results = state.reservations.filter((reservation) => {
      const matchesSearch = [
        reservation.name,
        reservation.email,
        reservation.phone,
        reservation.id
      ].some((value) =>
        String(value).toLowerCase().includes(search)
      );

      const matchesStatus =
        filter === "all" || reservation.status === filter;

      return matchesSearch && matchesStatus;
    });

    $("#reservationCount").textContent =
      `${state.reservations.length} demo record` +
      (state.reservations.length === 1 ? "" : "s");

    empty.hidden = results.length > 0;

    if (results.length === 0) {
      empty.querySelector("h3").textContent =
        state.reservations.length
          ? "No matching reservations"
          : "No demo reservations";

      empty.querySelector("p").textContent =
        state.reservations.length
          ? "Try changing your search or status filter."
          : "Use Add Reservation to create a temporary manual booking.";

      return;
    }

    results.forEach((reservation) => {
      const row = document.createElement("tr");

      const guestCell = document.createElement("td");
      const guestName = document.createElement("strong");
      const guestRef = document.createElement("small");

      guestName.textContent = reservation.name;
      guestRef.textContent = reservation.id;

      guestCell.append(guestName, guestRef);
      row.appendChild(guestCell);

      const datesCell = document.createElement("td");
      datesCell.textContent =
        `${formatDate(reservation.checkin, false)} – ` +
        `${formatDate(reservation.checkout, false)}`;
      row.appendChild(datesCell);

      createCell(row, String(reservation.guests));
      createCell(row, money(reservation.total));

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");

      badge.className =
        `status-badge status-${reservation.status}`;

      badge.textContent =
        reservation.status.charAt(0).toUpperCase() +
        reservation.status.slice(1);

      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const actionCell = document.createElement("td");
      const actionButton = document.createElement("button");

      actionButton.type = "button";
      actionButton.className = "table-action";
      actionButton.textContent = "View";

      actionButton.addEventListener("click", () => {
        viewReservation(reservation.id);
      });

      actionCell.appendChild(actionButton);
      row.appendChild(actionCell);

      tbody.appendChild(row);
    });
  }

  $("#reservationSearch").addEventListener(
    "input",
    renderReservations
  );

  $("#reservationFilter").addEventListener(
    "change",
    renderReservations
  );

  /* =====================================
     RESERVATION DETAILS

     Demo records can be viewed and
     cancelled for testing.
  ===================================== */

  function viewReservation(id) {
    const reservation = state.reservations.find(
      (item) => item.id === id
    );

    if (!reservation) return;

    const balance = reservation.total - reservation.paid;

    const details = [
      `Reference: ${reservation.id}`,
      `Guest: ${reservation.name}`,
      `Email: ${reservation.email || "Not provided"}`,
      `Phone: ${reservation.phone}`,
      `Check-in: ${formatDate(reservation.checkin)}`,
      `Check-out: ${formatDate(reservation.checkout)}`,
      `Nights: ${reservation.nights}`,
      `Guests: ${reservation.guests}`,
      `Total: ${money(reservation.total)}`,
      `Paid (unverified demo entry): ${money(reservation.paid)}`,
      `Balance: ${money(balance)}`,
      `Status: ${reservation.status}`,
      `Notes: ${reservation.notes || "None"}`,
      "",
      "DEMO RECORD ONLY — not saved to Firestore."
    ].join("\n");

    if (reservation.status === "cancelled") {
      window.alert(details);
      return;
    }

    const shouldCancel = window.confirm(
      details +
      "\n\nPress OK to cancel this demo reservation, or Cancel to close."
    );

    if (!shouldCancel) return;

    reservation.status = "cancelled";

    renderReservations();
    renderCalendar();

    showToast("Demo reservation cancelled.");
  }

  /* =====================================
     ADMIN CALENDAR
  ===================================== */

  function renderCalendar() {
    const container = $("#adminCalendarDays");
    const month = state.calendarMonth;

    container.innerHTML = "";

    $("#calendarMonthLabel").textContent =
      month.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
      });

    const year = month.getFullYear();
    const monthIndex = month.getMonth();

    const first = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(
      year,
      monthIndex + 1,
      0
    ).getDate();

    const offset = (first.getDay() + 6) % 7;

    for (let i = 0; i < offset; i++) {
      const empty = document.createElement("span");
      empty.className = "calendar-day-empty";
      empty.setAttribute("aria-hidden", "true");
      container.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, monthIndex, day);
      const key = dateKey(date);

      const button = document.createElement("button");

      button.type = "button";
      button.className = "calendar-day";
      button.textContent = day;

      const isPast = key < dateKey(today);
      const blocked = state.manualBlocks.has(key);
      const reserved = isDemoReserved(key);

      const selected =
        key === state.selectedStart ||
        key === state.selectedEnd;

      if (isPast) {
        button.classList.add("is-past");
      }

      if (blocked) {
        button.classList.add("is-blocked");
      }

      if (reserved) {
        button.classList.add("is-reserved");
      }

      if (selected) {
        button.classList.add("is-selected");
      }

      if (key === dateKey(today)) {
        button.classList.add("is-today");
      }

      button.setAttribute(
        "aria-label",
        `${formatDate(key)}, ` +
        (reserved
          ? "confirmed demo reservation"
          : blocked
            ? "manually blocked"
            : "not manually blocked")
      );

      button.addEventListener("click", () => {
        selectCalendarDate(key);
      });

      container.appendChild(button);
    }

    $("#manualBlockCount").textContent =
      String(state.manualBlocks.size);
  }

  /* =====================================
     CALENDAR DATE SELECTION

     First click = start.
     Second click = end.

     After two dates are selected,
     the next click starts a new range.
  ===================================== */

  function selectCalendarDate(key) {
    setFeedback("#calendarFeedback", "");

    if (
      !state.selectedStart ||
      state.selectedEnd ||
      key <= state.selectedStart
    ) {
      state.selectedStart = key;
      state.selectedEnd = null;

      $("#blockStart").value = key;
      $("#blockEnd").value = "";
    } else {
      state.selectedEnd = key;
      $("#blockEnd").value = key;
    }

    renderCalendar();
  }

  $("#calendarPrev").addEventListener("click", () => {
    state.calendarMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() - 1,
      1
    );

    renderCalendar();
  });

  $("#calendarNext").addEventListener("click", () => {
    state.calendarMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() + 1,
      1
    );

    renderCalendar();
  });

  $("#calendarToday").addEventListener("click", () => {
    state.calendarMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    renderCalendar();
  });

  $("#clearSelectionBtn").addEventListener("click", () => {
    clearCalendarSelection();
    renderCalendar();
  });

  function clearCalendarSelection() {
    state.selectedStart = null;
    state.selectedEnd = null;

    $("#blockStart").value = "";
    $("#blockEnd").value = "";

    setFeedback("#calendarFeedback", "");
  }

  $("#blockStart").addEventListener("change", () => {
    state.selectedStart = $("#blockStart").value || null;
    renderCalendar();
  });

  $("#blockEnd").addEventListener("change", () => {
    state.selectedEnd = $("#blockEnd").value || null;
    renderCalendar();
  });

  /* =====================================
     BLOCK / UNBLOCK DATE RANGES
  ===================================== */

  function getBlockRange() {
    const start = $("#blockStart").value;
    const end = $("#blockEnd").value;

    if (!parseDate(start) || !parseDate(end)) {
      setFeedback(
        "#calendarFeedback",
        "Select a valid start and end date.",
        true
      );
      return null;
    }

    if (start >= end) {
      setFeedback(
        "#calendarFeedback",
        "End date must be after the start date.",
        true
      );
      return null;
    }

    if (start < dateKey(today)) {
      setFeedback(
        "#calendarFeedback",
        "Past dates cannot be modified.",
        true
      );
      return null;
    }

    return { start, end };
  }

  $("#blockDatesBtn").addEventListener("click", () => {
    setFeedback("#calendarFeedback", "");

    const range = getBlockRange();
    if (!range) return;

    if (hasConfirmedConflict(range.start, range.end)) {
      setFeedback(
        "#calendarFeedback",
        "This range overlaps a confirmed demo reservation.",
        true
      );
      return;
    }

    const dates = datesBetween(range.start, range.end);
    const reason = $("#blockReason").value;

    dates.forEach((key) => {
      state.manualBlocks.set(key, reason);
    });

    setFeedback(
      "#calendarFeedback",
      `${dates.length} night(s) blocked in this preview.`
    );

    renderCalendar();
    showToast("Demo availability updated.");
  });

  $("#unblockDatesBtn").addEventListener("click", () => {
    setFeedback("#calendarFeedback", "");

    const range = getBlockRange();
    if (!range) return;

    const dates = datesBetween(range.start, range.end);

    let removed = 0;

    dates.forEach((key) => {
      if (state.manualBlocks.delete(key)) {
        removed++;
      }
    });

    setFeedback(
      "#calendarFeedback",
      `${removed} manual block(s) removed from this preview.`
    );

    renderCalendar();
    showToast("Demo manual blocks updated.");
  });

  /* =====================================
     PRICING CONFIGURATION

     This updates the preview only.
     No public website synchronization yet.
  ===================================== */

  function renderPricing() {
    $("#nightlyRate").value = state.pricing.nightlyRate;
    $("#minimumNights").value = state.pricing.minimumNights;
    $("#maximumGuests").value = state.pricing.maximumGuests;

    $("#pricePreview").innerHTML = "";

    const amount = document.createTextNode(
      money(state.pricing.nightlyRate) + " "
    );

    const suffix = document.createElement("span");
    suffix.textContent = "/ night";

    $("#pricePreview").append(amount, suffix);

    $("#minimumPreview").textContent =
      `${state.pricing.minimumNights} nights`;

    $("#guestsPreview").textContent =
      `${state.pricing.maximumGuests} guests`;
  }

  $("#pricingForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const rate = Number($("#nightlyRate").value);
    const nights = Number($("#minimumNights").value);
    const guests = Number($("#maximumGuests").value);

    if (
      !Number.isInteger(rate) ||
      rate < 1 ||
      !Number.isInteger(nights) ||
      nights < 1 ||
      nights > 365 ||
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > 100
    ) {
      setFeedback(
        "#pricingFeedback",
        "Please enter valid pricing and capacity values.",
        true
      );
      return;
    }

    state.pricing = {
      nightlyRate: rate,
      minimumNights: nights,
      maximumGuests: guests
    };

    renderPricing();

    setFeedback(
      "#pricingFeedback",
      "Preview settings updated for this session only."
    );

    showToast("Demo pricing updated.");
  });

  /* =====================================
     PROPERTY SETTINGS

     Preview only. No database writes.
  ===================================== */

  $("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const form = $("#settingsForm");

    if (!form.reportValidity()) return;

    const name = $("#propertyName").value.trim();
    const location = $("#propertyLocation").value.trim();

    if (!name || !location) {
      setFeedback(
        "#settingsFeedback",
        "Property name and location are required.",
        true
      );
      return;
    }

    state.settings = {
      name,
      location,
      email: $("#propertyEmail").value.trim(),
      phone: $("#propertyPhone").value.trim(),
      checkin: $("#propertyCheckin").value,
      checkout: $("#propertyCheckout").value
    };

    setFeedback(
      "#settingsFeedback",
      "Property details updated in this preview session only."
    );

    showToast("Demo property settings updated.");
  });

  /* =====================================
     INITIALIZATION
  ===================================== */

  function initialize() {
    initializeDates();
    renderPricing();
    renderReservations();
    renderCalendar();
    navigateTo("overview");
  }

  initialize();

});
