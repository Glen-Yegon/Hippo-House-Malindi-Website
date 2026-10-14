
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

/* =========================================
   HIPPO HOUSE MALINDI — BOOKING PAGE
========================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCygmzASKNJlctxV6ajGTyfd8aVnSTopSo",
  authDomain: "hippohouse-f1bd5.firebaseapp.com",
  projectId: "hippohouse-f1bd5",
  storageBucket: "hippohouse-f1bd5.firebasestorage.app",
  messagingSenderId: "738896662521",
  appId: "1:738896662521:web:33c17b4d54fba626f73728"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/*
  Keep this mapping identical to the homepage.

  January, February, March, July and October
  are provisionally assigned to mid season.
*/
const MONTH_SEASONS = {
  1: "mid",
  2: "mid",
  3: "mid",
  4: "mid",
  5: "low",
  6: "low",
  7: "mid",
  8: "high",
  9: "low",
  10: "mid",
  11: "mid",
  12: "high"
};

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const $ = selector => document.querySelector(selector);

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let displayedMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  let pricing = null;
  let bookedDates = new Set();
  let dataReady = false;

  const booking = {
    checkin: null,
    checkout: null,
    guests: 2,
    fullName: "",
    email: "",
    phone: "",
    specialRequests: ""
  };

  /* =========================================
     DATE UTILITIES
  ========================================= */

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
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

    return dateKey(date) === key ? date : null;
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

    return Math.round((
      Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
    ) / 86400000);
  }

  function eachNight(start, end, callback) {
    const cursor = parseDate(start);
    const last = parseDate(end);

    if (!cursor || !last || cursor >= last) return;

    while (cursor < last) {
      callback(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  function inRange(key, start, end) {
    return Boolean(
      parseDate(start) &&
      parseDate(end) &&
      key >= start &&
      key <= end
    );
  }

  function money(amount) {
    return "KSh " + Number(amount).toLocaleString("en-KE", {
      maximumFractionDigits: 0
    });
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function showMessage(element, message) {
    if (element) element.textContent = message;
  }

  function clearMessages() {
    [
      elements.stayMessage,
      elements.detailsMessage,
      elements.submitMessage
    ].forEach(element => {
      if (element) element.textContent = "";
    });
  }

  /* =========================================
     FIRESTORE
  ========================================= */

  function normalizePricing(data) {
    if (!data?.rates) {
      throw new Error("Pricing rates are missing.");
    }

    const rates = {};

    for (const season of ["low", "mid", "high", "peak"]) {
      rates[season] = Number(data.rates[season]);

      if (
        !Number.isFinite(rates[season]) ||
        rates[season] <= 0
      ) {
        throw new Error(`Invalid ${season} season rate.`);
      }
    }

    const result = {
      ...data,
      rates,
      includedGuests: Number(data.includedGuests),
      maximumGuests: Number(data.maximumGuests),
      extraGuestRate: Number(data.extraGuestRate),
      minimumNights: Number(data.minimumNights),
      peakMinimumNights: Number(data.peakMinimumNights)
    };

    if (
      !Number.isInteger(result.includedGuests) ||
      result.includedGuests < 1 ||
      !Number.isInteger(result.maximumGuests) ||
      result.maximumGuests < result.includedGuests ||
      !Number.isFinite(result.extraGuestRate) ||
      result.extraGuestRate < 0 ||
      !Number.isInteger(result.minimumNights) ||
      result.minimumNights < 1 ||
      !Number.isInteger(result.peakMinimumNights) ||
      result.peakMinimumNights < 1
    ) {
      throw new Error("Invalid booking settings in Firestore.");
    }

    return result;
  }

  async function loadBookingData() {
const [
  pricingSnapshot,
  blockedSnapshot,
  reservationsSnapshot,
  airbnbSnapshot
] = await Promise.all([
  getDoc(doc(db, "settings", "pricing")),
  getDocs(collection(db, "blockedDates")),
  getDocs(collection(db, "reservations")),
  getDocs(collection(db, "airbnbBlockedDates"))
]);

    if (!pricingSnapshot.exists()) {
      throw new Error("settings/pricing does not exist.");
    }

    const savedPricing = normalizePricing(
      pricingSnapshot.data()
    );

    const unavailable = new Set();

    airbnbSnapshot.forEach(snapshot => {
  const date = snapshot.data().date || snapshot.id;

  if (parseDate(date)) {
    unavailable.add(date);
  }
});


    blockedSnapshot.forEach(snapshot => {
      const block = snapshot.data();

      if (parseDate(snapshot.id)) {
        unavailable.add(snapshot.id);
      }

      if (parseDate(block.date)) {
        unavailable.add(block.date);
      }

      if (Array.isArray(block.dates)) {
        block.dates.forEach(key => {
          if (parseDate(key)) unavailable.add(key);
        });
      }

      const start =
        block.startDate || block.checkin || block.checkIn;

      const end =
        block.endDate || block.checkout || block.checkOut;

      eachNight(start, end, key => unavailable.add(key));
    });

    reservationsSnapshot.forEach(snapshot => {
      const reservation = snapshot.data();

      const status = String(
        reservation.status || ""
      ).trim().toLowerCase();

      if (status !== "confirmed") return;

      const start =
        reservation.checkin || reservation.checkIn;

      const end =
        reservation.checkout || reservation.checkOut;

      eachNight(start, end, key => unavailable.add(key));
    });

    return {
      pricing: savedPricing,
      unavailable
    };
  }

  /* =========================================
     SEASONAL PRICING
  ========================================= */

  function getSeason(key) {
    if (!pricing) return null;

    const date = parseDate(key);
    if (!date) return null;

    if (inRange(key, pricing.peakStart, pricing.peakEnd)) {
      return "peak";
    }

    if (inRange(key, pricing.easterStart, pricing.easterEnd)) {
      return "high";
    }

    const month = date.getMonth() + 1;

    return MONTH_SEASONS[month] || "mid";
  }

  function rangeIsAvailable(start, end) {
    const first = parseDate(start);
    const last = parseDate(end);

    if (!first || !last || first < today || first >= last) {
      return false;
    }

    let available = true;

    // Checkout is exclusive: guests do not occupy
    // the property on their checkout night.
    eachNight(start, end, key => {
      if (bookedDates.has(key)) available = false;
    });

    return available;
  }

  function calculateStay() {
    if (!dataReady || !pricing) {
      return {
        valid: false,
        error: "Rates and availability are loading."
      };
    }

    const { checkin, checkout, guests } = booking;

    if (!checkin || !checkout) {
      return {
        valid: false,
        error: "Select check-in and checkout dates."
      };
    }

    if (!rangeIsAvailable(checkin, checkout)) {
      return {
        valid: false,
        error: "Your stay includes unavailable dates."
      };
    }

    if (
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > pricing.maximumGuests
    ) {
      return {
        valid: false,
        error: `Maximum ${pricing.maximumGuests} guests allowed.`
      };
    }

    const nights = getNights(checkin, checkout);

    let accommodation = 0;
    let includesPeak = false;
    let missingRate = false;

    const breakdown = {
      low: { nights: 0, total: 0 },
      mid: { nights: 0, total: 0 },
      high: { nights: 0, total: 0 },
      peak: { nights: 0, total: 0 }
    };

    eachNight(checkin, checkout, key => {
      const season = getSeason(key);
      const rate = pricing.rates[season];

      if (!Number.isFinite(rate) || rate <= 0) {
        missingRate = true;
        return;
      }

      accommodation += rate;
      breakdown[season].nights++;
      breakdown[season].total += rate;

      if (season === "peak") includesPeak = true;
    });

    if (missingRate) {
      return {
        valid: false,
        error: "A nightly rate is missing."
      };
    }

    const extraGuests = Math.max(
      0,
      guests - pricing.includedGuests
    );

    const extraGuestTotal =
      extraGuests * pricing.extraGuestRate * nights;

    const total = accommodation + extraGuestTotal;

    const minimumNights = includesPeak
      ? pricing.peakMinimumNights
      : pricing.minimumNights;

    return {
      valid: nights >= minimumNights,
      priceAvailable: true,
      nights,
      accommodation,
      extraGuests,
      extraGuestTotal,
      total,
      breakdown,
      minimumNights,
      error: nights >= minimumNights
        ? ""
        : `A minimum stay of ${minimumNights} nights is required.`
    };
  }

  function validStay() {
    return calculateStay().valid;
  }

  /* =========================================
     GUEST OPTIONS
  ========================================= */

  function buildGuestOptions() {
    const select = elements.guestCount;

    if (!select || !pricing) return;

    select.replaceChildren();

    for (let count = 1; count <= pricing.maximumGuests; count++) {
      const option = document.createElement("option");

      option.value = String(count);
      option.textContent =
        `${count} Guest${count === 1 ? "" : "s"}`;

      select.appendChild(option);
    }

    booking.guests = Math.min(
      Math.max(booking.guests, 1),
      pricing.maximumGuests
    );

    select.value = String(booking.guests);
    select.disabled = false;
  }

  /* =========================================
     CALENDAR
  ========================================= */

  function renderCalendar() {
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();

    elements.calendarMonth.textContent =
      displayedMonth.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
      });

    elements.calendarDays.replaceChildren();

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < offset; i++) {
      const empty = document.createElement("span");
      empty.className = "calendar-day-empty";
      empty.setAttribute("aria-hidden", "true");
      elements.calendarDays.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);

      const past = date < today;
      const booked = bookedDates.has(key);

      const selected =
        key === booking.checkin ||
        key === booking.checkout;

      const inSelectedRange = Boolean(
        booking.checkin &&
        booking.checkout &&
        key > booking.checkin &&
        key < booking.checkout
      );

      const checkoutOnly = Boolean(
        booked &&
        booking.checkin &&
        !booking.checkout &&
        key > booking.checkin &&
        rangeIsAvailable(booking.checkin, key)
      );

      const button = document.createElement("button");

      button.type = "button";
      button.className = "calendar-day";
      button.textContent = String(day);

      if (past) button.classList.add("is-past");
      if (booked) button.classList.add("is-booked");

      if (selected) {
        button.classList.add("is-selected");
      } else if (inSelectedRange) {
        button.classList.add("is-range");
      } else if (checkoutOnly) {
        button.classList.add("is-checkout-only");
      }

      button.disabled =
        !dataReady ||
        past ||
        (booked && !checkoutOnly);

      const label = date.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });

      button.setAttribute(
        "aria-label",
        `${label}. ${booked ? "Unavailable night" : "Available"}`
      );

      if (selected) {
        button.setAttribute("aria-pressed", "true");
      }

      button.addEventListener("click", () => selectDate(key));

      elements.calendarDays.appendChild(button);
    }

    const currentMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    elements.prevMonth.disabled =
      displayedMonth <= currentMonth;
  }

  function selectDate(key) {
    if (!dataReady) return;

    const date = parseDate(key);

    if (!date || date < today) return;

    clearMessages();

    if (
      !booking.checkin ||
      booking.checkout ||
      key <= booking.checkin
    ) {
      if (bookedDates.has(key)) {
        showMessage(
          elements.stayMessage,
          "This date is unavailable for check-in."
        );
        return;
      }

      booking.checkin = key;
      booking.checkout = null;
    } else {
      if (!rangeIsAvailable(booking.checkin, key)) {
        showMessage(
          elements.stayMessage,
          "Your selected stay includes unavailable nights."
        );
        return;
      }

      booking.checkout = key;
    }

    updateBookingUI();
  }

  /* =========================================
     LIVE PRICE BREAKDOWN
  ========================================= */

  function renderPriceBreakdown(result) {
    let container = $("#bookingPriceBreakdown");

    if (!container) {
      container = document.createElement("div");
      container.id = "bookingPriceBreakdown";
      container.className = "booking-price-breakdown";

      const total = $("#summaryTotal");

      if (total) {
        const totalRow = total.closest(".summary-total");

        if (totalRow) {
          totalRow.parentElement.insertBefore(
            container,
            totalRow
          );
        } else {
          total.parentElement?.appendChild(container);
        }
      }
    }

    container.replaceChildren();
    container.hidden = !result.priceAvailable;

    if (!result.priceAvailable) return;

    const labels = {
      low: "Low season",
      mid: "Mid season",
      high: "High season",
      peak: "Peak season"
    };

    function addRow(labelText, valueText) {
      const row = document.createElement("div");
      row.className = "summary-row";

      const label = document.createElement("span");
      const value = document.createElement("strong");

      label.textContent = labelText;
      value.textContent = valueText;

      row.append(label, value);
      container.appendChild(row);
    }

    for (const season of ["low", "mid", "high", "peak"]) {
      const item = result.breakdown[season];

      if (!item.nights) continue;

      addRow(
        `${labels[season]} (${item.nights} × ${money(pricing.rates[season])})`,
        money(item.total)
      );
    }

    if (result.extraGuests > 0) {
      addRow(
        `Extra guests (${result.extraGuests} × ${result.nights} nights × ${money(pricing.extraGuestRate)})`,
        money(result.extraGuestTotal)
      );
    }
  }

  /* =========================================
     UPDATE BOOKING UI
  ========================================= */

  function updateBookingUI() {
    const result = calculateStay();

    elements.selectedCheckin.textContent =
      formatDate(booking.checkin);

    elements.selectedCheckout.textContent =
      formatDate(booking.checkout);

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

    const nights = booking.checkin && booking.checkout
      ? getNights(booking.checkin, booking.checkout)
      : 0;

    setText(
      "#summaryDuration",
      nights
        ? `${nights} night${nights === 1 ? "" : "s"}`
        : "—"
    );

    // A mixed-season stay does not have one nightly rate.
    const activeRates = result.priceAvailable
      ? ["low", "mid", "high", "peak"]
          .filter(season => result.breakdown[season].nights > 0)
          .map(season => pricing.rates[season])
      : [];

    const uniqueRates = [...new Set(activeRates)];

    setText(
      "#summaryRate",
      uniqueRates.length === 1
        ? money(uniqueRates[0])
        : uniqueRates.length > 1
          ? "Varies by season"
          : "—"
    );

    setText(
      "#summaryTotal",
      result.priceAvailable ? money(result.total) : "—"
    );

    renderPriceBreakdown(result);

    if (elements.continueDetails) {
      elements.continueDetails.disabled = !result.valid;
    }

    if (booking.checkin && booking.checkout) {
      showMessage(
        elements.stayMessage,
        result.error || ""
      );
    }

    renderCalendar();
  }

  /* =========================================
     STEP NAVIGATION
  ========================================= */

  function goToStep(step) {
    elements.steps.forEach((panel, index) => {
      if (panel) panel.hidden = index + 1 !== step;
    });

    if (elements.summary) {
      elements.summary.hidden = false;
    }

    elements.progress.forEach((item, index) => {
      const number = index + 1;

      item.classList.toggle("is-active", number === step);
      item.classList.toggle("is-complete", number < step);

      if (number === step) {
        item.setAttribute("aria-current", "step");
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

  /* =========================================
     STEP 1
  ========================================= */


elements.continueDetails.addEventListener("click", () => {
  clearMessages();

  const result = calculateStay();

  if (!result.valid) {
    showMessage(elements.stayMessage, result.error);
    return;
  }

  // META PIXEL — VALID BOOKING CHECKOUT STARTED
  if (typeof window.fbq === "function") {
    window.fbq("track", "InitiateCheckout", {
      value: result.total,
      currency: "KES",
      num_items: 1
    });
  }

  goToStep(2);
});



  elements.guestCount.addEventListener("change", () => {
    booking.guests = Number(elements.guestCount.value);
    clearMessages();
    updateBookingUI();
  });

  /* =========================================
     STEP 2 — GUEST DETAILS
  ========================================= */

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

  elements.guestForm.addEventListener("submit", event => {
    event.preventDefault();
    clearMessages();

    const result = calculateStay();

    if (!result.valid) {
      goToStep(1);
      showMessage(elements.stayMessage, result.error);
      return;
    }

    if (!collectGuestDetails()) return;

    updateReview();
    goToStep(3);
  });

  /* =========================================
     STEP 3 — REVIEW
  ========================================= */

  function updateReview() {
    const result = calculateStay();

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

    setText("#reviewNights", String(result.nights || 0));
    setText("#reviewName", booking.fullName);
    setText("#reviewEmail", booking.email);
    setText("#reviewPhone", booking.phone);

    setText(
      "#reviewRequests",
      booking.specialRequests || "None"
    );

    setText(
      "#reviewTotal",
      result.priceAvailable ? money(result.total) : "—"
    );
  }

  /* =========================================
     BACK AND EDIT
  ========================================= */

  elements.backToStay?.addEventListener("click", () => {
    clearMessages();
    goToStep(1);
  });

  elements.backToDetails?.addEventListener("click", () => {
    clearMessages();
    goToStep(2);
  });

  elements.editStay?.addEventListener("click", () => {
    clearMessages();
    goToStep(1);
  });

  elements.editDetails?.addEventListener("click", () => {
    clearMessages();
    goToStep(2);
  });



/* =========================================
   PAYSTACK PAYMENT INTEGRATION
========================================= */

const API_BASE = "http://localhost:3000";

let paymentInProgress = false;


/* =========================================
   META PIXEL — PURCHASE TRACKING
========================================= */

function trackMetaPurchase(reference, amountPaidKes) {
  const amount = Number(amountPaidKes);

  if (
    !reference ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return;
  }

  const storageKey = `meta_purchase_${reference}`;

  // Avoid tracking again on a normal page revisit.
  try {
    if (localStorage.getItem(storageKey) === "sent") {
      return;
    }
  } catch (error) {
    console.warn("Meta tracking storage unavailable:", error);
  }

  if (typeof window.fbq !== "function") return;

  window.fbq("track", "Purchase", {
    value: amount,
    currency: "KES"
  }, {
    eventID: `purchase_${reference}`
  });

  try {
    localStorage.setItem(storageKey, "sent");
  } catch (error) {
    console.warn("Could not save Meta tracking state:", error);
  }
}



elements.submitBooking?.addEventListener(
  "click",
  async () => {
    if (paymentInProgress) return;

    clearMessages();

    const result = calculateStay();

    if (!result.valid) {
      goToStep(1);
      showMessage(elements.stayMessage, result.error);
      return;
    }

    if (!collectGuestDetails()) {
      goToStep(2);
      return;
    }

    updateReview();

    const button = elements.submitBooking;
    const originalHTML = button.innerHTML;

    try {
      paymentInProgress = true;
      button.disabled = true;
      button.textContent = "PREPARING PAYMENT...";

      const response = await fetch(
        `${API_BASE}/api/payments/initialize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            checkin: booking.checkin,
            checkout: booking.checkout,
            guests: booking.guests,
            fullName: booking.fullName,
            email: booking.email,
            phone: booking.phone,
            specialRequests: booking.specialRequests
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Could not initialize payment."
        );
      }

      if (!data.authorization_url ||
          !data.authorization_url.startsWith(
            "https://checkout.paystack.com/"
          )) {
        throw new Error("Invalid Paystack checkout URL.");
      }

      showMessage(
        elements.submitMessage,
        "Redirecting to secure Paystack checkout..."
      );

      window.location.assign(data.authorization_url);

    } catch (error) {
      console.error("Payment initialization:", error);

      showMessage(
        elements.submitMessage,
        error.message ||
          "Payment could not be started. Please try again."
      );

      paymentInProgress = false;
      button.disabled = false;
      button.innerHTML = originalHTML;
    }
  }
);

/* =========================================
   PAYMENT RETURN HANDLER
========================================= */

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);

  const reference = params.get("payment_reference");

  if (!reference) return;

  showMessage(
    elements.stayMessage,
    "Checking your payment status..."
  );

  try {
    const response = await fetch(
      `${API_BASE}/api/payments/verify/${encodeURIComponent(reference)}`
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.message ||
          "Payment has not been confirmed."
      );
    }

    
/*
  META PIXEL — VERIFIED PURCHASE

  The amount must come from the backend's
  verified Paystack payment response.
*/

// Replace this property with the actual verified
// KES amount field returned by your backend.
const verifiedAmountKes = result.amountPaidKes;

trackMetaPurchase(reference, verifiedAmountKes);


    const message =
      `Your payment has been verified! ` +
      `Booking reference: ${reference}. ` +
      `Your reservation is confirmed. ` +
      `A confirmation email will be sent to you.`;

    // Replace the normal booking interface with a
    // simple confirmation message.
    const main = document.querySelector(".booking-container");

    if (main) {
      main.replaceChildren();

      const confirmation = document.createElement("section");
      confirmation.className = "booking-panel";

      const heading = document.createElement("h1");
      heading.textContent = "Booking confirmed.";

      const paragraph = document.createElement("p");
      paragraph.textContent = message;

      const home = document.createElement("a");
      home.href = "index.html";
      home.className = "primary-button";
      home.textContent = "BACK TO WEBSITE";

      confirmation.append(heading, paragraph, home);
      main.appendChild(confirmation);
    }

    window.history.replaceState(
      {},
      "",
      window.location.pathname
    );

  } catch (error) {
    console.error("Payment verification:", error);

    showMessage(
      elements.stayMessage,
      "We could not confirm your reservation automatically. " +
      "If money was deducted, do not pay again. " +
      `Contact the property with reference ${reference}. ` +
      error.message
    );
  }
}


  /* =========================================
     MONTH NAVIGATION
  ========================================= */

  elements.prevMonth.addEventListener("click", () => {
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

    if (previous < currentMonth) return;

    displayedMonth = previous;
    renderCalendar();
  });

  elements.nextMonth.addEventListener("click", () => {
    displayedMonth = new Date(
      displayedMonth.getFullYear(),
      displayedMonth.getMonth() + 1,
      1
    );

    renderCalendar();
  });

  /* =========================================
     HOMEPAGE SELECTION
  ========================================= */

  function loadDatesFromURL() {
    const params = new URLSearchParams(
      window.location.search
    );

    const checkin = params.get("checkin");
    const checkout = params.get("checkout");
    const guestsParam = params.get("guests");

    if (guestsParam !== null) {
      const count = Number(guestsParam);

      if (
        Number.isInteger(count) &&
        count >= 1 &&
        count <= pricing.maximumGuests
      ) {
        booking.guests = count;
      }
    }

    elements.guestCount.value = String(booking.guests);

    if (!checkin || !checkout) return;

    const start = parseDate(checkin);
    const end = parseDate(checkout);

    if (!start || !end) {
      showMessage(
        elements.stayMessage,
        "The dates received from the homepage are invalid."
      );
      return;
    }

    displayedMonth = new Date(
      start.getFullYear(),
      start.getMonth(),
      1
    );

    booking.checkin = checkin;
    booking.checkout = checkout;

    const result = calculateStay();

    if (!result.valid) {
      booking.checkin = null;
      booking.checkout = null;

      showMessage(
        elements.stayMessage,
        `Your previous selection could not be restored: ${result.error}`
      );
    }
  }

  /* =========================================
     INITIALIZE
  ========================================= */

  async function initialize() {

    const paymentParams = new URLSearchParams(
  window.location.search
);

if (paymentParams.has("payment_reference")) {
  await handlePaymentReturn();
  return;
}

    elements.guestCount.disabled = true;
    elements.continueDetails.disabled = true;

    showMessage(
      elements.stayMessage,
      "Loading live rates and availability..."
    );

    renderCalendar();
    goToStep(1);

    try {
      const data = await loadBookingData();

      pricing = data.pricing;
      bookedDates = data.unavailable;
      dataReady = true;

      buildGuestOptions();
      loadDatesFromURL();

      const initialMessage = elements.stayMessage.textContent;

      updateBookingUI();

      if (
        initialMessage.startsWith(
          "Your previous selection could not"
        ) ||
        initialMessage.startsWith(
          "The dates received"
        )
      ) {
        showMessage(elements.stayMessage, initialMessage);
      } else if (!booking.checkin) {
        showMessage(elements.stayMessage, "");
      }

      console.info("Live pricing loaded:", pricing);
      console.info("Unavailable nights:", [...bookedDates]);

    } catch (error) {
      console.error("Booking initialization failed:", error);

      dataReady = false;
      elements.guestCount.disabled = true;
      elements.continueDetails.disabled = true;

      renderCalendar();

      showMessage(
        elements.stayMessage,
        "Live booking information is unavailable. Please try again later."
      );
    }
  }

  initialize();
});
