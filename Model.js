// Date maths and formatting stay outside QML so the whole contract is testable
// under plain node. Every function takes `now` as a parameter rather than
// reading the clock, so each state -- eighty days out, the final hour, release
// day, a year afterwards -- is one assertion instead of a mocked clock.

var RELEASE_DATE = "2026-11-19"
// Rockstar opened pre-orders at local midnight and pre-load follows the same
// rule, exactly one week ahead of launch. Deriving it keeps the second date
// sensible for anyone who retargets `releaseDate` after another delay.
var PRELOAD_LEAD_DAYS = 7
var OFFICIAL_URL = "https://www.rockstargames.com/VI"
// Glyphs are written as escapes rather than pasted, so a stray private-use
// byte can never ride along invisibly in the source.
var GLYPH = "\udb80\ude97"      // nf-md-google_controller
var LINK_GLYPH = "\udb80\udfcc" // nf-md-open_in_new
var DATE_GLYPH = "\udb80\udced" // nf-md-calendar_month
var COPY_GLYPH = "\udb80\udd8f" // nf-md-content_copy
var CHECK_GLYPH = "\udb80\udd2c" // nf-md-check

// Kept here so the panel, the tests and the manifest can be checked against one
// another; a countdown that names the wrong id in its own removal command is a
// small thing that would go unnoticed until the one moment it is read.
var PLUGIN_ID = "io.github.xgborgeso.gta6-countdown"
var REMOVE_COMMAND = "omarchy plugin remove " + PLUGIN_ID

var MS_MINUTE = 60000
var MS_HOUR = 3600000
var MS_DAY = 86400000

var FIELD_LIMIT = 96

var MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]

// Nothing here renders vendor-supplied text, but `releaseDate` is user input
// that reaches a notification body, and the notification card renders markup.
// Strip rather than trust any one sink.
function safeText(value, limit) {
  var text = value === null || value === undefined ? "" : String(value)
  text = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[<>]/g, "")
  text = text.split(/\s+/).join(" ").trim()
  var cap = limit || FIELD_LIMIT
  return text.length > cap ? text.slice(0, cap).replace(/\s+\S*$/, "") : text
}

function pad2(n) {
  var v = Math.abs(Math.round(n))
  return v < 10 ? "0" + v : String(v)
}

// Strict YYYY-MM-DD. parseInt would salvage "2026-11-19junk" and Date's own
// parser would read a bare "2026-11-19" as UTC midnight, which is the wrong
// instant in every timezone west of Greenwich.
function parseDate(text) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || "").trim())
  if (!match) return { ok: false, year: 0, month: 0, day: 0 }
  var year = Number(match[1])
  var month = Number(match[2])
  var day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, year: 0, month: 0, day: 0 }
  }
  // Round-trip so 2026-02-30 fails instead of rolling into March.
  var probe = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1
      || probe.getDate() !== day) {
    return { ok: false, year: 0, month: 0, day: 0 }
  }
  return { ok: true, year: year, month: month, day: day }
}

// Local midnight, not UTC. Rockstar gates pre-orders, pre-load and launch at
// local midnight, so the local day boundary is the honest target.
function targetMs(text) {
  var parsed = parseDate(text)
  if (!parsed.ok) return NaN
  return new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).getTime()
}

function resolveTarget(text) {
  var wanted = String(text || "").trim()
  if (wanted === "") return { ok: true, ms: targetMs(RELEASE_DATE), date: RELEASE_DATE, error: "" }
  var ms = targetMs(wanted)
  if (isFinite(ms)) return { ok: true, ms: ms, date: wanted, error: "" }
  return {
    ok: false,
    ms: targetMs(RELEASE_DATE),
    date: RELEASE_DATE,
    error: "Bad release date " + safeText(wanted, 24) + ", using " + RELEASE_DATE
  }
}

function preloadMs(target) {
  return target - PRELOAD_LEAD_DAYS * MS_DAY
}

function localMidnight(ms) {
  var d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
}

function localDayKey(ms) {
  var d = new Date(ms)
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
}

function localHour(ms) {
  return new Date(ms).getHours()
}

// How many sleeps away the date is, which is what a person means by "days
// left". Rounding absorbs the 23- and 25-hour days a DST shift produces
// between here and November.
function calendarDaysUntil(nowMs, target) {
  return Math.round((localMidnight(target) - localMidnight(nowMs)) / MS_DAY)
}

// `days`/`hours`/`minutes` are exact time remaining and drive the ticking chip.
// `calendarDays` is the sleeps count and drives every bare number and every
// notification. Below one day out they agree; above it the exact figure reads
// one lower, which is why the panel shows both together rather than picking.
function countdown(nowMs, target) {
  var remaining = target - nowMs
  var released = remaining <= 0
  var span = released ? 0 : remaining
  return {
    released: released,
    remainingMs: remaining,
    days: Math.floor(span / MS_DAY),
    hours: Math.floor((span % MS_DAY) / MS_HOUR),
    minutes: Math.floor((span % MS_HOUR) / MS_MINUTE),
    calendarDays: Math.max(0, calendarDaysUntil(nowMs, target)),
    daysSince: released ? Math.floor((nowMs - target) / MS_DAY) : 0,
    preloadOpen: nowMs >= preloadMs(target)
  }
}

function formatDate(text) {
  var parsed = parseDate(text)
  if (!parsed.ok) return safeText(text, 24)
  return MONTHS[parsed.month - 1] + " " + parsed.day + ", " + parsed.year
}

// The bar chip. "icon" is the default and shows nothing but the glyph, which
// keeps the widget the same width as every other icon in the bar; the reading
// moves to the tooltip and the panel. "days" is the sleeps count so a bare
// number matches what a person would say out loud; "dhm" is exact remaining.
function formatBar(cd, format) {
  if (String(format) === "icon") return ""
  if (cd.released) return "OUT NOW"
  if (String(format) === "days") return String(cd.calendarDays)
  if (cd.days > 0) {
    return cd.days + "d " + pad2(cd.hours) + "h " + pad2(cd.minutes) + "m"
  }
  return pad2(cd.hours) + "h " + pad2(cd.minutes) + "m"
}

// With the chip reduced to a glyph, the tooltip is where the reading lives, so
// it carries the exact figure the bar used to show.
function formatTooltip(cd, dateText) {
  var head = "Grand Theft Auto VI"
  if (cd.released) return head + " \u00b7 out now \u00b7 " + formatDate(dateText)
  return head + " \u00b7 " + formatBar(cd, "dhm") + " \u00b7 " + formatDate(dateText)
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s")
}

// The hero line: the sleeps count, spelled out.
function formatHeadline(cd) {
  if (cd.released) {
    if (cd.daysSince === 0) return "Out now"
    return "Out " + plural(cd.daysSince, "day") + " ago"
  }
  if (cd.calendarDays === 0) return "Today"
  if (cd.calendarDays === 1) return "Tomorrow"
  return plural(cd.calendarDays, "day")
}

// The exact figure, shown under the hero so the two numbers explain each other.
function formatExact(cd) {
  if (cd.released) return "Released"
  if (cd.days > 0) {
    return cd.days + "d " + pad2(cd.hours) + "h " + pad2(cd.minutes) + "m remaining"
  }
  return pad2(cd.hours) + "h " + pad2(cd.minutes) + "m remaining"
}

// The panel's subtitle, picked at random each time it opens. Tiers are keyed on
// the sleeps count so the tone escalates as launch approaches: a practical nudge
// like checking your storage is useful at ninety days and noise at three
// hundred. Edit the phrases here and nothing else needs to change.
var PHRASE_TIERS = [
  {
    minDays: 181,
    phrases: [
      "Sit tight",
      "A long con takes time",
      "Not yet, not nearly",
      "Plenty of time to save up",
      "Distant, but real"
    ]
  },
  {
    minDays: 91,
    phrases: [
      "It's coming",
      "Close enough to feel it",
      "The wait has a shape now",
      "Start clearing the drive",
      "A map is being finished"
    ]
  },
  {
    minDays: 31,
    phrases: [
      "Getting warm",
      "Under three months",
      "This is actually happening",
      "Check your storage",
      "A real countdown now"
    ]
  },
  {
    minDays: 15,
    phrases: [
      "Getting hot!",
      "Weeks, not months",
      "Schedule your vacation",
      "Warn your manager",
      "Warn everyone you know"
    ]
  },
  {
    minDays: 8,
    phrases: [
      "Almost there",
      "Two weeks out",
      "Book the time off",
      "Stock the fridge",
      "Nearly"
    ]
  },
  {
    minDays: 4,
    phrases: [
      "Pre-load is live",
      "Clear the drive, properly",
      "One week. One week.",
      "Sleep is optional soon",
      "Final approach"
    ]
  },
  {
    minDays: 1,
    phrases: [
      "Any moment now",
      "This is not a drill",
      "Clear your calendar",
      "Set an alarm anyway",
      "Almost tomorrow"
    ]
  }
]

var RELEASED_PHRASES = [
  "Go",
  "Out now",
  "Stop reading the bar",
  "Why are you still here",
  "Nothing left to count"
]

function phrasesFor(cd) {
  if (!cd || cd.released) return RELEASED_PHRASES
  for (var i = 0; i < PHRASE_TIERS.length; i++) {
    if (cd.calendarDays >= PHRASE_TIERS[i].minDays) return PHRASE_TIERS[i].phrases
  }
  return PHRASE_TIERS[PHRASE_TIERS.length - 1].phrases
}

// Picking is kept here so the panel does not have to hold an index across a
// tier change, where the old index could point past the end of the new list.
function pickPhrase(cd, previous) {
  var list = phrasesFor(cd)
  if (list.length === 0) return ""
  if (list.length === 1) return list[0]
  var choice = list[Math.floor(Math.random() * list.length)]
  if (choice === previous) {
    choice = list[(list.indexOf(previous) + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length]
  }
  return choice
}

// Whether the panel prints the exact figure under the big number. At eighty
// days out, precision to the minute is noise beneath a number that already
// answers the question, and showing both invites the reader to notice they
// disagree by one. In the last two days the minutes are the whole point, so
// "auto" holds the line back until then. The tooltip carries it throughout.
function showsExactLine(cd, format) {
  if (format === "both") return true
  if (format === "auto") return !!cd && !cd.released && cd.calendarDays <= 2
  // "days" and "exact" both print a single line, and an unrecognised value has
  // to land on the same default the service falls back to, or the panel and the
  // setting would disagree about what is on screen.
  return false
}

// Milestones key on the sleeps count, so each fires on exactly one calendar
// day. Wording avoids repeating a figure the ticking chip would contradict.
var MILESTONES = [
  { days: 365, text: "One year to go" },
  { days: 300, text: "300 days to go" },
  { days: 200, text: "200 days to go" },
  { days: 100, text: "100 days to go" },
  { days: 50, text: "50 days to go" },
  { days: 30, text: "One month to go" },
  { days: 14, text: "Two weeks to go" },
  { days: PRELOAD_LEAD_DAYS, text: "Pre-load is open" },
  { days: 3, text: "Three days to go" },
  { days: 2, text: "Two days to go" },
  { days: 1, text: "Tomorrow" }
]

function milestoneFor(calendarDays) {
  for (var i = 0; i < MILESTONES.length; i++) {
    if (MILESTONES[i].days === calendarDays) return MILESTONES[i]
  }
  return null
}

function notifyHeadline(cd) {
  if (cd.released) return "Grand Theft Auto VI is out"
  var milestone = milestoneFor(cd.calendarDays)
  if (milestone) return milestone.text
  return "Grand Theft Auto VI"
}

function notifyBody(cd, dateText) {
  if (cd.released) return formatDate(dateText) + " · out now"
  return formatHeadline(cd) + " · " + formatDate(dateText)
}

// One notification per local day, on the first tick at or after `hour`. Booting
// at 14:00 fires immediately; a machine left on overnight fires at `hour`
// rather than at midnight. The caller persists `state` so restarting the shell
// five times in a morning does not toast five times.
function notifyPlan(nowMs, state, options) {
  var opts = options || {}
  var mode = String(opts.mode || "daily")
  var hour = opts.hour
  if (typeof hour !== "number" || !isFinite(hour)) hour = 9
  var next = { lastKey: state && state.lastKey ? String(state.lastKey) : "" }
  if (mode === "off") return { state: next, due: null }

  var cd = countdown(nowMs, opts.target)
  // Release day still gets its toast; after that the countdown has nothing
  // left to say and stops speaking.
  if (cd.released && cd.daysSince > 0) return { state: next, due: null }

  var key = localDayKey(nowMs)
  if (next.lastKey === key) return { state: next, due: null }
  if (localHour(nowMs) < hour) return { state: next, due: null }
  if (mode === "milestones" && !cd.released && !milestoneFor(cd.calendarDays)) {
    return { state: next, due: null }
  }

  next.lastKey = key
  return {
    state: next,
    due: {
      headline: notifyHeadline(cd),
      body: notifyBody(cd, opts.date),
      urgency: cd.released || cd.calendarDays <= 1 ? "critical" : "normal"
    }
  }
}

// What the panel says once the date has passed. The widget has done its job and
// the honest thing is to say so and offer the way out, rather than sit on the
// bar counting upwards until someone wonders what it is for.
function farewellText(cd, hideAfterDays) {
  if (!cd || !cd.released) return ""
  if (cd.daysSince === 0) return "Go and play. You can remove this whenever."
  var left = hideAfterDays > 0 ? hideAfterDays - cd.daysSince : 0
  if (hideAfterDays > 0 && left <= 0) return "Nothing left to count."
  if (hideAfterDays > 0 && left === 1) return "Nothing left to count. Retiring tomorrow."
  if (hideAfterDays > 0) {
    return "Nothing left to count. Retiring in " + plural(left, "day") + "."
  }
  return "Nothing left to count."
}

function errorText(value) {
  return safeText(value, 160)
}

if (typeof module !== "undefined") {
  module.exports = {
    RELEASE_DATE: RELEASE_DATE,
    PRELOAD_LEAD_DAYS: PRELOAD_LEAD_DAYS,
    OFFICIAL_URL: OFFICIAL_URL,
    PLUGIN_ID: PLUGIN_ID,
    REMOVE_COMMAND: REMOVE_COMMAND,
    farewellText: farewellText,
    GLYPH: GLYPH,
    LINK_GLYPH: LINK_GLYPH,
    DATE_GLYPH: DATE_GLYPH,
    COPY_GLYPH: COPY_GLYPH,
    CHECK_GLYPH: CHECK_GLYPH,
    MS_DAY: MS_DAY,
    MILESTONES: MILESTONES,
    safeText: safeText,
    pad2: pad2,
    parseDate: parseDate,
    targetMs: targetMs,
    resolveTarget: resolveTarget,
    preloadMs: preloadMs,
    localMidnight: localMidnight,
    localDayKey: localDayKey,
    localHour: localHour,
    calendarDaysUntil: calendarDaysUntil,
    countdown: countdown,
    formatDate: formatDate,
    formatBar: formatBar,
    formatTooltip: formatTooltip,
    formatHeadline: formatHeadline,
    formatExact: formatExact,
    showsExactLine: showsExactLine,
    PHRASE_TIERS: PHRASE_TIERS,
    RELEASED_PHRASES: RELEASED_PHRASES,
    phrasesFor: phrasesFor,
    pickPhrase: pickPhrase,
    milestoneFor: milestoneFor,
    notifyHeadline: notifyHeadline,
    notifyBody: notifyBody,
    notifyPlan: notifyPlan,
    errorText: errorText
  }
}
