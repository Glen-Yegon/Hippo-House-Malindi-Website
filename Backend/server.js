
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const ical = require("node-ical");

const { initializeApp, cert } = require("firebase-admin/app");
const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = process.env.FRONTEND_URL;
const FRONTEND_PATH = process.env.FRONTEND_PATH || "";
const BACKEND_URL = process.env.BACKEND_URL;
const SECRET = process.env.PAYSTACK_SECRET_KEY;

const AIRBNB_ICAL_URL = process.env.AIRBNB_ICAL_URL;
const AIRBNB_SYNC_MS =
  Math.max(5, Number(process.env.AIRBNB_SYNC_MINUTES) || 15) *
  60 * 1000;

const AIRBNB_MAX_SYNC_AGE_MS = 30 * 60 * 1000;
const HOLD_MS = 15 * 60 * 1000;

const serviceAccount = require(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH
);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

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

app.use(cors({
  origin: FRONTEND_URL
}));

// Preserve the original body for Paystack webhook signatures.
app.use(express.json({
  limit: "20kb",
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));

/* =========================================
   GENERAL HELPERS
========================================= */

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function parseDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function nightsBetween(start, end) {
  return Math.round(
    (parseDate(end) - parseDate(start)) / 86400000
  );
}

function getDates(start, end) {
  const dates = [];

  for (
    let date = parseDate(start);
    date < parseDate(end);
    date = new Date(date.getTime() + 86400000)
  ) {
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
}

function kenyaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const part = type =>
    parts.find(item => item.type === type)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function money(amount) {
  return `KSh ${Number(amount).toLocaleString("en-KE")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

/* =========================================
   AIRBNB CALENDAR SYNCHRONIZATION
========================================= */

let airbnbSyncPromise = null;

function airbnbDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getAirbnbURL() {
  if (!AIRBNB_ICAL_URL) {
    throw new Error("AIRBNB_ICAL_URL is not configured.");
  }

  const url = new URL(AIRBNB_ICAL_URL);

  if (
    url.protocol !== "https:" ||
    !["airbnb.com", "www.airbnb.com"].includes(
      url.hostname.toLowerCase()
    )
  ) {
    throw new Error("Invalid Airbnb calendar URL.");
  }

  return url;
}

async function fetchAirbnbCalendar() {
  const url = getAirbnbURL();

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept: "text/calendar"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Airbnb returned HTTP ${response.status}`
      );
    }

    const calendarText = await response.text();

    if (
      !calendarText.includes("BEGIN:VCALENDAR") ||
      !calendarText.includes("END:VCALENDAR")
    ) {
      throw new Error("Invalid Airbnb iCal response.");
    }

    return calendarText;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAirbnbBlockedDates(calendarText) {
  const events = ical.sync.parseICS(calendarText);
  const blockedDates = new Set();

  const today = kenyaToday();
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);

  const maxDate = airbnbDateKey(horizon);

  for (const event of Object.values(events)) {
    if (event.type !== "VEVENT") continue;

    if (
      String(event.status || "").toUpperCase() ===
      "CANCELLED"
    ) {
      continue;
    }

    if (!event.start || !event.end) {
      continue;
    }

    // Airbnb normally exports all-day dates.
    // Check actual imported dates before production.
    const start = airbnbDateKey(event.start);
    const end = airbnbDateKey(event.end);

    if (start >= end) continue;

    // An unexpanded recurring event is unsafe to ignore.
    if (event.rrule) {
      throw new Error(
        "Recurring Airbnb event detected. " +
        "Calendar expansion is required before synchronization."
      );
    }

    const first = start < today ? today : start;
    const last = end > maxDate ? maxDate : end;

    if (first >= last) continue;

    for (const date of getDates(first, last)) {
      blockedDates.add(date);
    }
  }

  return blockedDates;
}

async function checkAirbnbConflicts(blockedDates) {
  const [
    reservationsSnapshot,
    locksSnapshot
  ] = await Promise.all([
    db.collection("reservations").get(),
    db.collection("bookingNightLocks").get()
  ]);

  const conflicts = new Set();

  reservationsSnapshot.forEach(snapshot => {
    const reservation = snapshot.data();

    if (
      String(reservation.status).toLowerCase() !==
      "confirmed"
    ) {
      return;
    }

    const start =
      reservation.checkin || reservation.checkIn;

    const end =
      reservation.checkout || reservation.checkOut;

    if (!parseDate(start) || !parseDate(end)) return;

    for (const date of getDates(start, end)) {
      if (blockedDates.has(date)) {
        conflicts.add(date);
      }
    }
  });

  locksSnapshot.forEach(snapshot => {
    const date = snapshot.id;
    const lock = snapshot.data();

    if (
      blockedDates.has(date) &&
      (
        lock.status === "confirmed" ||
        (
          lock.status === "held" &&
          Number(lock.expiresAt) > Date.now()
        )
      )
    ) {
      conflicts.add(date);
    }
  });

  return [...conflicts].sort();
}

async function syncAirbnbCalendar() {
  if (airbnbSyncPromise) {
    return airbnbSyncPromise;
  }

  airbnbSyncPromise = (async () => {
    const calendarText = await fetchAirbnbCalendar();
    const blockedDates = parseAirbnbBlockedDates(
      calendarText
    );

    const collectionRef = db.collection(
      "airbnbBlockedDates"
    );

    const previousSnapshot = await collectionRef.get();

    const previousDates = new Set(
      previousSnapshot.docs.map(snapshot => snapshot.id)
    );

    // Detect conflicts before publishing the new feed.
    const conflicts = await checkAirbnbConflicts(
      blockedDates
    );

    const writer = db.bulkWriter();

    for (const date of blockedDates) {
      writer.set(collectionRef.doc(date), {
        date,
        source: "airbnb",
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    for (const date of previousDates) {
      if (!blockedDates.has(date)) {
        writer.delete(collectionRef.doc(date));
      }
    }

    await writer.close();

    await db.doc("settings/airbnbSync").set({
      status: conflicts.length
        ? "conflict"
        : "success",
      blockedNightCount: blockedDates.size,
      conflicts,
      lastSuccessfulSync: FieldValue.serverTimestamp()
    }, { merge: true });

    if (conflicts.length) {
      console.error(
        "AIRBNB BOOKING CONFLICT DETECTED:",
        conflicts.join(", ")
      );
    }

    console.log(
      `Airbnb synchronized: ${blockedDates.size} blocked nights`
    );

    return {
      blockedNightCount: blockedDates.size,
      conflicts
    };
  })();

  try {
    return await airbnbSyncPromise;
  } catch (error) {
    console.error(
      "Airbnb synchronization failed:",
      error.message
    );

    await db.doc("settings/airbnbSync").set({
      status: "error",
      lastError: error.message,
      lastErrorAt: FieldValue.serverTimestamp()
    }, { merge: true }).catch(console.error);

    throw error;
  } finally {
    airbnbSyncPromise = null;
  }
}

async function requireFreshAirbnbSync() {
  if (!AIRBNB_ICAL_URL) {
    fail("Airbnb availability is not configured.", 503);
  }

  const snapshot = await db.doc(
    "settings/airbnbSync"
  ).get();

  const data = snapshot.data();

  const lastSync =
    data?.lastSuccessfulSync?.toMillis?.();

  if (
    !lastSync ||
    Date.now() - lastSync > AIRBNB_MAX_SYNC_AGE_MS
  ) {
    fail(
      "Live availability is temporarily unavailable. " +
      "Please try again shortly.",
      503
    );
  }

  if (data.status !== "success") {
    fail(
      "Booking availability requires administrator review.",
      503
    );
  }
}

/* =========================================
   PRICING AND BOOKING CALCULATION
========================================= */

function getSeason(date, pricing) {
  if (
    pricing.peakStart &&
    pricing.peakEnd &&
    date >= pricing.peakStart &&
    date <= pricing.peakEnd
  ) {
    return "peak";
  }

  if (
    pricing.easterStart &&
    pricing.easterEnd &&
    date >= pricing.easterStart &&
    date <= pricing.easterEnd
  ) {
    return "high";
  }

  const month = Number(date.slice(5, 7));

  return MONTH_SEASONS[month] || "mid";
}

async function calculateBooking(input) {
  const {
    checkin,
    checkout,
    guests,
    fullName,
    email,
    phone,
    specialRequests
  } = input;

  if (
    !parseDate(checkin) ||
    !parseDate(checkout) ||
    checkin >= checkout
  ) {
    fail("Please select valid booking dates.");
  }

  if (checkin < kenyaToday()) {
    fail("Check-in cannot be in the past.");
  }

  const nights = nightsBetween(checkin, checkout);

  if (nights < 1 || nights > 90) {
    fail("Invalid booking duration.");
  }

  if (!Number.isInteger(guests)) {
    fail("Invalid number of guests.");
  }

  if (
    typeof fullName !== "string" ||
    fullName.trim().length < 2 ||
    fullName.length > 120 ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    typeof phone !== "string" ||
    phone.replace(/\D/g, "").length < 7 ||
    phone.length > 25 ||
    typeof specialRequests !== "string" ||
    specialRequests.length > 1000
  ) {
    fail("Please check your contact details.");
  }

  const snapshot = await db.doc(
    "settings/pricing"
  ).get();

  if (!snapshot.exists) {
    fail("Property pricing is not configured.");
  }

  const pricing = snapshot.data();

  const included = Number(pricing.includedGuests);
  const maximum = Number(pricing.maximumGuests);
  const extraRate = Number(pricing.extraGuestRate);

  if (guests < 1 || guests > maximum) {
    fail(`Maximum ${maximum} guests allowed.`);
  }

  let accommodation = 0;
  let hasPeak = false;

  const dates = getDates(checkin, checkout);

  for (const date of dates) {
    const season = getSeason(date, pricing);
    const rate = Number(pricing.rates?.[season]);

    if (
      !Number.isSafeInteger(rate) ||
      rate <= 0
    ) {
      fail("A nightly rate is not configured.");
    }

    accommodation += rate;

    if (season === "peak") {
      hasPeak = true;
    }
  }

  const minimum = Number(
    hasPeak
      ? pricing.peakMinimumNights
      : pricing.minimumNights
  );

  if (nights < minimum) {
    fail(`Minimum stay is ${minimum} nights.`);
  }

  if (
    !Number.isSafeInteger(extraRate) ||
    extraRate < 0 ||
    !Number.isInteger(included)
  ) {
    fail("Invalid guest pricing configuration.");
  }

  const extraGuests = Math.max(
    0,
    guests - included
  );

  const extraGuestTotal =
    extraGuests * extraRate * nights;

  const total = accommodation + extraGuestTotal;

  if (
    !Number.isSafeInteger(total) ||
    total <= 0
  ) {
    fail("Invalid booking total.");
  }

  return {
    checkin,
    checkout,
    guests,
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    specialRequests: specialRequests.trim(),
    nights,
    accommodation,
    extraGuestTotal,
    total,
    dates
  };
}

/* =========================================
   PAYSTACK API
========================================= */

async function paystack(path, options = {}) {
  const response = await fetch(
    `https://api.paystack.co${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    }
  );

  const result = await response.json();

  if (!response.ok || !result.status) {
    fail(
      result.message || "Paystack request failed.",
      502
    );
  }

  return result.data;
}

/* =========================================
   AVAILABILITY CHECKS
========================================= */

async function checkExternalAvailability(booking) {
  await requireFreshAirbnbSync();

  const [
    blocked,
    reservations,
    airbnbBlocked
  ] = await Promise.all([
    db.collection("blockedDates").get(),
    db.collection("reservations").get(),
    db.collection("airbnbBlockedDates").get()
  ]);

  const unavailable = new Set();

  function addRange(start, end) {
    if (
      !parseDate(start) ||
      !parseDate(end) ||
      start >= end
    ) {
      return;
    }

    for (const date of getDates(start, end)) {
      unavailable.add(date);
    }
  }

  airbnbBlocked.forEach(snapshot => {
    const date =
      snapshot.data().date || snapshot.id;

    if (parseDate(date)) {
      unavailable.add(date);
    }
  });

  blocked.forEach(snapshot => {
    const data = snapshot.data();

    if (parseDate(snapshot.id)) {
      unavailable.add(snapshot.id);
    }

    if (parseDate(data.date)) {
      unavailable.add(data.date);
    }

    if (Array.isArray(data.dates)) {
      data.dates.forEach(date => {
        if (parseDate(date)) {
          unavailable.add(date);
        }
      });
    }

    addRange(
      data.startDate || data.checkin || data.checkIn,
      data.endDate || data.checkout || data.checkOut
    );
  });

  reservations.forEach(snapshot => {
    const data = snapshot.data();

    if (
      String(data.status).toLowerCase() !==
      "confirmed"
    ) {
      return;
    }

    addRange(
      data.checkin || data.checkIn,
      data.checkout || data.checkOut
    );
  });

  if (
    booking.dates.some(date => unavailable.has(date))
  ) {
    fail(
      "Some selected dates are no longer available.",
      409
    );
  }
}

/* =========================================
   ATOMIC BOOKING HOLDS
========================================= */

async function createHold(reference, booking) {
  const expiresAt = Date.now() + HOLD_MS;

  await db.runTransaction(async transaction => {
    const refs = booking.dates.map(date =>
      db.collection("bookingNightLocks").doc(date)
    );

    const airbnbRefs = booking.dates.map(date =>
      db.collection("airbnbBlockedDates").doc(date)
    );

    const manualRefs = booking.dates.map(date =>
      db.collection("blockedDates").doc(date)
    );

    const [
      snapshots,
      airbnbSnapshots,
      manualSnapshots
    ] = await Promise.all([
      Promise.all(refs.map(ref => transaction.get(ref))),
      Promise.all(
        airbnbRefs.map(ref => transaction.get(ref))
      ),
      Promise.all(
        manualRefs.map(ref => transaction.get(ref))
      )
    ]);

    if (
      airbnbSnapshots.some(snapshot => snapshot.exists)
    ) {
      fail(
        "These dates are unavailable through Airbnb.",
        409
      );
    }

    if (
      manualSnapshots.some(snapshot => snapshot.exists)
    ) {
      fail(
        "These dates have been blocked by the property.",
        409
      );
    }

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;

      const lock = snapshot.data();

      if (
        lock.status === "confirmed" ||
        Number(lock.expiresAt) > Date.now()
      ) {
        fail(
          "These dates are currently unavailable.",
          409
        );
      }
    }

    refs.forEach(ref => {
      transaction.set(ref, {
        reference,
        status: "held",
        expiresAt
      });
    });

    transaction.create(
      db.collection("payments").doc(reference),
      {
        reference,
        ...booking,
        status: "pending",
        currency: "KES",
        expiresAt,
        createdAt: FieldValue.serverTimestamp()
      }
    );
  });
}

async function releaseHold(reference, booking) {
  await db.runTransaction(async transaction => {
    const refs = booking.dates.map(date =>
      db.collection("bookingNightLocks").doc(date)
    );

    const snapshots = await Promise.all(
      refs.map(ref => transaction.get(ref))
    );

    snapshots.forEach((snapshot, index) => {
      if (
        snapshot.exists &&
        snapshot.data().reference === reference &&
        snapshot.data().status === "held"
      ) {
        transaction.delete(refs[index]);
      }
    });
  });
}

/* =========================================
   INITIALIZE PAYMENT
========================================= */

app.post("/api/payments/initialize", async (req, res) => {
  let reference;
  let booking;

  try {
    booking = await calculateBooking(req.body);

    await checkExternalAvailability(booking);

    reference = `HHM-${crypto.randomUUID()}`;

    await createHold(reference, booking);

    const payment = await paystack(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: booking.email,
          amount: booking.total * 100,
          currency: "KES",
          reference,
          callback_url:
            `${BACKEND_URL}/api/payments/callback`,
          metadata: {
            booking_reference: reference,
            property: "Hippo House Malindi"
          }
        })
      }
    );

    res.json({
      success: true,
      reference,
      authorization_url: payment.authorization_url
    });

  } catch (error) {
    if (reference && booking) {
      await releaseHold(
        reference,
        booking
      ).catch(console.error);

      await db.collection("payments")
        .doc(reference)
        .update({
          status: "initialization_failed"
        })
        .catch(console.error);
    }

    res.status(error.status || 500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================================
   EMAIL TEMPLATES
========================================= */

function emailTemplate(title, body) {
  return `
    <div style="
      font-family:Arial,sans-serif;
      max-width:600px;
      margin:auto;
      color:#09291e;
      line-height:1.8;
    ">
      <h1 style="
        font-family:Georgia,serif;
        font-weight:normal;
      ">
        Hippo House Malindi
      </h1>

      <div style="
        border-top:2px solid #aa9256;
        padding-top:20px;
      ">
        <h2>${title}</h2>
        ${body}
      </div>

      <p style="
        font-size:12px;
        color:#68776e;
      ">
        Hippo House Malindi · Booking Notifications
      </p>
    </div>
  `;
}

async function sendEmails(payment) {
  const details = `
    <p><strong>Booking reference:</strong>
      ${escapeHtml(payment.reference)}</p>

    <p><strong>Guest:</strong>
      ${escapeHtml(payment.fullName)}</p>

    <p><strong>Email:</strong>
      ${escapeHtml(payment.email)}</p>

    <p><strong>Phone:</strong>
      ${escapeHtml(payment.phone)}</p>

    <p><strong>Check-in:</strong>
      ${escapeHtml(payment.checkin)}</p>

    <p><strong>Check-out:</strong>
      ${escapeHtml(payment.checkout)}</p>

    <p><strong>Nights:</strong>
      ${payment.nights}</p>

    <p><strong>Guests:</strong>
      ${payment.guests}</p>

    <p><strong>Total paid:</strong>
      ${money(payment.total)}</p>

    <p><strong>Special requests:</strong>
      ${escapeHtml(payment.specialRequests || "None")}</p>
  `;

  const paymentRef = db.collection("payments").doc(
    payment.reference
  );

  for (const recipient of ["owner", "guest"]) {
    const field = recipient === "owner"
      ? "ownerEmailSent"
      : "guestEmailSent";

    const current = await paymentRef.get();

    if (current.data()?.[field]) continue;

    const isOwner = recipient === "owner";

    await transporter.sendMail({
      from:
        `"Hippo House Malindi" <${process.env.EMAIL_USER}>`,
      to: isOwner
        ? process.env.OWNER_EMAIL
        : payment.email,
      subject: isOwner
        ? `New Paid Booking — ${payment.reference}`
        : "Booking Confirmed — Hippo House Malindi",
      html: emailTemplate(
        isOwner
          ? "New confirmed reservation"
          : `Your stay is confirmed, ${escapeHtml(payment.fullName)}!`,
        (
          isOwner
            ? "<p>A guest has successfully paid for a reservation.</p>"
            : "<p>Thank you for booking with us. Your payment has been received and your reservation is confirmed.</p>"
        ) + details
      )
    });

    await paymentRef.update({
      [field]: true,
      updatedAt: FieldValue.serverTimestamp()
    });
  }
}

/* =========================================
   VERIFY AND FINALIZE PAYMENT
========================================= */

async function verifyAndFinalize(reference) {
  if (
    typeof reference !== "string" ||
    !/^HHM-[0-9a-f-]{36}$/.test(reference)
  ) {
    fail("Invalid payment reference.");
  }

  const paymentRef = db.collection("payments").doc(
    reference
  );

  const snapshot = await paymentRef.get();

  if (!snapshot.exists) {
    fail("Payment reference not found.", 404);
  }

  const payment = snapshot.data();

  const verified = await paystack(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  if (verified.status !== "success") {
    return {
      success: false,
      status: verified.status
    };
  }

  if (
    verified.reference !== reference ||
    verified.currency !== "KES" ||
    verified.amount !== payment.total * 100 ||
    verified.customer?.email?.toLowerCase() !==
      payment.email
  ) {
    fail(
      "Payment verification details do not match.",
      409
    );
  }

  if (payment.status !== "confirmed") {
    await db.runTransaction(async transaction => {
      const latest = await transaction.get(paymentRef);

      if (latest.data()?.status === "confirmed") {
        return;
      }

      const refs = payment.dates.map(date =>
        db.collection("bookingNightLocks").doc(date)
      );

      const locks = await Promise.all(
        refs.map(ref => transaction.get(ref))
      );

      for (const lock of locks) {
        if (
          !lock.exists ||
          lock.data().reference !== reference
        ) {
          fail(
            "Payment received but dates need manual review.",
            409
          );
        }
      }

      refs.forEach(ref => {
        transaction.set(ref, {
          reference,
          status: "confirmed",
          expiresAt: null
        });
      });

      transaction.set(
        db.collection("reservations").doc(reference),
        {
          reference,
          checkin: payment.checkin,
          checkout: payment.checkout,
          guests: payment.guests,
          fullName: payment.fullName,
          email: payment.email,
          phone: payment.phone,
          specialRequests: payment.specialRequests,
          total: payment.total,
          paymentStatus: "paid",
          status: "confirmed",
          source: "paystack",
          createdAt: FieldValue.serverTimestamp()
        }
      );

      transaction.update(paymentRef, {
        status: "confirmed",
        paidAt: FieldValue.serverTimestamp(),
        paystackTransactionId: verified.id
      });
    });
  }

  try {
    await sendEmails({
      ...payment,
      reference
    });
  } catch (error) {
    console.error(
      "Email delivery failed:",
      error.message
    );
  }

  return {
    success: true,
    status: "confirmed",
    reference
  };
}

/* =========================================
   PAYMENT VERIFICATION ENDPOINT
========================================= */

app.get(
  "/api/payments/verify/:reference",
  async (req, res) => {
    try {
      const result = await verifyAndFinalize(
        req.params.reference
      );

      res.json(result);
    } catch (error) {
      console.error(error);

      res.status(error.status || 500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/* =========================================
   PAYSTACK CALLBACK
========================================= */

app.get("/api/payments/callback", (req, res) => {
  const reference =
    req.query.reference ||
    req.query.trxref;

  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    return res.status(500).send(
      "FRONTEND_URL is not configured."
    );
  }

  const frontendPath = FRONTEND_PATH.replace(
    /^\/|\/$/g,
    ""
  );

  const confirmationUrl = new URL(
    `${
      frontendPath ? frontendPath + "/" : ""
    }book-confirmed.html`,
    FRONTEND_URL + "/"
  );

  if (
    typeof reference === "string" &&
    reference.trim()
  ) {
    confirmationUrl.searchParams.set(
      "payment_reference",
      reference.trim()
    );
  } else {
    confirmationUrl.searchParams.set(
      "error",
      "missing_reference"
    );
  }

  return res.redirect(
    303,
    confirmationUrl.toString()
  );
});

/* =========================================
   PAYSTACK WEBHOOK
========================================= */

app.post("/api/payments/webhook", (req, res) => {
  const signature = req.headers[
    "x-paystack-signature"
  ];

  const expected = crypto
    .createHmac("sha512", SECRET)
    .update(req.rawBody)
    .digest("hex");

  const supplied =
    typeof signature === "string"
      ? signature
      : "";

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(expected)
    )
  ) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  if (req.body.event === "charge.success") {
    const reference = req.body.data?.reference;

    verifyAndFinalize(reference).catch(error => {
      console.error(
        "Webhook finalization:",
        error
      );
    });
  }
});

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Hippo House Malindi Backend"
  });
});

/* =========================================
   START SERVER AND AIRBNB SYNC
========================================= */

app.listen(PORT, () => {
  console.log(
    `Hippo House backend running on port ${PORT}`
  );

  syncAirbnbCalendar().catch(error => {
    console.error(
      "Initial Airbnb synchronization failed:",
      error.message
    );
  });

  setInterval(() => {
    syncAirbnbCalendar().catch(error => {
      console.error(
        "Scheduled Airbnb synchronization failed:",
        error.message
      );
    });
  }, AIRBNB_SYNC_MS);
});
