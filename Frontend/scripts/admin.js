
/* =========================================
   HIPPO HOUSE MALINDI
   ADMIN DASHBOARD — FIREBASE VERSION

   Collections:
   settings/pricing
   settings/property
   blockedDates/{YYYY-MM-DD}
   reservations/{reservationId}
   payments (reserved for future integration)

   No login or Firebase Authentication.
========================================= */

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCygmzASKNJlctxV6ajGTyfd8aVnSTopSo",
  authDomain: "hippohouse-f1bd5.firebaseapp.com",
  projectId: "hippohouse-f1bd5",
  storageBucket: "hippohouse-f1bd5.firebasestorage.app",
  messagingSenderId: "738896662521",
  appId: "1:738896662521:web:33c17b4d54fba626f73728"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* =====================================
     HELPERS AND STATE
  ===================================== */

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const PRICING_STORAGE_KEY = "hippoHousePricingV1";

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
      rates: {
        low: 24000,
        mid: 27500,
        high: 30000,
        peak: 40000,
        fallback: 0
      },
      includedGuests: 8,
      maximumGuests: 12,
      extraGuestRate: 1500,
      minimumNights: 2,
      peakMinimumNights: 7,
      easterStart: "",
      easterEnd: "",
      peakStart: "",
      peakEnd: ""
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

  let firestoreReady = false;
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

  function firebaseError(error) {
    console.error("Firebase error:", error);
    return error?.message || String(error);
  }

  function requireFirestore() {
    if (!firestoreReady) {
      throw new Error(
        "Firestore is not connected. Refresh and check the browser console."
      );
    }
  }

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

    // Checkout/end date is exclusive.
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
    if (!toast) return;

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
     FIRESTORE LOADING
  ===================================== */

  async function loadFirestoreData() {
    const [
      pricingSnapshot,
      propertySnapshot,
      blocksSnapshot,
      reservationsSnapshot
    ] = await Promise.all([
      getDoc(doc(db, "settings", "pricing")),
      getDoc(doc(db, "settings", "property")),
      getDocs(collection(db, "blockedDates")),
      getDocs(collection(db, "reservations"))
    ]);

    if (pricingSnapshot.exists()) {
      const saved = pricingSnapshot.data();

      state.pricing = {
        ...state.pricing,
        ...saved,
        rates: {
          ...state.pricing.rates,
          ...(saved.rates || {})
        }
      };
    } else {
      // Preserve previously saved browser pricing
      // until the owner explicitly clicks Save.
      loadSavedPricing();
    }

    if (propertySnapshot.exists()) {
      state.settings = {
        ...state.settings,
        ...propertySnapshot.data()
      };
    }

    state.manualBlocks = new Map(
      blocksSnapshot.docs.map(snapshot => [
        snapshot.id,
        snapshot.data().reason || "Blocked"
      ])
    );

    state.reservations = reservationsSnapshot.docs.map(
      snapshot => ({
        ...snapshot.data(),
        id: snapshot.id
      })
    );

    firestoreReady = true;

    renderPricing();
    renderPropertySettings();
    renderReservations();
    renderCalendar();

    const connection = $(".connection-card");

    if (connection) {
      const heading = connection.querySelector("strong");
      const description = connection.querySelector("small");

      if (heading) heading.textContent = "Firebase connected";
      if (description) {
        description.textContent = "Firestore database online";
      }
    }

    console.log(
      "Hippo House Firestore connected:",
      firebaseConfig.projectId
    );
  }

  /* =====================================
     SEASONAL PRICING CALCULATIONS
  ===================================== */

  function isWithinRange(date, start, end) {
    return Boolean(
      start &&
      end &&
      date >= start &&
      date <= end
    );
  }

  function getSeasonForDate(key) {
    const p = state.pricing;
    const date = parseDate(key);

    if (!date) return null;

    const month = date.getMonth() + 1;
    const day = date.getDate();

    if (isWithinRange(key, p.peakStart, p.peakEnd)) {
      return "peak";
    }

    if (isWithinRange(key, p.easterStart, p.easterEnd)) {
      return "high";
    }

    if (month === 8 || (month === 12 && day <= 19)) {
      return "high";
    }

    if (month === 4 || month === 11) {
      return "mid";
    }

    if ([5, 6, 9].includes(month)) {
      return "low";
    }

    return "fallback";
  }

  function calculateBookingPrice(checkin, checkout, guests) {
    const p = state.pricing;
    const dates = datesBetween(checkin, checkout);

    if (!dates.length) {
      return {
        valid: false,
        error: "Select valid booking dates."
      };
    }

    if (
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > p.maximumGuests
    ) {
      return {
        valid: false,
        error: "Invalid number of guests."
      };
    }

    const seasons = new Set();
    let accommodationTotal = 0;

    for (const key of dates) {
      const season = getSeasonForDate(key);
      const rate = p.rates[season];

      if (!Number.isFinite(rate) || rate <= 0) {
        return {
          valid: false,
          error: `No confirmed nightly rate for ${formatDate(key)}.`
        };
      }

      seasons.add(season);
      accommodationTotal += rate;
    }

    const minimumNights = seasons.has("peak")
      ? p.peakMinimumNights
      : p.minimumNights;

    if (dates.length < minimumNights) {
      return {
        valid: false,
        error: `This stay requires at least ${minimumNights} nights.`
      };
    }

    const extraGuests = Math.max(
      0,
      guests - p.includedGuests
    );

    const extraGuestTotal =
      extraGuests * p.extraGuestRate * dates.length;

    return {
      valid: true,
      nights: dates.length,
      extraGuests,
      accommodationTotal,
      extraGuestTotal,
      total: accommodationTotal + extraGuestTotal,
      seasons: [...seasons]
    };
  }

  /* =====================================
     NAVIGATION
  ===================================== */

  function closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebarOverlay")?.classList.remove("show");
  }

  function openSidebar() {
    $("#sidebar")?.classList.add("open");
    $("#sidebarOverlay")?.classList.add("show");
  }

  function navigateTo(page) {
    if (!pageTitles[page]) return;

    state.page = page;

    $$(".page-section").forEach(section => {
      const active = section.id === `page-${page}`;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });

    $$(".nav-item").forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);

      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    const breadcrumb = $("#breadcrumbCurrent");
    if (breadcrumb) breadcrumb.textContent = pageTitles[page];

    closeSidebar();

    if (page === "availability") renderCalendar();
    if (page === "reservations") renderReservations();

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  $$(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.page);
    });
  });

  $$("[data-page-target]").forEach(button => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.pageTarget);
    });
  });

  $("#openSidebar")?.addEventListener("click", openSidebar);
  $("#closeSidebar")?.addEventListener("click", closeSidebar);
  $("#sidebarOverlay")?.addEventListener("click", closeSidebar);

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    if (!$("#reservationModal")?.hidden) {
      closeReservationModal();
    } else {
      closeSidebar();
    }
  });

  function initializeDates() {
    const formatted = today.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    if ($("#topbarDate")) {
      $("#topbarDate").textContent = formatted;
    }

    if ($("#activityDate")) {
      $("#activityDate").textContent = formatted;
    }
  }

  /* =====================================
     RESERVATION MODAL
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

  $$('[data-action="new-reservation"]').forEach(button => {
    button.addEventListener("click", () => {
      navigateTo("reservations");
      openReservationModal();
    });
  });

  $("#addReservationBtn")?.addEventListener(
    "click",
    openReservationModal
  );

  $("#closeReservationModal")?.addEventListener(
    "click",
    closeReservationModal
  );

  $("#cancelReservation")?.addEventListener(
    "click",
    closeReservationModal
  );

  $("#reservationModal")?.addEventListener("click", event => {
    if (event.target === $("#reservationModal")) {
      closeReservationModal();
    }
  });

  $("#reservationModal")?.addEventListener("keydown", event => {
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
    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  });

  function updateReservationEstimate() {
    const checkin = $("#reservationCheckin").value;
    const checkout = $("#reservationCheckout").value;
    const guests = Number($("#reservationGuests").value);

    const result = calculateBookingPrice(
      checkin,
      checkout,
      guests
    );

    if (!result.valid) {
      $("#bookingCalculation").textContent = result.error;
      $("#reservationTotal").value = "";
      return;
    }

    $("#reservationTotal").value = result.total;

    $("#bookingCalculation").textContent =
      `${result.nights} night(s) | ` +
      `Accommodation: ${money(result.accommodationTotal)} | ` +
      `Extra guests: ${money(result.extraGuestTotal)} | ` +
      `Total: ${money(result.total)}`;
  }

  $("#reservationCheckin")?.addEventListener("change", () => {
    $("#reservationCheckout").min =
      $("#reservationCheckin").value || dateKey(today);

    updateReservationEstimate();
  });

  $("#reservationCheckout")?.addEventListener(
    "change",
    updateReservationEstimate
  );

  $("#reservationGuests")?.addEventListener(
    "input",
    updateReservationEstimate
  );

  /* =====================================
     RESERVATION AVAILABILITY
  ===================================== */

  function hasConfirmedConflict(start, end, ignoreId = null) {
    return state.reservations.some(reservation => {
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
    return datesBetween(start, end).some(key =>
      state.manualBlocks.has(key)
    );
  }

  function isReserved(key) {
    return state.reservations.some(reservation =>
      reservation.status === "confirmed" &&
      key >= reservation.checkin &&
      key < reservation.checkout
    );
  }

  /* =====================================
     CREATE RESERVATION — FIRESTORE
  ===================================== */

  $("#reservationForm")?.addEventListener(
    "submit",
    async event => {
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

      const priceResult = calculateBookingPrice(
        checkin,
        checkout,
        guests
      );

      if (!priceResult.valid) {
        setFeedback(
          "#reservationFeedback",
          priceResult.error,
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
          "The amount paid cannot exceed the total.",
          true
        );
        return;
      }

      if (status === "confirmed") {
        if (hasConfirmedConflict(checkin, checkout)) {
          setFeedback(
            "#reservationFeedback",
            "These dates overlap an existing confirmed reservation.",
            true
          );
          return;
        }

        if (hasManualBlockConflict(checkin, checkout)) {
          setFeedback(
            "#reservationFeedback",
            "These dates include manually blocked nights.",
            true
          );
          return;
        }
      }

      const reservationRef = doc(collection(db, "reservations"));

      const reservation = {
        name: $("#guestName").value.trim(),
        email: $("#guestEmail").value.trim(),
        phone: $("#guestPhone").value.trim(),
        checkin,
        checkout,
        nights: priceResult.nights,
        guests,
        total,
        paid,
        status,
        notes: $("#reservationNotes").value.trim(),
        source: "manual_admin",
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

      try {
        requireFirestore();

        // Refresh shared availability before checking.
        const [latestReservations, latestBlocks] =
          await Promise.all([
            getDocs(collection(db, "reservations")),
            getDocs(collection(db, "blockedDates"))
          ]);

        state.reservations = latestReservations.docs.map(
          snapshot => ({
            ...snapshot.data(),
            id: snapshot.id
          })
        );

        state.manualBlocks = new Map(
          latestBlocks.docs.map(snapshot => [
            snapshot.id,
            snapshot.data().reason || "Blocked"
          ])
        );

        if (
          status === "confirmed" &&
          (
            hasConfirmedConflict(checkin, checkout) ||
            hasManualBlockConflict(checkin, checkout)
          )
        ) {
          setFeedback(
            "#reservationFeedback",
            "These dates are no longer available.",
            true
          );

          renderCalendar();
          return;
        }

        await setDoc(reservationRef, {
          ...reservation,
          createdAtServer: serverTimestamp()
        });

        state.reservations.push({
          ...reservation,
          id: reservationRef.id
        });

        closeReservationModal();
        renderReservations();
        renderCalendar();

        showToast("Reservation saved to Firestore.");

      } catch (error) {
        setFeedback(
          "#reservationFeedback",
          "Unable to save reservation: " + firebaseError(error),
          true
        );
      }
    }
  );

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

    if (!tbody || !empty) return;

    tbody.innerHTML = "";

    const search = ($("#reservationSearch")?.value || "")
      .trim()
      .toLowerCase();

    const filter = $("#reservationFilter")?.value || "all";

    const results = state.reservations.filter(reservation => {
      const matchesSearch = [
        reservation.name,
        reservation.email,
        reservation.phone,
        reservation.id
      ].some(value =>
        String(value || "").toLowerCase().includes(search)
      );

      const matchesStatus =
        filter === "all" || reservation.status === filter;

      return matchesSearch && matchesStatus;
    });

    const count = $("#reservationCount");
    if (count) {
      count.textContent =
        `${state.reservations.length} record` +
        (state.reservations.length === 1 ? "" : "s");
    }

    empty.hidden = results.length > 0;

    if (!results.length) {
      empty.querySelector("h3").textContent =
        state.reservations.length
          ? "No matching reservations"
          : "No reservations";

      empty.querySelector("p").textContent =
        state.reservations.length
          ? "Try changing your search or status filter."
          : "Use Add Reservation to create a booking.";

      return;
    }

    results.forEach(reservation => {
      const row = document.createElement("tr");

      const guestCell = document.createElement("td");
      const guestName = document.createElement("strong");
      const guestRef = document.createElement("small");

      guestName.textContent = reservation.name || "Guest";
      guestRef.textContent = reservation.id;

      guestCell.append(guestName, guestRef);
      row.appendChild(guestCell);

      const datesCell = document.createElement("td");

      datesCell.textContent =
        `${formatDate(reservation.checkin, false)} – ` +
        `${formatDate(reservation.checkout, false)}`;

      row.appendChild(datesCell);

      createCell(row, String(reservation.guests || 0));
      createCell(row, money(reservation.total || 0));

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");

      const status = reservation.status || "pending";

      badge.className = `status-badge status-${status}`;
      badge.textContent =
        status.charAt(0).toUpperCase() + status.slice(1);

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

  $("#reservationSearch")?.addEventListener(
    "input",
    renderReservations
  );

  $("#reservationFilter")?.addEventListener(
    "change",
    renderReservations
  );

  /* =====================================
     VIEW / CANCEL RESERVATION
  ===================================== */

  async function viewReservation(id) {
    const reservation = state.reservations.find(
      item => item.id === id
    );

    if (!reservation) return;

    const balance =
      (reservation.total || 0) - (reservation.paid || 0);

    const details = [
      `Reference: ${reservation.id}`,
      `Guest: ${reservation.name}`,
      `Email: ${reservation.email || "Not provided"}`,
      `Phone: ${reservation.phone}`,
      `Check-in: ${formatDate(reservation.checkin)}`,
      `Check-out: ${formatDate(reservation.checkout)}`,
      `Nights: ${reservation.nights}`,
      `Guests: ${reservation.guests}`,
      `Total: ${money(reservation.total || 0)}`,
      `Paid (manual entry, not payment-verified): ${money(reservation.paid || 0)}`,
      `Balance: ${money(balance)}`,
      `Status: ${reservation.status}`,
      `Notes: ${reservation.notes || "None"}`,
      "",
      "Stored in Firebase Firestore."
    ].join("\n");

    if (reservation.status === "cancelled") {
      window.alert(details);
      return;
    }

    const shouldCancel = window.confirm(
      details +
      "\n\nPress OK to cancel this reservation, or Cancel to close."
    );

    if (!shouldCancel) return;

    try {
      requireFirestore();

      await updateDoc(
        doc(db, "reservations", reservation.id),
        {
          status: "cancelled",
          cancelledAt: serverTimestamp()
        }
      );

      reservation.status = "cancelled";

      renderReservations();
      renderCalendar();

      showToast("Reservation cancelled in Firestore.");

    } catch (error) {
      window.alert(
        "Unable to cancel reservation: " + firebaseError(error)
      );
    }
  }

  /* =====================================
     ADMIN CALENDAR
  ===================================== */

  function renderCalendar() {
    const container = $("#adminCalendarDays");
    if (!container) return;

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
      const reserved = isReserved(key);

      const selected =
        key === state.selectedStart ||
        key === state.selectedEnd;

      if (isPast) button.classList.add("is-past");
      if (blocked) button.classList.add("is-blocked");
      if (reserved) button.classList.add("is-reserved");
      if (selected) button.classList.add("is-selected");

      if (key === dateKey(today)) {
        button.classList.add("is-today");
      }

      button.setAttribute(
        "aria-label",
        `${formatDate(key)}, ` +
        (reserved
          ? "confirmed reservation"
          : blocked
            ? "manually blocked"
            : "not manually blocked")
      );

      button.addEventListener("click", () => {
        selectCalendarDate(key);
      });

      container.appendChild(button);
    }

    const count = $("#manualBlockCount");
    if (count) count.textContent = String(state.manualBlocks.size);
  }

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

  $("#calendarPrev")?.addEventListener("click", () => {
    state.calendarMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() - 1,
      1
    );

    renderCalendar();
  });

  $("#calendarNext")?.addEventListener("click", () => {
    state.calendarMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() + 1,
      1
    );

    renderCalendar();
  });

  $("#calendarToday")?.addEventListener("click", () => {
    state.calendarMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    renderCalendar();
  });

  function clearCalendarSelection() {
    state.selectedStart = null;
    state.selectedEnd = null;

    $("#blockStart").value = "";
    $("#blockEnd").value = "";

    setFeedback("#calendarFeedback", "");
  }

  $("#clearSelectionBtn")?.addEventListener("click", () => {
    clearCalendarSelection();
    renderCalendar();
  });

  $("#blockStart")?.addEventListener("change", () => {
    state.selectedStart = $("#blockStart").value || null;
    renderCalendar();
  });

  $("#blockEnd")?.addEventListener("change", () => {
    state.selectedEnd = $("#blockEnd").value || null;
    renderCalendar();
  });

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

  /* =====================================
     BLOCK DATES — FIRESTORE
  ===================================== */

  $("#blockDatesBtn")?.addEventListener("click", async () => {
    setFeedback("#calendarFeedback", "");

    const range = getBlockRange();
    if (!range) return;

    const dates = datesBetween(range.start, range.end);
    const reason = $("#blockReason").value;

    try {
      requireFirestore();

      const latestReservations =
        await getDocs(collection(db, "reservations"));

      state.reservations = latestReservations.docs.map(
        snapshot => ({
          ...snapshot.data(),
          id: snapshot.id
        })
      );

      if (hasConfirmedConflict(range.start, range.end)) {
        setFeedback(
          "#calendarFeedback",
          "This range overlaps a confirmed reservation.",
          true
        );
        renderCalendar();
        return;
      }

      // Firestore batches are limited to 500 writes.
      // Use smaller chunks for longer date ranges.
      for (let i = 0; i < dates.length; i += 400) {
        const batch = writeBatch(db);

        dates.slice(i, i + 400).forEach(key => {
          batch.set(
            doc(db, "blockedDates", key),
            {
              date: key,
              reason,
              updatedAt: serverTimestamp()
            }
          );
        });

        await batch.commit();
      }

      dates.forEach(key => {
        state.manualBlocks.set(key, reason);
      });

      renderCalendar();

      setFeedback(
        "#calendarFeedback",
        `${dates.length} night(s) blocked in Firestore.`
      );

      showToast("Blocked dates saved to Firestore.");

    } catch (error) {
      setFeedback(
        "#calendarFeedback",
        "Unable to block dates: " + firebaseError(error),
        true
      );

      // Reload to reflect any successfully committed batches.
      try {
        await loadFirestoreData();
      } catch (reloadError) {
        console.error(reloadError);
      }
    }
  });

  /* =====================================
     REMOVE BLOCKS — FIRESTORE
  ===================================== */

  $("#unblockDatesBtn")?.addEventListener("click", async () => {
    setFeedback("#calendarFeedback", "");

    const range = getBlockRange();
    if (!range) return;

    const dates = datesBetween(range.start, range.end);

    try {
      requireFirestore();

      for (let i = 0; i < dates.length; i += 400) {
        const batch = writeBatch(db);

        dates.slice(i, i + 400).forEach(key => {
          batch.delete(doc(db, "blockedDates", key));
        });

        await batch.commit();
      }

      let removed = 0;

      dates.forEach(key => {
        if (state.manualBlocks.delete(key)) {
          removed++;
        }
      });

      renderCalendar();

      setFeedback(
        "#calendarFeedback",
        `${removed} manual block(s) removed from Firestore.`
      );

      showToast("Manual blocks removed from Firestore.");

    } catch (error) {
      setFeedback(
        "#calendarFeedback",
        "Unable to remove blocks: " + firebaseError(error),
        true
      );

      try {
        await loadFirestoreData();
      } catch (reloadError) {
        console.error(reloadError);
      }
    }
  });

  /* =====================================
     PRICING — LOCAL BACKUP
  ===================================== */

  function loadSavedPricing() {
    try {
      const saved = localStorage.getItem(PRICING_STORAGE_KEY);
      if (!saved) return;

      const parsed = JSON.parse(saved);

      if (
        !parsed ||
        typeof parsed !== "object" ||
        !parsed.rates
      ) {
        return;
      }

      state.pricing = {
        ...state.pricing,
        ...parsed,
        rates: {
          ...state.pricing.rates,
          ...parsed.rates
        }
      };

    } catch (error) {
      console.warn("Could not load saved pricing:", error);
    }
  }

  function renderPricing() {
    const p = state.pricing;

    $("#rateLow").value = p.rates.low;
    $("#rateMid").value = p.rates.mid;
    $("#rateHigh").value = p.rates.high;
    $("#ratePeak").value = p.rates.peak;
    $("#fallbackRate").value = p.rates.fallback;

    $("#includedGuests").value = p.includedGuests;
    $("#maximumGuests").value = p.maximumGuests;
    $("#extraGuestRate").value = p.extraGuestRate;

    $("#minimumNights").value = p.minimumNights;
    $("#peakMinimumNights").value = p.peakMinimumNights;

    $("#easterStart").value = p.easterStart || "";
    $("#easterEnd").value = p.easterEnd || "";
    $("#peakStart").value = p.peakStart || "";
    $("#peakEnd").value = p.peakEnd || "";

    $("#pricePreview").textContent =
      `${money(p.rates.low)} – ${money(p.rates.peak)} / night`;

    $("#previewLow").textContent = money(p.rates.low);
    $("#previewMid").textContent = money(p.rates.mid);
    $("#previewHigh").textContent = money(p.rates.high);
    $("#previewPeak").textContent = money(p.rates.peak);

    $("#includedPreview").textContent =
      `${p.includedGuests} guests`;

    $("#guestsPreview").textContent =
      `${p.maximumGuests} guests`;

    $("#extraGuestPreview").textContent =
      money(p.extraGuestRate);

    $("#minimumPreview").textContent =
      `${p.minimumNights} nights`;

    $("#peakMinimumPreview").textContent =
      `${p.peakMinimumNights} nights`;
  }

  /* =====================================
     SAVE PRICING — FIRESTORE
  ===================================== */

  $("#pricingForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const form = $("#pricingForm");
    if (!form.reportValidity()) return;

    const next = {
      rates: {
        low: Number($("#rateLow").value),
        mid: Number($("#rateMid").value),
        high: Number($("#rateHigh").value),
        peak: Number($("#ratePeak").value),
        fallback: Number($("#fallbackRate").value)
      },

      includedGuests: Number($("#includedGuests").value),
      maximumGuests: Number($("#maximumGuests").value),
      extraGuestRate: Number($("#extraGuestRate").value),

      minimumNights: Number($("#minimumNights").value),
      peakMinimumNights: Number($("#peakMinimumNights").value),

      easterStart: $("#easterStart").value,
      easterEnd: $("#easterEnd").value,
      peakStart: $("#peakStart").value,
      peakEnd: $("#peakEnd").value
    };

    const numbers = [
      ...Object.values(next.rates),
      next.includedGuests,
      next.maximumGuests,
      next.extraGuestRate,
      next.minimumNights,
      next.peakMinimumNights
    ];

    if (
      !numbers.every(Number.isSafeInteger) ||
      next.rates.low <= 0 ||
      next.rates.mid <= 0 ||
      next.rates.high <= 0 ||
      next.rates.peak <= 0 ||
      next.rates.fallback < 0 ||
      next.extraGuestRate < 0 ||
      next.includedGuests < 1 ||
      next.maximumGuests < next.includedGuests ||
      next.minimumNights < 1 ||
      next.minimumNights > 365 ||
      next.peakMinimumNights < 1 ||
      next.peakMinimumNights > 365
    ) {
      setFeedback(
        "#pricingFeedback",
        "Please check the rates, guest capacity and minimum stays.",
        true
      );
      return;
    }

    for (const [start, end, label] of [
      [next.easterStart, next.easterEnd, "Easter"],
      [next.peakStart, next.peakEnd, "Peak season"]
    ]) {
      if (
        (start && !end) ||
        (!start && end) ||
        (start && end && start > end)
      ) {
        setFeedback(
          "#pricingFeedback",
          `Enter a valid start and end date for ${label}.`,
          true
        );
        return;
      }
    }

    try {
      requireFirestore();

      await setDoc(
        doc(db, "settings", "pricing"),
        {
          ...next,
          updatedAt: serverTimestamp()
        }
      );

      state.pricing = next;

      // Local backup only; Firestore is authoritative.
      try {
        localStorage.setItem(
          PRICING_STORAGE_KEY,
          JSON.stringify(next)
        );
      } catch (storageError) {
        console.warn("Local backup unavailable:", storageError);
      }

      renderPricing();

      setFeedback(
        "#pricingFeedback",
        "Pricing saved successfully to Firebase Firestore."
      );

      showToast("Pricing saved to Firestore.");

    } catch (error) {
      setFeedback(
        "#pricingFeedback",
        "Unable to save pricing: " + firebaseError(error),
        true
      );
    }
  });

  /* =====================================
     PROPERTY SETTINGS
  ===================================== */

  function renderPropertySettings() {
    const settings = state.settings;

    $("#propertyName").value = settings.name || "";
    $("#propertyLocation").value = settings.location || "";
    $("#propertyEmail").value = settings.email || "";
    $("#propertyPhone").value = settings.phone || "";
    $("#propertyCheckin").value = settings.checkin || "14:00";
    $("#propertyCheckout").value = settings.checkout || "11:00";
  }

  /* =====================================
     SAVE SETTINGS — FIRESTORE
  ===================================== */

  $("#settingsForm")?.addEventListener("submit", async event => {
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

    const nextSettings = {
      name,
      location,
      email: $("#propertyEmail").value.trim(),
      phone: $("#propertyPhone").value.trim(),
      checkin: $("#propertyCheckin").value,
      checkout: $("#propertyCheckout").value
    };

    try {
      requireFirestore();

      await setDoc(
        doc(db, "settings", "property"),
        {
          ...nextSettings,
          updatedAt: serverTimestamp()
        }
      );

      state.settings = nextSettings;

      setFeedback(
        "#settingsFeedback",
        "Property settings saved successfully to Firebase Firestore."
      );

      showToast("Property settings saved to Firestore.");

    } catch (error) {
      setFeedback(
        "#settingsFeedback",
        "Unable to save settings: " + firebaseError(error),
        true
      );
    }
  });

  /* =====================================
     INITIALIZATION
  ===================================== */

  async function initialize() {
    initializeDates();

    // Display defaults while Firestore loads.
    // Saving is disabled until connection succeeds.
    loadSavedPricing();

    renderPricing();
    renderPropertySettings();
    renderReservations();
    renderCalendar();

    navigateTo("overview");

    try {
      await loadFirestoreData();

      showToast("Firebase Firestore connected.");

    } catch (error) {
      firestoreReady = false;

      console.error(
        "Unable to connect to Hippo House Firestore:",
        error
      );

      const connection = $(".connection-card");

      if (connection) {
        const heading = connection.querySelector("strong");
        const description = connection.querySelector("small");

        if (heading) heading.textContent = "Firebase disconnected";

        if (description) {
          description.textContent =
            "Database unavailable — changes cannot be saved";
        }
      }

      showToast(
        "Firestore connection failed. Check the console."
      );
    }
  }

  initialize();
});
