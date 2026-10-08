
/* =========================================
   HIPPO HOUSE MALINDI
   MAIN JAVASCRIPT
========================================= */

document.addEventListener("DOMContentLoaded", () => {

  const header = document.getElementById("siteHeader");
  const heroVideo = document.querySelector(".hero-video");

  /* -------------------------------------
     NAVBAR SCROLL BEHAVIOR
  ------------------------------------- */

  function updateNavbar() {
    if (!header) return;

    const isScrolled = window.scrollY > 40;

    header.classList.toggle("is-scrolled", isScrolled);
  }

  updateNavbar();

  window.addEventListener("scroll", updateNavbar, {
    passive: true
  });


  /* -------------------------------------
     HERO VIDEO CONTROL
  ------------------------------------- */

  if (heroVideo) {

    const mobileQuery = window.matchMedia("(max-width: 600px)");

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    function updateHeroVideo() {

      const shouldPause =
        mobileQuery.matches ||
        reducedMotionQuery.matches ||
        document.hidden;

      if (shouldPause) {
        heroVideo.pause();
        return;
      }

      const playPromise = heroVideo.play();

      if (
        playPromise &&
        typeof playPromise.catch === "function"
      ) {
        playPromise.catch(() => {
          // The poster image remains as a fallback.
        });
      }
    }

    updateHeroVideo();

    mobileQuery.addEventListener(
      "change",
      updateHeroVideo
    );

    reducedMotionQuery.addEventListener(
      "change",
      updateHeroVideo
    );

    document.addEventListener(
      "visibilitychange",
      updateHeroVideo
    );

  }

});


/* =========================================
   HIPPO HOUSE — AVAILABILITY CALENDAR
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  const daysContainer = document.getElementById("availabilityDays");
  const monthLabel = document.getElementById("availabilityMonth");
  const prevButton = document.getElementById("availabilityPrev");
  const nextButton = document.getElementById("availabilityNext");

  const checkinLabel = document.getElementById("availabilityCheckin");
  const checkoutLabel = document.getElementById("availabilityCheckout");
  const continueButton = document.getElementById("availabilityContinue");
  const notice = document.getElementById("availabilityNotice");

  if (!daysContainer || !monthLabel) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let displayedMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  let checkin = null;
  let checkout = null;

  /*
   * TEMPORARY BOOKED DATES
   *
   * These are examples only.
   * Later, the admin dashboard/backend will provide
   * booked and manually blocked dates.
   *
   * Format: YYYY-MM-DD
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

  const minimumNights = 2;

  /* Date helpers — use local calendar dates */

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
  }

  function parseDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDate(key) {
    if (!key) return "Select date";

    return parseDate(key).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short"
    });
  }

  function isBooked(key) {
    return bookedDates.has(key);
  }

  function nightsBetween(start, end) {
    const a = parseDate(start);
    const b = parseDate(end);

    return Math.round(
      (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
       Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000
    );
  }

  function rangeIsAvailable(start, end) {
    const cursor = parseDate(start);
    const last = parseDate(end);

    // Checkout is exclusive; a booked checkout date
    // may be allowed once backend rules are confirmed.
    while (cursor < last) {
      if (isBooked(dateKey(cursor))) return false;
      cursor.setDate(cursor.getDate() + 1);
    }

    return true;
  }

  function updateSelection() {
    checkinLabel.textContent = formatDate(checkin);
    checkoutLabel.textContent = formatDate(checkout);

    const valid = Boolean(checkin && checkout);

    continueButton.classList.toggle("is-disabled", !valid);
    continueButton.setAttribute("aria-disabled", String(!valid));
    continueButton.tabIndex = valid ? 0 : -1;

    if (valid) {
      const nights = nightsBetween(checkin, checkout);

      notice.textContent =
        `${nights} night${nights === 1 ? "" : "s"} selected. ` +
        "Continue to complete your booking.";

      continueButton.href =
        `book.html?checkin=${encodeURIComponent(checkin)}` +
        `&checkout=${encodeURIComponent(checkout)}`;
    } else {
      continueButton.href = "book.html";

      notice.textContent = checkin
        ? `Select a check-out date (minimum ${minimumNights} nights).`
        : "Select your check-in and check-out dates to continue.";
    }
  }

  function selectDate(key) {
    if (isBooked(key)) return;

    if (!checkin || checkout || key <= checkin) {
      checkin = key;
      checkout = null;
    } else {
      const nights = nightsBetween(checkin, key);

      if (nights < minimumNights) {
        notice.textContent =
          `A minimum stay of ${minimumNights} nights is required.`;
        return;
      }

      if (!rangeIsAvailable(checkin, key)) {
        notice.textContent =
          "Your selected dates include an unavailable night. " +
          "Please choose another range.";
        return;
      }

      checkout = key;
    }

    updateSelection();
    renderCalendar();
  }

  function renderCalendar() {
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();

    monthLabel.textContent = displayedMonth.toLocaleDateString(
      "en-GB",
      { month: "long", year: "numeric" }
    );

    daysContainer.innerHTML = "";

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Monday-first calendar
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

      const booked = isBooked(key);
      const past = date < today;

      const selected =
        key === checkin || key === checkout;

      const inRange =
        checkin && checkout &&
        key > checkin && key < checkout;

      const button = document.createElement("button");

      button.type = "button";
      button.className = "availability-day";
      button.textContent = day;

      if (past) {
        button.classList.add("is-past");
      } else if (booked) {
        button.classList.add("is-booked");
      } else if (selected) {
        button.classList.add("is-selected");
      } else if (inRange) {
        button.classList.add("is-in-range");
      }

      button.disabled = past || booked;

      button.setAttribute(
        "aria-label",
        `${date.toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        })}, ${past ? "past date" : booked ? "booked" : "available"}`
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

    prevButton.disabled = displayedMonth <= currentMonth;
  }

  prevButton.addEventListener("click", () => {
    displayedMonth.setMonth(displayedMonth.getMonth() - 1);
    renderCalendar();
  });

  nextButton.addEventListener("click", () => {
    displayedMonth.setMonth(displayedMonth.getMonth() + 1);
    renderCalendar();
  });

  continueButton.addEventListener("click", (event) => {
    if (!checkin || !checkout) {
      event.preventDefault();
    }
  });

  updateSelection();
  renderCalendar();
});


/* =========================================
   FOOTER — AUTOMATIC COPYRIGHT YEAR
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  const footerYear = document.getElementById("footerYear");

  if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
  }
});

