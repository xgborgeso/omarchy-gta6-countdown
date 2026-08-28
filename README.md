# GTA VI Countdown for Omarchy

[![Check](https://github.com/xgborgeso/omarchy-gta6-countdown/actions/workflows/check.yml/badge.svg)](https://github.com/xgborgeso/omarchy-gta6-countdown/actions/workflows/check.yml)

A minimalist Grand Theft Auto VI countdown for the Omarchy bar: one icon, a
panel with the time remaining and both dates that matter, a link to the official
page, and one reminder a day. It is pure date arithmetic — no daemon, no helper,
no network, and nothing to read from the system.

<p align="center">
  <img src="preview.png" width="428"
       alt="The GTA VI Countdown panel open in the Omarchy bar, titled Grand Theft Auto VI - Countdown, reading 82d 09h 26m above the release date of November 19, 2026 and the pre-load date of November 12, 2026">
</p>

## Features

- One icon on the bar, the same width as every other chip. The reading lives in
  the tooltip and the panel rather than a string that grows and shrinks and
  shoves its neighbours sideways once a minute
- One line of exact time in the panel — `82d 09h 26m`, ticking every minute.
  Switch it for the plain sleeps count with `panelFormat`
- Pre-load as well as release, since pre-load opens a week ahead and is the date
  you actually have to act on
- One reminder a day, at an hour you choose, with a milestone line at 100 days,
  50, a month, two weeks, pre-load day, and the last three days
- A line that escalates as launch approaches, from `Sit tight` at six months out
  to `This is not a drill` in the final days. It changes every time you open the
  panel and on every daily reminder, drawn from a bag so it never repeats before
  the tier is exhausted
- Counts to **local midnight**, because that is how Rockstar gates pre-orders,
  pre-load and launch
- Packs up after release: a farewell line, the removal command with a copy
  button, and a widget that takes itself off the bar a month later

## Install

```bash
omarchy plugin add https://github.com/xgborgeso/omarchy-gta6-countdown.git --enable
```

`--enable` puts the icon on the right of the bar.

## The dates

| | |
| --- | --- |
| Release | **November 19, 2026**, local midnight, on PS5 and Xbox Series X\|S |
| Pre-load | **November 12, 2026**, local midnight |

Rockstar confirmed November 19 in a Newswire post on November 6, 2025, and
Take-Two has reaffirmed it since. It has moved twice before, which is why
`releaseDate` is a setting rather than something baked into the code — if it
moves again you retarget it yourself instead of waiting for a release here.

## Settings

| Key | Default | What it does |
| --- | --- | --- |
| `releaseDate` | `2026-11-19` | Target date, `YYYY-MM-DD`, counted to local midnight. An unparseable value falls back to the shipped date and says so in the panel. |
| `barFormat` | `icon` | `icon` shows the glyph alone. `days` shows the sleeps count. `dhm` shows exact time remaining, and ticks every minute. |
| `panelFormat` | `exact` | `exact` shows one line of ticking time. `days` shows the sleeps count instead. `auto` shows the sleeps count, adding the exact figure beneath it in the final two days. `both` always shows both. |
| `notifyMode` | `daily` | `daily`, `milestones` only, or `off`. |
| `notifyHour` | `9` | Earliest hour for the daily reminder, `0`–`23`. |
| `hideAfterDays` | `30` | Retire the widget this many days after release. `0` keeps it forever. |

```bash
omarchy bar set io.github.xgborgeso.gta6-countdown barFormat dhm --json
omarchy bar set io.github.xgborgeso.gta6-countdown notifyMode milestones --json
omarchy bar move io.github.xgborgeso.gta6-countdown --section right
```

### Reminders

One notification per local day, on the first tick at or after `notifyHour`.
Booting at 14:00 fires immediately; a machine left running overnight fires at
`notifyHour` rather than at midnight.

Every toast is headed `Grand Theft Auto VI - Countdown`, the same words the
panel uses and the same on every day, so it is recognisable at a glance. The
body is always two parts: where the countdown stands, then a line from the
current tier.

    Grand Theft Auto VI - Countdown
    83 days · A real countdown now

The line comes from a bag rather than at random, so every phrase in the tier
appears once before any repeats and no two mornings running say the same thing.

State lives in `$XDG_STATE_HOME/omarchy-gta6-countdown/last-notified`: the last
day spoken on, so restarting the shell five times before lunch does not produce
five identical toasts, and the bag, so a reboot does not reset the rotation.

On an ordinary day the body opens with the count. On a milestone it says what
the milestone is instead:

| Sleeps left | Body opens with |
| --- | --- |
| any other day | `83 days` |
| 365 · 300 · 200 · 100 · 50 | `One year to go` … `50 days to go` |
| 30 | `One month to go` |
| 14 | `Two weeks to go` |
| 7 | `Pre-load is open` |
| 3 · 2 · 1 | `Three days to go` · `Two days to go` · `Tomorrow` |
| 0 | `Out now` |

Release day is announced, and then the countdown has nothing left to say and
stops speaking.

<details>
<summary>See what they look like</summary>

<br>

An ordinary morning: the count, then a line from the tier.

<img src="docs/notification-daily.png" width="408"
     alt="A notification headed Grand Theft Auto VI - Countdown, reading 83 days, A real countdown now, with a controller glyph">

A month out, where the practical nudges live.

<img src="docs/notification-milestone.png" width="408"
     alt="A notification headed Grand Theft Auto VI - Countdown, reading One month to go, Weeks not months">

Pre-load day, one week ahead of launch.

<img src="docs/notification-preload.png" width="408"
     alt="A notification headed Grand Theft Auto VI - Countdown, reading Pre-load is open, One week One week">

The last two days come through as critical, so they stay on screen.

<img src="docs/notification-tomorrow.png" width="408"
     alt="A notification headed Grand Theft Auto VI - Countdown, reading Tomorrow, Clear your calendar">

And then it is done.

<img src="docs/notification-release.png" width="408"
     alt="A notification headed Grand Theft Auto VI - Countdown, reading Out now, Why are you still here">

</details>

## After release

A countdown that outlives its date is clutter, so this one packs up on its own.

On release day the panel says `Go and play. You can remove this whenever.`
Afterwards it counts the days until it retires — `Nothing left to count.
Retiring in 12 days.` — and shows the removal command with a button that copies
it to the clipboard, so you do not have to go looking for it. On day
`hideAfterDays` the widget takes itself off the bar. Set `hideAfterDays` to `0`
if you would rather it stayed.

```bash
omarchy plugin remove io.github.xgborgeso.gta6-countdown
```

## Controls

Left click opens the panel, middle click opens the official page.

| Key | Action |
| --- | --- |
| `o` | Open [rockstargames.com/VI](https://www.rockstargames.com/VI) |
| `r` | Refresh |
| `Tab` | Next stock panel |
| `Esc` | Close |

The panel is also scriptable:

```bash
omarchy-shell io.github.xgborgeso.gta6-countdown status   # 82d 10h 24m
omarchy-shell io.github.xgborgeso.gta6-countdown days     # 83
omarchy-shell io.github.xgborgeso.gta6-countdown toggle
omarchy-shell io.github.xgborgeso.gta6-countdown link
```

## Why the two numbers disagree

Set `panelFormat` to `both` and the panel shows `83 days` above
`82d 10h 24m remaining`. Both are correct.

`83` is how many sleeps away it is, which is what a person means by "days left".
`82d 10h` is exact time on the clock. They differ by one for most of the day and
agree at local midnight. Every bare number — the tooltip's neighbour, the `days`
bar format, every notification — uses the sleeps count; only the ticking figure
is exact.

The panel ships showing only the exact figure, so the two never sit together
unless you ask for it. `auto` is the middle ground: the sleeps count on its own
until the final two days, then the exact figure joins it, when the minutes are
actually the point.

The gap can also be more than you expect. Between August and November the clocks
go back, so there is one more real hour of waiting than the calendar suggests,
and the exact figure counts it. That is a fact about November, not a rounding
error.

## Tests

Everything testable is a pure function in `Model.js`, so the suite needs no
compositor, no shell and no display:

```bash
node tests/model.test.js
python3 tests/qml.test.py
omarchy plugin validate .
```

`tests/model.test.js` re-runs itself once per timezone — a southern-hemisphere
zone, where the clocks go the other way before launch, and a half-hour offset
among them. Half of what it checks is local-midnight behaviour, which a runner in
UTC alone would happily agree with a bug about. It also walks every day between
now and release to prove the reminder fires once a day and each milestone exactly
once.

`tests/qml.test.py` reads the QML rather than running it, and checks the things
that load fine in an editor and fail silently in the bar: a text sink left on
`Text.AutoText`, a property name starting uppercase, a manifest default nothing
reads, or a nerd-font glyph pasted in as an invisible private-use character
instead of written as an escape.

## Remove

```bash
omarchy plugin remove io.github.xgborgeso.gta6-countdown
```

## License

MIT. This is an unofficial fan project. Not affiliated with, endorsed by, or
associated with Rockstar Games or Take-Two Interactive. *Grand Theft Auto* is a
trademark of Take-Two Interactive Software, Inc., referred to here only to
identify the game being counted down to.
