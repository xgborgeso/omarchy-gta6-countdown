// Every assertion here is a pure function call against a fixed instant, so the
// suite is deterministic. Timezone is the one thing that is not: half of what
// this file checks is local-midnight behaviour, which a runner in UTC would
// silently agree with a bug about. So the suite re-runs itself once per zone,
// with a southern-hemisphere zone (DST starts, not ends, before launch) and a
// half-hour offset among them.
//
// Checks split in two. Zone-invariant properties -- parsing, one toast a day,
// each milestone exactly once -- must hold everywhere. Exact wall-clock strings
// depend on where the DST boundaries fall, so they run only in the pinned zone.
const ZONES = [
  "UTC",
  "America/New_York",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Pacific/Auckland",
  "America/Sao_Paulo"
]
const PINNED_ZONE = "America/New_York"

if (!process.env.GTA6_ZONE) {
  const { spawnSync } = require("child_process")
  let failed = 0
  for (const zone of ZONES) {
    const result = spawnSync(process.execPath, [__filename], {
      stdio: "inherit",
      env: Object.assign({}, process.env, { GTA6_ZONE: zone, TZ: zone })
    })
    if (result.status !== 0) failed++
  }
  process.exit(failed === 0 ? 0 : 1)
}

const assert = require("assert")
const Model = require("../Model.js")

const ZONE = process.env.GTA6_ZONE
const pinned = ZONE === PINNED_ZONE

let checks = 0
let skipped = 0
function check(name, fn) {
  fn()
  checks++
}
// A check whose expected value is a specific wall clock reading.
function checkPinned(name, fn) {
  if (!pinned) { skipped++; return }
  fn()
  checks++
}

const RELEASE = Model.RELEASE_DATE
const TARGET = Model.targetMs(RELEASE)

// A local wall-clock instant, which is what the widget actually sees.
function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0).getTime()
}

/* ---------------------------------------------------------------- parsing */

check("the shipped date is the confirmed one", () => {
  assert.strictEqual(RELEASE, "2026-11-19")
  assert.strictEqual(Model.PRELOAD_LEAD_DAYS, 7)
  assert.strictEqual(Model.OFFICIAL_URL, "https://www.rockstargames.com/VI")
})

check("parseDate takes only strict YYYY-MM-DD", () => {
  assert.strictEqual(Model.parseDate("2026-11-19").ok, true)
  for (const bad of ["", "2026-11-19junk", "2026-2-19", "19-11-2026", "2026/11/19",
                     "2026-13-01", "2026-00-10", "2026-11-00", "2026-11-32",
                     "not a date", null, undefined, {}]) {
    assert.strictEqual(Model.parseDate(bad).ok, false, "should reject " + String(bad))
  }
})

check("parseDate rejects a day the month does not have", () => {
  // Date would roll 02-30 into March rather than fail, so the round-trip guard
  // is the only thing standing between a typo and a silently wrong countdown.
  assert.strictEqual(Model.parseDate("2026-02-30").ok, false)
  assert.strictEqual(Model.parseDate("2026-04-31").ok, false)
  assert.strictEqual(Model.parseDate("2026-02-28").ok, true)
  assert.strictEqual(Model.parseDate("2028-02-29").ok, true, "2028 is a leap year")
  assert.strictEqual(Model.parseDate("2026-02-29").ok, false, "2026 is not")
})

check("targetMs lands on local midnight, not UTC midnight", () => {
  const d = new Date(TARGET)
  assert.strictEqual(d.getFullYear(), 2026)
  assert.strictEqual(d.getMonth(), 10)
  assert.strictEqual(d.getDate(), 19)
  assert.strictEqual(d.getHours(), 0)
  assert.strictEqual(d.getMinutes(), 0)
  // Only meaningful where local midnight is not UTC midnight -- in UTC itself
  // the two coincide, and asserting a difference there would be a tautology
  // dressed up as a test.
  if (d.getTimezoneOffset() !== 0) {
    assert.notStrictEqual(TARGET, Date.parse("2026-11-19T00:00:00Z"),
      "a UTC reading would be the wrong instant outside Greenwich")
  }
})

check("a bad releaseDate setting falls back instead of breaking", () => {
  const bad = Model.resolveTarget("tomorrow please")
  assert.strictEqual(bad.ok, false)
  assert.strictEqual(bad.ms, TARGET, "still counts to the shipped date")
  assert.ok(bad.error.indexOf("2026-11-19") >= 0)

  const empty = Model.resolveTarget("")
  assert.strictEqual(empty.ok, true)
  assert.strictEqual(empty.ms, TARGET)

  const custom = Model.resolveTarget("2027-05-26")
  assert.strictEqual(custom.ok, true)
  assert.strictEqual(custom.ms, Model.targetMs("2027-05-26"))
})

check("a hostile releaseDate cannot reach a notification body as markup", () => {
  const nasty = Model.resolveTarget("<img src=x onerror=alert(1)>")
  assert.strictEqual(nasty.error.indexOf("<"), -1)
  assert.strictEqual(nasty.error.indexOf(">"), -1)
})

/* -------------------------------------------------------------- countdown */

check("exact remaining and the sleeps count differ by design", () => {
  // 09:00 on the 12th: seven sleeps to the 19th, but only 6d15h of clock.
  const cd = Model.countdown(at(2026, 11, 12, 9, 0), TARGET)
  assert.strictEqual(cd.calendarDays, 7, "seven sleeps")
  assert.strictEqual(cd.days, 6, "but under seven whole days of clock")
  assert.strictEqual(cd.hours, 15)
  assert.strictEqual(cd.minutes, 0)
  assert.strictEqual(cd.released, false)
})

check("at local midnight the two agree", () => {
  const cd = Model.countdown(at(2026, 11, 12, 0, 0), TARGET)
  assert.strictEqual(cd.calendarDays, 7)
  assert.strictEqual(cd.days, 7)
  assert.strictEqual(cd.hours, 0)
})

check("the final day counts down in hours", () => {
  const cd = Model.countdown(at(2026, 11, 18, 22, 18), TARGET)
  assert.strictEqual(cd.days, 0)
  assert.strictEqual(cd.hours, 1)
  assert.strictEqual(cd.minutes, 42)
  assert.strictEqual(cd.calendarDays, 1, "still tomorrow")
  assert.strictEqual(cd.released, false)
})

check("release lands exactly at local midnight", () => {
  const justBefore = Model.countdown(TARGET - 1, TARGET)
  assert.strictEqual(justBefore.released, false)
  assert.strictEqual(justBefore.hours, 0)
  assert.strictEqual(justBefore.minutes, 0)

  const onTheDot = Model.countdown(TARGET, TARGET)
  assert.strictEqual(onTheDot.released, true)
  assert.strictEqual(onTheDot.daysSince, 0)
})

check("after release it counts up, and never shows negatives", () => {
  const later = Model.countdown(at(2026, 12, 25, 12, 0), TARGET)
  assert.strictEqual(later.released, true)
  assert.strictEqual(later.daysSince, 36)
  assert.strictEqual(later.days, 0)
  assert.strictEqual(later.hours, 0)
  assert.strictEqual(later.calendarDays, 0, "clamped, never negative")
})

check("pre-load opens one week out, at local midnight", () => {
  assert.strictEqual(Model.preloadMs(TARGET), Model.targetMs("2026-11-12"))
  assert.strictEqual(Model.countdown(at(2026, 11, 11, 23, 59), TARGET).preloadOpen, false)
  assert.strictEqual(Model.countdown(at(2026, 11, 12, 0, 0), TARGET).preloadOpen, true)
})

check("the sleeps count survives a DST transition", () => {
  // US clocks fall back on 2026-11-01, making that local day 25 hours long.
  // Dividing raw milliseconds would lose an hour and round the wrong way.
  assert.strictEqual(Model.calendarDaysUntil(at(2026, 10, 30, 12, 0), TARGET), 20)
  assert.strictEqual(Model.calendarDaysUntil(at(2026, 11, 1, 12, 0), TARGET), 18)
  assert.strictEqual(Model.calendarDaysUntil(at(2026, 11, 18, 23, 59), TARGET), 1)
  assert.strictEqual(Model.calendarDaysUntil(at(2026, 11, 19, 0, 0), TARGET), 0)
})

check("every calendar day between here and launch is counted exactly once", () => {
  // Walk noon to noon and assert the sleeps count falls by exactly one a day,
  // right across the DST boundary.
  let day = at(2026, 8, 28, 12, 0)
  let expected = Model.calendarDaysUntil(day, TARGET)
  const seen = new Set()
  while (expected > 0) {
    const got = Model.calendarDaysUntil(day, TARGET)
    assert.strictEqual(got, expected, "at " + new Date(day).toString())
    assert.strictEqual(seen.has(got), false, "counted " + got + " twice")
    seen.add(got)
    day += Model.MS_DAY
    // Re-anchor to local noon so a 23/25-hour day cannot drift the walk.
    const d = new Date(day)
    day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime()
    expected -= 1
  }
  assert.strictEqual(expected, 0)
  assert.strictEqual(seen.size, 83, "83 sleeps from 2026-08-28")
})

/* -------------------------------------------------------------- formatting */

checkPinned("the bar chip renders the chosen shape", () => {
  // 10h, not the 9h42m a naive wall-clock subtraction gives: clocks fall back
  // on 2026-11-01, so there is one more real hour of waiting than the calendar
  // suggests. The chip counts elapsed time, so it is right to show it.
  const far = Model.countdown(at(2026, 8, 28, 14, 18), TARGET)
  assert.strictEqual(Model.formatBar(far, "dhm"), "82d 10h 42m")
  assert.strictEqual(Model.formatBar(far, "days"), "83", "bare number is the sleeps count")

  const finalDay = Model.countdown(at(2026, 11, 18, 22, 18), TARGET)
  assert.strictEqual(Model.formatBar(finalDay, "dhm"), "01h 42m", "days drop off")
  assert.strictEqual(Model.formatBar(finalDay, "days"), "1")

  const out = Model.countdown(TARGET, TARGET)
  assert.strictEqual(Model.formatBar(out, "dhm"), "OUT NOW")
  assert.strictEqual(Model.formatBar(out, "days"), "OUT NOW")
})

check("the default icon format puts no text in the bar at all", () => {
  // The shipped default. A ticking string is wider than every other chip and
  // shoves its neighbours sideways once a minute, so the reading lives in the
  // tooltip and the panel instead.
  for (const when of [at(2026, 8, 28, 14, 18), at(2026, 11, 18, 23, 0), TARGET]) {
    assert.strictEqual(Model.formatBar(Model.countdown(when, TARGET), "icon"), "")
  }
})

check("the tooltip carries what the chip stopped showing", () => {
  const tip = Model.formatTooltip(Model.countdown(at(2026, 11, 12, 9, 0), TARGET), RELEASE)
  assert.ok(tip.indexOf("Grand Theft Auto VI") >= 0)
  assert.ok(tip.indexOf("6d 15h 00m") >= 0, "the exact figure is still reachable")
  assert.ok(tip.indexOf("November 19, 2026") >= 0)

  const out = Model.formatTooltip(Model.countdown(TARGET, TARGET), RELEASE)
  assert.ok(out.indexOf("out now") >= 0)
})

check("auto holds the exact line back until the minutes matter", () => {
  const on = d => Model.showsExactLine({ released: false, calendarDays: d }, "auto")
  assert.strictEqual(on(83), false, "noise at eighty days out")
  assert.strictEqual(on(7), false)
  assert.strictEqual(on(3), false)
  assert.strictEqual(on(2), true, "the final two days earn it")
  assert.strictEqual(on(1), true)
  assert.strictEqual(on(0), true)
  assert.strictEqual(Model.showsExactLine({ released: true, daysSince: 0 }, "auto"), false,
    "nothing to count once it is out")
})

check("the explicit panel formats override auto in both directions", () => {
  const far = { released: false, calendarDays: 83 }
  const near = { released: false, calendarDays: 1 }
  assert.strictEqual(Model.showsExactLine(far, "both"), true, "both always shows it")
  assert.strictEqual(Model.showsExactLine(near, "days"), false, "days never does")
  assert.strictEqual(Model.showsExactLine(near, "exact"), false, "exact is the big line instead")
  // An unrecognised value has to land where Service.qml's own fallback lands,
  // or the panel and the setting disagree about what is on screen.
  assert.strictEqual(Model.showsExactLine(near, "nonsense"), false)
  assert.strictEqual(Model.showsExactLine(far, "nonsense"), false)
})

checkPinned("the shipped default is a single line of exact time", () => {
  // What the panel actually shows out of the box: one big ticking figure and
  // nothing beneath it.
  const cd = Model.countdown(at(2026, 8, 28, 14, 18), TARGET)
  assert.strictEqual(Model.showsExactLine(cd, "exact"), false, "no second line")
  assert.strictEqual(Model.formatBar(cd, "dhm"), "82d 10h 42m", "and this is the big one")
})

check("hours and minutes are zero padded, days are not", () => {
  const cd = Model.countdown(at(2026, 11, 15, 20, 5), TARGET)
  assert.strictEqual(Model.formatBar(cd, "dhm"), "3d 03h 55m")
})

check("the panel shows both numbers so they explain each other", () => {
  const cd = Model.countdown(at(2026, 11, 12, 9, 0), TARGET)
  assert.strictEqual(Model.formatHeadline(cd), "7 days")
  assert.strictEqual(Model.formatExact(cd), "6d 15h 00m remaining")
})

check("the headline reads naturally at the edges", () => {
  assert.strictEqual(Model.formatHeadline(Model.countdown(at(2026, 11, 18, 9, 0), TARGET)), "Tomorrow")
  assert.strictEqual(Model.formatHeadline(Model.countdown(at(2026, 11, 19, 9, 0), TARGET)), "Out now")
  assert.strictEqual(Model.formatHeadline(Model.countdown(at(2026, 11, 20, 9, 0), TARGET)), "Out 1 day ago")
  assert.strictEqual(Model.formatHeadline(Model.countdown(at(2026, 11, 21, 9, 0), TARGET)), "Out 2 days ago")
})

check("the date renders long form, and a broken one does not crash it", () => {
  assert.strictEqual(Model.formatDate("2026-11-19"), "November 19, 2026")
  assert.strictEqual(Model.formatDate("2026-01-01"), "January 1, 2026")
  assert.strictEqual(Model.formatDate("nonsense"), "nonsense")
})

/* ---------------------------------------------------------------- farewell */

check("nothing is said about removal while the countdown still has a job", () => {
  for (const when of [at(2026, 8, 28, 9, 0), at(2026, 11, 18, 23, 59)]) {
    assert.strictEqual(Model.farewellText(Model.countdown(when, TARGET), 30), "")
  }
})

check("release day points at the game, not at the uninstall", () => {
  const text = Model.farewellText(Model.countdown(at(2026, 11, 19, 9, 0), TARGET), 30)
  assert.strictEqual(text, "Go and play. You can remove this whenever.")
})

check("afterwards it says how long it has left before retiring itself", () => {
  const on = d => Model.farewellText(Model.countdown(at(2026, 11, d, 9, 0), TARGET), 30)
  assert.strictEqual(on(20), "Nothing left to count. Retiring in 29 days.")
  assert.strictEqual(on(29), "Nothing left to count. Retiring in 20 days.")
  // Day 30 after release is the retirement day itself.
  assert.strictEqual(Model.farewellText({ released: true, daysSince: 29 }, 30),
    "Nothing left to count. Retiring tomorrow.")
  assert.strictEqual(Model.farewellText({ released: true, daysSince: 30 }, 30),
    "Nothing left to count.")
})

check("with retirement switched off it does not promise to leave", () => {
  const text = Model.farewellText({ released: true, daysSince: 400 }, 0)
  assert.strictEqual(text, "Nothing left to count.")
  assert.strictEqual(text.indexOf("Retiring"), -1)
})

check("the removal command names this plugin and nothing else", () => {
  assert.strictEqual(Model.REMOVE_COMMAND, "omarchy plugin remove " + Model.PLUGIN_ID)
  // A command a user is invited to paste must be a plain single line.
  assert.strictEqual(Model.REMOVE_COMMAND, Model.safeText(Model.REMOVE_COMMAND, 200))
  assert.strictEqual(Model.REMOVE_COMMAND.indexOf("\n"), -1)
})

/* ----------------------------------------------------------------- phrases */

check("every day from a year out to launch lands on a populated tier", () => {
  // A tier boundary off by one would leave a day with no subtitle at all, and
  // the panel would show an empty line rather than anything obviously broken.
  for (let d = 0; d <= 400; d++) {
    const cd = { released: false, calendarDays: d }
    const list = Model.phrasesFor(cd)
    assert.ok(Array.isArray(list) && list.length >= 3,
      "day " + d + " has no usable phrase tier")
  }
})

check("the tiers escalate in the right order", () => {
  const on = d => Model.phrasesFor({ released: false, calendarDays: d })
  assert.ok(on(300).indexOf("Sit tight") >= 0)
  assert.ok(on(120).indexOf("It's coming") >= 0)
  assert.ok(on(60).indexOf("Check your storage") >= 0)
  assert.ok(on(20).indexOf("Getting hot!") >= 0)
  assert.ok(on(10).indexOf("Almost there") >= 0)
  assert.ok(on(6).indexOf("Pre-load is live") >= 0, "pre-load week says so")
  assert.ok(on(2).indexOf("This is not a drill") >= 0)
  assert.ok(Model.phrasesFor({ released: true, calendarDays: 0 }).indexOf("Go") >= 0)
})

check("the pre-load tier covers exactly the pre-load week", () => {
  // The tier and the milestone have to agree, or the panel congratulates you
  // on pre-load being live a day before the notification says it opened.
  const preload = d => Model.phrasesFor({ released: false, calendarDays: d })
    .indexOf("Pre-load is live") >= 0
  assert.strictEqual(preload(Model.PRELOAD_LEAD_DAYS), true, "on the day it opens")
  assert.strictEqual(preload(Model.PRELOAD_LEAD_DAYS + 1), false, "not the day before")
  assert.strictEqual(preload(4), true)
  assert.strictEqual(preload(3), false, "the final tier takes over")
})

check("no phrase is blank, duplicated, or long enough to be clipped", () => {
  const all = []
  for (const tier of Model.PHRASE_TIERS) all.push(...tier.phrases)
  all.push(...Model.RELEASED_PHRASES)
  for (const phrase of all) {
    assert.strictEqual(typeof phrase, "string")
    assert.ok(phrase.trim().length > 0, "blank phrase")
    // Measured off a real screenshot: the hero meta renders uppercase at about
    // 9px a character, and the meta area is roughly 320px once the icon and the
    // link button have taken their share. 26 leaves a margin; 34 overflowed.
    assert.ok(phrase.length <= 26, "too long for the hero line: " + phrase)
    assert.strictEqual(phrase, Model.safeText(phrase), "would be altered by safeText: " + phrase)
  }
  assert.strictEqual(new Set(all).size, all.length, "a phrase is repeated")
})

check("picking never repeats the phrase already on screen", () => {
  const cd = { released: false, calendarDays: 60 }
  let previous = Model.phrasesFor(cd)[0]
  for (let i = 0; i < 200; i++) {
    const next = Model.pickPhrase(cd, previous)
    assert.notStrictEqual(next, previous, "picked the same phrase twice running")
    assert.ok(Model.phrasesFor(cd).indexOf(next) >= 0, "picked outside the tier")
    previous = next
  }
})

check("picking survives a tier change mid-session", () => {
  // The phrase held from the previous tier is not in the new list, which must
  // not throw or return undefined.
  const next = Model.pickPhrase({ released: false, calendarDays: 2 }, "Sit tight")
  assert.ok(Model.phrasesFor({ released: false, calendarDays: 2 }).indexOf(next) >= 0)
  const out = Model.pickPhrase({ released: true, calendarDays: 0 }, "Sit tight")
  assert.ok(Model.RELEASED_PHRASES.indexOf(out) >= 0)
})

/* ------------------------------------------------------------ notification */

function planAt(ms, state, extra) {
  return Model.notifyPlan(ms, state, Object.assign({
    target: TARGET, date: RELEASE, mode: "daily", hour: 9
  }, extra || {}))
}

check("it holds until the configured hour, then fires once", () => {
  const early = planAt(at(2026, 8, 28, 8, 59), { lastKey: "" })
  assert.strictEqual(early.due, null, "too early")
  assert.strictEqual(early.state.lastKey, "", "and does not burn the day")

  const onTime = planAt(at(2026, 8, 28, 9, 0), { lastKey: "" })
  assert.ok(onTime.due, "fires at the hour")
  assert.strictEqual(onTime.state.lastKey, "2026-08-28")
})

check("booting mid-afternoon fires immediately", () => {
  const boot = planAt(at(2026, 8, 28, 14, 30), { lastKey: "" })
  assert.ok(boot.due)
  assert.strictEqual(boot.due.body, "83 days · November 19, 2026")
})

check("restarting the shell all morning does not re-toast", () => {
  let state = { lastKey: "" }
  let fired = 0
  for (const hour of [9, 10, 11, 12, 13, 18, 23]) {
    const plan = planAt(at(2026, 8, 28, hour, 0), state)
    state = plan.state
    if (plan.due) fired++
  }
  assert.strictEqual(fired, 1, "once for the day, however often we are restarted")
})

check("a new local day re-arms it", () => {
  const first = planAt(at(2026, 8, 28, 9, 0), { lastKey: "" })
  const next = planAt(at(2026, 8, 29, 9, 0), first.state)
  assert.ok(next.due)
  assert.strictEqual(next.state.lastKey, "2026-08-29")
})

check("mode off stays silent", () => {
  assert.strictEqual(planAt(at(2026, 11, 18, 9, 0), { lastKey: "" }, { mode: "off" }).due, null)
})

check("milestones mode speaks only on the days that matter", () => {
  assert.strictEqual(planAt(at(2026, 8, 28, 9, 0), { lastKey: "" }, { mode: "milestones" }).due,
    null, "83 days out is not a milestone")
  const hundred = planAt(at(2026, 8, 11, 9, 0), { lastKey: "" }, { mode: "milestones" })
  assert.ok(hundred.due, "100 days out is")
  assert.strictEqual(hundred.due.headline, "100 days to go")
})

check("pre-load day is the one-week milestone", () => {
  const plan = planAt(at(2026, 11, 12, 9, 0), { lastKey: "" })
  assert.strictEqual(plan.due.headline, "Pre-load is open")
  assert.strictEqual(plan.due.body, "7 days · November 19, 2026")
})

check("the last days escalate", () => {
  assert.strictEqual(planAt(at(2026, 11, 18, 9, 0), { lastKey: "" }).due.headline, "Tomorrow")
  assert.strictEqual(planAt(at(2026, 11, 18, 9, 0), { lastKey: "" }).due.urgency, "critical")
  assert.strictEqual(planAt(at(2026, 11, 16, 9, 0), { lastKey: "" }).due.urgency, "normal")
})

check("release day announces, and then it shuts up for good", () => {
  const day = planAt(at(2026, 11, 19, 9, 0), { lastKey: "" })
  assert.strictEqual(day.due.headline, "Grand Theft Auto VI is out")
  assert.strictEqual(day.due.urgency, "critical")

  for (const d of [20, 21, 25]) {
    assert.strictEqual(planAt(at(2026, 11, d, 9, 0), { lastKey: "" }).due, null,
      "nothing left to count on the " + d + "th")
  }
  assert.strictEqual(planAt(at(2027, 6, 1, 9, 0), { lastKey: "" }).due, null)
})

check("a full run to launch fires once a day and hits every milestone once", () => {
  let state = { lastKey: "" }
  const headlines = []
  // Tick every 20 minutes from today through release day, as the widget does.
  let ms = at(2026, 8, 28, 0, 0)
  const end = at(2026, 11, 20, 0, 0)
  while (ms < end) {
    const plan = planAt(ms, state)
    state = plan.state
    if (plan.due) headlines.push([Model.localDayKey(ms), plan.due.headline])
    ms += 20 * 60 * 1000
  }

  const days = headlines.map(h => h[0])
  assert.strictEqual(new Set(days).size, days.length, "never twice in one day")
  assert.strictEqual(headlines.length, 84, "83 countdown days plus release day")

  const byDay = new Map(headlines)
  assert.strictEqual(byDay.get("2026-08-28"), "Grand Theft Auto VI")
  assert.strictEqual(byDay.get("2026-09-30"), "50 days to go")
  assert.strictEqual(byDay.get("2026-10-20"), "One month to go")
  assert.strictEqual(byDay.get("2026-11-05"), "Two weeks to go")
  assert.strictEqual(byDay.get("2026-11-12"), "Pre-load is open")
  assert.strictEqual(byDay.get("2026-11-16"), "Three days to go")
  assert.strictEqual(byDay.get("2026-11-18"), "Tomorrow")
  assert.strictEqual(byDay.get("2026-11-19"), "Grand Theft Auto VI is out")

  // Each milestone in range appears exactly once across the whole run.
  const texts = headlines.map(h => h[1])
  for (const m of Model.MILESTONES) {
    if (m.days > 83) continue
    assert.strictEqual(texts.filter(t => t === m.text).length, 1,
      "milestone '" + m.text + "' should fire exactly once")
  }
})

console.log("ok - " + checks + " checks passed"
  + (skipped ? ", " + skipped + " wall-clock checks skipped" : "")
  + "  [" + ZONE + "]")
