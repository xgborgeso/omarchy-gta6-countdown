import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

Item {
  id: root

  property var settings: ({})
  // Not `enabled`: that would shadow QQuickItem's own property.
  property bool active: true

  // The single clock the whole widget reads. Everything else is derived, so a
  // repaint can never show an hours field from one instant and a days field
  // from another.
  property double nowMs: 0

  readonly property string releaseDate: String(setting("releaseDate", Model.RELEASE_DATE) || "").trim()
  readonly property var target: Model.resolveTarget(releaseDate)
  readonly property string lastError: target.ok ? "" : Model.errorText(target.error)

  // Icon only by default: a ticking string is wider than every other chip in
  // the bar and pushes its neighbours around once a minute.
  readonly property string barFormat: {
    var format = String(setting("barFormat", "icon"))
    return format === "days" || format === "dhm" ? format : "icon"
  }
  readonly property string notifyMode: {
    var mode = String(setting("notifyMode", "daily"))
    return mode === "off" || mode === "milestones" ? mode : "daily"
  }
  readonly property int notifyHour: intSetting("notifyHour", 9, 0, 23)
  readonly property int hideAfterDays: intSetting("hideAfterDays", 30, 0, 3650)

  readonly property var countdown: Model.countdown(nowMs, target.ms)
  // Pre-load opens a week ahead of launch, so it moves with a retargeted date.
  readonly property string preloadDate: Model.localDayKey(Model.preloadMs(target.ms))
  readonly property bool released: countdown.released
  // A countdown that has finished has nothing left to say. It keeps the chip
  // for a while so the release is not silently erased from the bar the morning
  // after, then retires itself rather than sitting there forever.
  readonly property bool retired: hideAfterDays > 0 && released && countdown.daysSince >= hideAfterDays

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function intSetting(name, fallback, min, max) {
    var n = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(n)) n = fallback
    if (n < min) n = min
    if (n > max) n = max
    return n
  }

  function refresh() {
    nowMs = Date.now()
    maybeNotify()
  }

  function openOfficial() {
    if (linkProcess.running) return
    linkProcess.command = ["xdg-open", Model.OFFICIAL_URL]
    linkProcess.running = true
  }

  /* ------------------------------------------------------------ the clock */

  // Aligning to the wall-clock minute rather than ticking every 60s from an
  // arbitrary start keeps the chip's minute field from lagging by up to a
  // minute behind the system clock, and re-syncs after a suspend.
  function msToNextMinute() {
    var now = Date.now()
    var into = now % 60000
    return (60000 - into) + 50
  }

  Timer {
    id: tick
    interval: 1000
    running: root.active && !root.retired
    repeat: false
    onTriggered: {
      root.refresh()
      interval = root.msToNextMinute()
      restart()
    }
  }

  /* ------------------------------------------------- once-a-day notifying */

  // Which local day we last spoke on, persisted so restarting the shell five
  // times before lunch does not produce five identical toasts. An in-memory
  // map would be correct for a battery, whose state genuinely changes; here
  // the state is the calendar, and the calendar survives a restart.
  property string lastNotifiedKey: ""
  property bool stampLoaded: false
  property bool stampDirRepaired: false

  readonly property string stateDir: {
    var base = String(Quickshell.env("XDG_STATE_HOME") || "").trim()
    if (base === "") base = String(Quickshell.env("HOME") || "") + "/.local/state"
    return base + "/omarchy-gta6-countdown"
  }
  readonly property string stampPath: stateDir + "/last-notified"

  function maybeNotify() {
    // Settings arrive one event-loop turn after the component is built, and the
    // stamp is read asynchronously. Speaking before either lands could fire a
    // toast at the stock hour that the user had moved, or repeat one that the
    // stamp was about to rule out.
    if (!settingsApplied || !stampLoaded) return
    if (!active || notifyMode === "off") return

    var plan = Model.notifyPlan(nowMs, { lastKey: lastNotifiedKey }, {
      target: target.ms,
      date: target.date,
      mode: notifyMode,
      hour: notifyHour
    })
    if (!plan.due) return

    lastNotifiedKey = plan.state.lastKey
    stamp.setText(lastNotifiedKey + "\n")
    sendNotify(plan.due)
  }

  // omarchy-notification-send is preferred over notify-send: it hands every
  // value to Notify as one typed D-Bus argument, so no field can be reparsed
  // as an option. The app name still has to be set, or the shell files the
  // toast as ephemeral and drops it from the history panel.
  readonly property string notifierPath:
    (Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy") + "/bin/omarchy-notification-send"

  function sendNotify(due) {
    if (notifyProcess.running) return
    notifyProcess.command = [notifierPath,
      "-u", due.urgency === "critical" ? "critical" : "normal",
      "-g", Model.GLYPH,
      "--app-name", "GTA VI Countdown",
      due.headline, due.body]
    notifyProcess.running = true
  }

  FileView {
    id: stamp
    path: root.stampPath
    preload: true
    atomicWrites: true
    // A missing stamp is the normal first run, not something to shout about.
    printErrors: false

    onLoaded: {
      root.lastNotifiedKey = String(stamp.text() || "").split("\n")[0].trim()
      root.stampLoaded = true
      root.maybeNotify()
    }
    onLoadFailed: {
      // No stamp yet: this machine has never been told anything.
      root.lastNotifiedKey = ""
      root.stampLoaded = true
      root.maybeNotify()
    }
    onSaveFailed: {
      // Almost always a missing state directory on first run. Create it once
      // and retry; if it fails again the widget still works, it just forgets
      // across restarts rather than breaking.
      if (root.stampDirRepaired) return
      root.stampDirRepaired = true
      mkdirProcess.command = ["mkdir", "-p", root.stateDir]
      mkdirProcess.running = true
    }
  }

  /* --------------------------------------------------------------- wiring */

  // The bar assigns settings one turn after the component is built, so acting
  // on completion would read the stock release date and the stock hour. Wait
  // for the assignment, which the host makes even for an entry carrying no
  // settings, and let the fallback cover a host that never makes one.
  property bool settingsApplied: false
  property bool completed: false

  function applySettings() {
    if (settingsApplied) return
    settingsApplied = true
    refresh()
  }

  onSettingsChanged: if (completed) applySettings()

  Component.onCompleted: {
    completed = true
    nowMs = Date.now()
    firstRunFallback.restart()
  }

  Timer {
    id: firstRunFallback
    interval: 2000
    onTriggered: root.applySettings()
  }

  Process {
    id: notifyProcess
    running: false
    command: []
  }

  Process {
    id: linkProcess
    running: false
    command: []
  }

  Process {
    id: mkdirProcess
    running: false
    command: []
    onExited: function (exitCode) {
      if (exitCode === 0 && root.lastNotifiedKey !== "") {
        stamp.setText(root.lastNotifiedKey + "\n")
      }
    }
  }
}
