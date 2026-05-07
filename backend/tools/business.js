// Business-hour and delivery-date helpers. All times are in Colombia (UTC-5,
// no DST) — we compute against that fixed offset rather than the host TZ.
const COT_OFFSET_MINUTES = -5 * 60;

function nowInCOT() {
  const now = new Date();
  return new Date(now.getTime() + (COT_OFFSET_MINUTES - now.getTimezoneOffset()) * -60000);
}

// Returns { dayOfWeek, hour, minute, isWeekday, withinHours, beforeCutoff }
export function businessClock(date = nowInCOT()) {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0=Sun .. 6=Sat
  const hour = d.getHours();
  const minute = d.getMinutes();

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const withinHours = isWeekday && hour >= 8 && hour < 17;
  const beforeCutoff = isWeekday && (hour < 9 || (hour === 9 && minute === 0));

  return { date: d, dayOfWeek, hour, minute, isWeekday, withinHours, beforeCutoff };
}

// Compute the delivery date a customer should expect for an order placed *now*.
// Rules: same-day if weekday before 09:00. After 09:00 on Mon–Thu → next day.
// After 09:00 on Friday → Monday. Weekends or after-hours → next business day,
// or same-day if placed before that day's 09:00.
export function computeDeliveryDate(now = nowInCOT()) {
  const clock = businessClock(now);
  const { dayOfWeek, hour } = clock;

  // Same-day: weekday, after open and before cutoff
  if (clock.isWeekday && hour >= 8 && hour < 9) {
    return { date: toDateString(now), label: 'hoy mismo', sameDay: true };
  }

  // After cutoff on a weekday → next business day
  let advance = 1;
  if (dayOfWeek === 5 && hour >= 9) advance = 3; // Fri after 9 → Mon
  else if (dayOfWeek === 6) advance = 2;          // Sat → Mon
  else if (dayOfWeek === 0) advance = 1;          // Sun → Mon

  const target = new Date(now);
  target.setDate(target.getDate() + advance);
  return { date: toDateString(target), label: 'el siguiente día hábil', sameDay: false };
}

function toDateString(d) {
  // YYYY-MM-DD in COT
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Returns a friendly tag the bot can use in copy.
export function deliveryWindowLabel(now = nowInCOT()) {
  const clock = businessClock(now);
  if (!clock.isWeekday || !clock.withinHours) return 'fuera_de_horario';
  if (clock.beforeCutoff) return 'antes_de_cutoff';
  if (clock.dayOfWeek === 5) return 'viernes_despues_cutoff';
  return 'despues_de_cutoff';
}
