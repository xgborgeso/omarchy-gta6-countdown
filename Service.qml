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
  // What the middle of the panel shows. "both" prints the sleeps count large
  // with the exact figure under it; the single-value modes drop one of them.
  readonly property string panelFormat: {
    var format = String(setting("panelFormat", "exact"))
    return format === "days" || format === "auto" || format === "both" ? format : "exact"
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

  signal copied()

  // wl-copy reads the value as one argv entry, so the command text is never
  // reparsed by a shell on its way to the clipboard.
  function copyRemoveCommand() {
    if (copyProcess.running) return
    copyProcess.command = ["wl-copy", "--", Model.REMOVE_COMMAND]
    copyProcess.running = true
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
  // The whole notify state: which local day we last spoke on, and the phrase
  // bag, so the toast does not repeat a line two mornings running even across a
  // reboot.
  property var notifyState: ({ lastKey: "", phrases: null })
  property bool stampLoaded: false
  property string stampError: ""

  // The stamp is read and written by helper/state.py rather than by FileView.
  // FileView takes a path and nothing else: it cannot open O_NOFOLLOW, cannot
  // fstat what it opened, and cannot stop at a byte limit. The stamp sits at a
  // predictable path, so any same-UID process could swap it for a symlink to
  // /dev/zero and feed that into this long-lived process. atomicWrites guards
  // the write; nothing in QML guards the read.
  function helperScript() {
    var override = String(setting("helperPath", "") || "").trim()
    if (override) return override
    var resolved = toLocalFile(Qt.resolvedUrl("helper/state.py"))
    if (resolved.charAt(0) === "/") return resolved
    return toLocalFile(Qt.resolvedUrl(".")) + "/helper/state.py"
  }

  function toLocalFile(url) {
    var s = String(url || "").trim()
    if (s.indexOf("file:") === 0) {
      s = s.replace(/^file:\/\//i, "")
      s = s.replace(/^localhost/i, "")
      if (s.charAt(0) !== "/") s = "/" + s
      try { s = decodeURIComponent(s) } catch (e) {}
    }
    return s.replace(/\/+$/, "")
  }

  // The helper answers with one line of JSON and exits 0 whatever happened.
  // Anything it refused arrives as ok:false with an empty state, which reads
  // here as "nothing said yet today": the widget may repeat one toast, and the
  // next write replaces the offending file. Refusing to speak instead would let
  // anyone who can touch the file silence the reminder for good.
  function applyStamp(raw) {
    var next = { lastKey: "", phrases: null }
    try {
      var parsed = JSON.parse(String(raw || ""))
      if (parsed && parsed.ok === true && parsed.state) {
        next.lastKey = typeof parsed.state.lastKey === "string" ? parsed.state.lastKey : ""
        next.phrases = parsed.state.phrases || null
      } else if (parsed && parsed.error) {
        stampError = Model.errorText(parsed.error)
      }
    } catch (e) {
      stampError = "Could not read the reminder stamp"
    }
    notifyState = next
    stampLoaded = true
    maybeNotify()
  }

  function readStamp() {
    if (readProcess.running) return
    readProcess.command = ["python3", helperScript(), "read"]
    readProcess.running = true
  }

  function writeStamp(state) {
    if (writeProcess.running) return
    writeProcess.command = ["python3", helperScript(), "write", JSON.stringify(state)]
    writeProcess.running = true
  }

  function maybeNotify() {
    // Settings arrive one event-loop turn after the component is built, and the
    // stamp is read asynchronously. Speaking before either lands could fire a
    // toast at the stock hour that the user had moved, or repeat one that the
    // stamp was about to rule out.
    if (!settingsApplied || !stampLoaded) return
    if (!active || notifyMode === "off") return

    var plan = Model.notifyPlan(nowMs, notifyState, {
      target: target.ms,
      date: target.date,
      mode: notifyMode,
      hour: notifyHour
    })
    if (!plan.due) return

    notifyState = plan.state
    writeStamp(plan.state)
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

  Process {
    id: readProcess
    running: false
    command: []
    stdout: StdioCollector { id: readStdout; waitForEnd: true }
    onExited: function (exitCode) {
      // A helper that could not run at all leaves the widget with no memory of
      // yesterday, which costs at most one repeated toast.
      if (exitCode !== 0) {
        root.stampError = "Reminder stamp helper failed"
        root.notifyState = { lastKey: "", phrases: null }
        root.stampLoaded = true
        root.maybeNotify()
        return
      }
      root.applyStamp(readStdout.text)
    }
  }

  Process {
    id: writeProcess
    running: false
    command: []
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
    // Only now is `helperPath` known, and the stamp has to be read after that
    // or an overridden helper would be ignored on the one run that matters.
    readStamp()
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
    id: copyProcess
    running: false
    command: []
    onExited: function (exitCode) { if (exitCode === 0) root.copied() }
  }

}
