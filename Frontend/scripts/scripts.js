
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

/* =========================================
   HIPPO HOUSE — FIREBASE
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
  Month-to-season mapping.

  The five previously unassigned months are
  temporarily treated as MID season.

  Rates are always retrieved from Firestore.
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

/* =========================================
   NAVIGATION AND HERO
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  const header = document.getElementById("siteHeader");
  const video = document.querySelector(".hero-video");

  function updateNavbar() {
    header?.classList.toggle(
      "is-scrolled",
      window.scrollY > 40
    );
  }

  updateNavbar();

  window.addEventListener("scroll", updateNavbar, {
    passive: true
  });

  if (video) {
    const mobile = window.matchMedia("(max-width: 600px)");
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    function updateVideo() {
      if (mobile.matches || reducedMotion.matches || document.hidden) {
        video.pause();
        return;
      }

      video.play().catch(() => {});
    }

    updateVideo();

    mobile.addEventListener("change", updateVideo);
    reducedMotion.addEventListener("change", updateVideo);
    document.addEventListener("visibilitychange", updateVideo);
  }

  const footerYear = document.getElementById("footerYear");

  if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
  }
});

/* =========================================
   CALENDAR AND PRICING
========================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const $ = id => document.getElementById(id);

  const daysContainer = $("availabilityDays");
  const monthLabel = $("availabilityMonth");

  if (!daysContainer || !monthLabel) return;

  const prevButton = $("availabilityPrev");
  const nextButton = $("availabilityNext");
  const checkinLabel = $("availabilityCheckin");
  const checkoutLabel = $("availabilityCheckout");
  const continueButton = $("availabilityContinue");
  const notice = $("availabilityNotice");
  const estimate = $("availabilityEstimate");
  const decreaseButton = $("guestDecrease");
  const increaseButton = $("guestIncrease");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let displayedMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  let checkin = null;
  let checkout = null;
  let guests = 2;

  let pricing = null;
  let bookedDates = new Set();
  let dataReady = false;

  /* =========================================
     HELPERS
  ========================================= */

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function money(amount) {
    return "KSh " + Number(amount).toLocaleString("en-KE");
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function parseDate(value) {
    if (typeof value !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return dateKey(date) === value ? date : null;
  }

  function formatDate(value) {
    const date = parseDate(value);

    if (!date) return "Select date";

    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function nightsBetween(start, end) {
    const first = parseDate(start);
    const last = parseDate(end);

    if (!first || !last) return 0;

    return Math.round(
      (
        Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
        Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())
      ) / 86400000
    );
  }

  function eachNight(start, end, callback) {
    const cursor = parseDate(start);
    const final = parseDate(end);

    if (!cursor || !final || cursor >= final) return;

    while (cursor < final) {
      callback(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  function hasBookedNight(start, end) {
    let blocked = false;

    eachNight(start, end, key => {
      if (bookedDates.has(key)) blocked = true;
    });

    return blocked;
  }

  function inRange(key, start, end) {
    return Boolean(
      parseDate(start) &&
      parseDate(end) &&
      key >= start &&
      key <= end
    );
  }

  /* =========================================
     FIRESTORE PRICING
  ========================================= */

  function normalizePricing(data) {
    if (!data?.rates) {
      throw new Error("Missing Firestore pricing rates.");
    }

    const rates = {};

    for (const season of ["low", "mid", "high", "peak", "fallback"]) {
      rates[season] = Number(data.rates[season] ?? 0);

      if (!Number.isFinite(rates[season]) || rates[season] < 0) {
        throw new Error(`Invalid ${season} rate.`);
      }
    }

    for (const season of ["low", "mid", "high", "peak"]) {
      if (rates[season] <= 0) {
        throw new Error(`Missing ${season} season rate.`);
      }
    }

    const normalized = {
      ...data,
      rates,
      includedGuests: Number(data.includedGuests),
      maximumGuests: Number(data.maximumGuests),
      extraGuestRate: Number(data.extraGuestRate),
      minimumNights: Number(data.minimumNights),
      peakMinimumNights: Number(data.peakMinimumNights)
    };

    if (
      !Number.isInteger(normalized.includedGuests) ||
      !Number.isInteger(normalized.maximumGuests) ||
      normalized.includedGuests < 1 ||
      normalized.maximumGuests < normalized.includedGuests ||
      !Number.isFinite(normalized.extraGuestRate) ||
      normalized.extraGuestRate < 0 ||
      !Number.isInteger(normalized.minimumNights) ||
      normalized.minimumNights < 1 ||
      !Number.isInteger(normalized.peakMinimumNights) ||
      normalized.peakMinimumNights < 1
    ) {
      throw new Error("Invalid guest or minimum-stay settings.");
    }

    return normalized;
  }

  /* =========================================
     DETERMINE SEASON
  ========================================= */

  function getSeason(key) {
    if (!pricing) return null;

    const date = parseDate(key);
    if (!date) return null;

    const month = date.getMonth() + 1;
    const day = date.getDate();

    // Specific configured date ranges take priority.
    if (inRange(key, pricing.peakStart, pricing.peakEnd)) {
      return "peak";
    }

    if (inRange(key, pricing.easterStart, pricing.easterEnd)) {
      return "high";
    }

    // December 20 onward is not automatically
    // classified as peak while peak dates are unset.
    // Configure peakStart/peakEnd to enable peak pricing.
    if (month === 12 && day <= 19) {
      return "high";
    }

    return MONTH_SEASONS[month] || "mid";
  }

  function getNightRate(key) {
    const season = getSeason(key);
    if (!season) return null;

    const amount = pricing.rates[season];

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    return { season, amount };
  }

  /* =========================================
     CALCULATE STAY
  ========================================= */

  function calculateStay(start, end, guestCount) {
    if (!dataReady || !pricing) {
      return {
        valid: false,
        error: "Pricing is still loading."
      };
    }

    const first = parseDate(start);
    const last = parseDate(end);

    if (!first || !last || first < today || first >= last) {
      return {
        valid: false,
        error: "Please select valid dates."
      };
    }

    if (
      !Number.isInteger(guestCount) ||
      guestCount < 1 ||
      guestCount > pricing.maximumGuests
    ) {
      return {
        valid: false,
        error: `Maximum ${pricing.maximumGuests} guests allowed.`
      };
    }

    if (hasBookedNight(start, end)) {
      return {
        valid: false,
        error: "Your stay includes an unavailable night."
      };
    }

    const nights = nightsBetween(start, end);

    const breakdown = {
      low: { nights: 0, amount: 0 },
      mid: { nights: 0, amount: 0 },
      high: { nights: 0, amount: 0 },
      peak: { nights: 0, amount: 0 }
    };

    let accommodation = 0;
    let missingRate = null;
    let includesPeak = false;

    eachNight(start, end, key => {
      const nightly = getNightRate(key);

      if (!nightly) {
        missingRate ??= key;
        return;
      }

      accommodation += nightly.amount;
      breakdown[nightly.season].nights++;
      breakdown[nightly.season].amount += nightly.amount;

      if (nightly.season === "peak") includesPeak = true;
    });

    if (missingRate) {
      return {
        valid: false,
        error: `No nightly rate configured for ${formatDate(missingRate)}.`
      };
    }

    const extraGuestCount = Math.max(
      0,
      guestCount - pricing.includedGuests
    );

    const extraGuestTotal =
      extraGuestCount * pricing.extraGuestRate * nights;

    const total = accommodation + extraGuestTotal;

    const minimumRequired = includesPeak
      ? pricing.peakMinimumNights
      : pricing.minimumNights;

    const valid = nights >= minimumRequired;

    return {
      valid,
      priceAvailable: true,
      nights,
      guests: guestCount,
      accommodation,
      extraGuestCount,
      extraGuestTotal,
      extraGuestRate: pricing.extraGuestRate,
      total,
      breakdown,
      minimumRequired,
      error: valid
        ? ""
        : `A minimum stay of ${minimumRequired} nights is required.`
    };
  }

  /* =========================================
     DISPLAY PRICING
  ========================================= */

  function renderPricing() {
    if (!pricing) return;

    const rates = pricing.rates;

    const startingRate = Math.min(
      rates.low,
      rates.mid,
      rates.high,
      rates.peak
    );

    setText(
      "homepageStartingPrice",
      startingRate.toLocaleString("en-KE")
    );

    setText("homepageLowRate", money(rates.low));
    setText("homepageMidRate", money(rates.mid));
    setText("homepageHighRate", money(rates.high));
    setText("homepagePeakRate", money(rates.peak));

    setText(
      "homepageGuestDetails",
      `Rates include up to ${pricing.includedGuests} guests. Maximum ${pricing.maximumGuests} guests, including children.`
    );

    setText(
      "homepageExtraGuestRate",
      `Additional guests: ${money(pricing.extraGuestRate)} per person, per night.`
    );

    setText(
      "homepageMinimumStay",
      `Peak season: ${pricing.peakMinimumNights}-night minimum.`
    );

    setText("pricingDataStatus", "");
  }

  /* =========================================
     PRICE BREAKDOWN
  ========================================= */

  function renderBreakdown(result) {
    if (!estimate) return;

    estimate.hidden = !result?.priceAvailable;

    if (!result?.priceAvailable) return;

    setText("estimateAccommodation", money(result.accommodation));
    setText("estimateExtraGuests", money(result.extraGuestTotal));
    setText(
      "estimateNights",
      `${result.nights} night${result.nights === 1 ? "" : "s"} · ${result.guests} guests`
    );
    setText("estimateTotal", money(result.total));

    let details = $("availabilitySeasonBreakdown");

    if (!details) {
      details = document.createElement("div");
      details.id = "availabilitySeasonBreakdown";
      details.className = "availability-season-breakdown";

      const accommodationRow = $("estimateAccommodation")
        ?.closest(".availability-estimate-row");

      if (accommodationRow) {
        accommodationRow.insertAdjacentElement("afterend", details);
      } else {
        estimate.prepend(details);
      }
    }

    details.replaceChildren();

    const labels = {
      low: "Low season",
      mid: "Mid season",
      high: "High season",
      peak: "Peak season"
    };

    for (const season of ["low", "mid", "high", "peak"]) {
      const item = result.breakdown[season];
      if (!item.nights) continue;

      const row = document.createElement("div");
      row.className = "availability-estimate-row";

      const label = document.createElement("span");
      const amount = document.createElement("strong");

      label.textContent =
        `${labels[season]}: ${item.nights} × ${money(pricing.rates[season])}`;

      amount.textContent = money(item.amount);

      row.append(label, amount);
      details.appendChild(row);
    }

    let guestExplanation = $("availabilityExtraGuestExplanation");

    if (!guestExplanation) {
      guestExplanation = document.createElement("p");
      guestExplanation.id = "availabilityExtraGuestExplanation";

      const extraRow = $("estimateExtraGuests")
        ?.closest(".availability-estimate-row");

      if (extraRow) {
        extraRow.insertAdjacentElement("afterend", guestExplanation);
      } else {
        estimate.appendChild(guestExplanation);
      }
    }

    guestExplanation.hidden = result.extraGuestCount === 0;

    guestExplanation.textContent = result.extraGuestCount
      ? `${result.extraGuestCount} additional guests × ${result.nights} nights × ${money(result.extraGuestRate)}`
      : "";
  }

  /* =========================================
     UPDATE SELECTION
  ========================================= */

  function updateSelection(message = "") {
    if (checkinLabel) checkinLabel.textContent = formatDate(checkin);
    if (checkoutLabel) checkoutLabel.textContent = formatDate(checkout);

    const result = checkin && checkout
      ? calculateStay(checkin, checkout, guests)
      : null;

    renderBreakdown(result);

    const valid = Boolean(result?.valid);

    if (continueButton) {
      continueButton.classList.toggle("is-disabled", !valid);
      continueButton.setAttribute("aria-disabled", String(!valid));
      continueButton.tabIndex = valid ? 0 : -1;

      if (valid) {
        const params = new URLSearchParams({
          checkin,
          checkout,
          guests: String(guests)
        });

        continueButton.href = `book.html?${params.toString()}`;
      } else {
        continueButton.removeAttribute("href");
      }
    }

    if (!notice) return;

    if (message) {
      notice.textContent = message;
    } else if (result && !result.valid) {
      notice.textContent = result.error;
    } else if (valid) {
      notice.textContent =
        `Estimated total: ${money(result.total)} for ${result.nights} nights and ${guests} guests.`;
    } else {
      notice.textContent = checkin
        ? "Select your checkout date to calculate the price."
        : "Select your check-in and checkout dates.";
    }
  }

  /* =========================================
     GUEST CONTROLS
  ========================================= */

  function updateGuestDisplay() {
    setText("availabilityGuests", guests);

    if (decreaseButton) {
      decreaseButton.disabled = !dataReady || guests <= 1;
    }

    if (increaseButton) {
      increaseButton.disabled =
        !dataReady || guests >= pricing.maximumGuests;
    }

    updateSelection();
  }

  decreaseButton?.addEventListener("click", () => {
    if (!dataReady) return;

    guests = Math.max(1, guests - 1);
    updateGuestDisplay();
  });

  increaseButton?.addEventListener("click", () => {
    if (!dataReady) return;

    guests = Math.min(pricing.maximumGuests, guests + 1);
    updateGuestDisplay();
  });

  /* =========================================
     SELECT DATES
  ========================================= */

  function selectDate(key) {
    if (!dataReady) return;

    const selectedDate = parseDate(key);

    if (!selectedDate || selectedDate < today) return;

    if (!checkin || checkout || key <= checkin) {
      if (bookedDates.has(key)) {
        updateSelection("This date is unavailable for check-in.");
        return;
      }

      checkin = key;
      checkout = null;

      updateSelection();
      renderCalendar();
      return;
    }

    if (hasBookedNight(checkin, key)) {
      updateSelection(
        "Your selected stay overlaps an unavailable night."
      );
      return;
    }

    checkout = key;

    updateSelection();
    renderCalendar();
  }

  /* =========================================
     CALENDAR
  ========================================= */

  function renderCalendar() {
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();

    monthLabel.textContent = displayedMonth.toLocaleDateString(
      "en-GB",
      { month: "long", year: "numeric" }
    );

    daysContainer.replaceChildren();

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < offset; i++) {
      const empty = document.createElement("span");
      empty.className = "availability-day-empty";
      empty.setAttribute("aria-hidden", "true");
      daysContainer.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);

      const past = date < today;
      const booked = bookedDates.has(key);
      const selected = key === checkin || key === checkout;

      const inSelectedRange = Boolean(
        checkin &&
        checkout &&
        key > checkin &&
        key < checkout
      );

      const button = document.createElement("button");
      button.type = "button";
      button.className = "availability-day";
      button.textContent = String(day);

      if (booked) button.classList.add("is-booked");
      if (past) button.classList.add("is-past");

      if (selected) {
        button.classList.add("is-selected");
      } else if (inSelectedRange) {
        button.classList.add("is-in-range");
      }

      const canCheckoutOnBookedDate =
        booked &&
        Boolean(checkin) &&
        !checkout &&
        key > checkin &&
        !hasBookedNight(checkin, key);

      button.disabled =
        !dataReady ||
        past ||
        (booked && !canCheckoutOnBookedDate);

      const formatted = date.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });

      button.setAttribute(
        "aria-label",
        `${formatted}, ${booked ? "unavailable night" : "available"}`
      );

      if (selected) {
        button.setAttribute("aria-pressed", "true");
      }

      button.addEventListener("click", () => selectDate(key));

      daysContainer.appendChild(button);
    }

    const currentMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    if (prevButton) {
      prevButton.disabled = displayedMonth <= currentMonth;
    }
  }

  prevButton?.addEventListener("click", () => {
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

  nextButton?.addEventListener("click", () => {
    displayedMonth = new Date(
      displayedMonth.getFullYear(),
      displayedMonth.getMonth() + 1,
      1
    );

    renderCalendar();
  });

  continueButton?.addEventListener("click", event => {
    const result = checkin && checkout
      ? calculateStay(checkin, checkout, guests)
      : null;

    if (!result?.valid) {
      event.preventDefault();
      updateSelection(result?.error || "Please select valid dates.");
    }
  });

  /* =========================================
     LOAD FIRESTORE
  ========================================= */

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
      throw new Error("settings/pricing was not found.");
    }

    const savedPricing = normalizePricing(pricingSnapshot.data());
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

      const start = block.startDate || block.checkin || block.checkIn;
      const end = block.endDate || block.checkout || block.checkOut;

      eachNight(start, end, key => unavailable.add(key));
    });

    reservationsSnapshot.forEach(snapshot => {
      const reservation = snapshot.data();

      const status = String(
        reservation.status || ""
      ).trim().toLowerCase();

      if (status !== "confirmed") return;

      const start = reservation.checkin || reservation.checkIn;
      const end = reservation.checkout || reservation.checkOut;

      if (!parseDate(start) || !parseDate(end) || start >= end) {
        console.warn("Invalid reservation:", snapshot.id);
        return;
      }

      eachNight(start, end, key => unavailable.add(key));
    });

    console.info("Hippo House pricing:", savedPricing);
    console.info("Unavailable nights:", [...unavailable].sort());

    return {
      pricing: savedPricing,
      unavailableDates: unavailable
    };
  }

  /* =========================================
     INITIALIZE
  ========================================= */

  updateSelection("Loading rates and availability...");
  renderCalendar();
  updateGuestDisplay();

  try {
    const result = await loadBookingData();

    pricing = result.pricing;
    bookedDates = result.unavailableDates;
    dataReady = true;

    guests = Math.min(
      Math.max(guests, 1),
      pricing.maximumGuests
    );

    renderPricing();
    updateGuestDisplay();
    renderCalendar();
    updateSelection();

  } catch (error) {
    console.error("Unable to load booking data:", error);

    dataReady = false;

    if (estimate) estimate.hidden = true;

    setText(
      "pricingDataStatus",
      "Live rates are temporarily unavailable."
    );

    updateGuestDisplay();
    renderCalendar();
    updateSelection("Booking availability is temporarily unavailable.");
  }
});
