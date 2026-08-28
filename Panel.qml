import QtQuick
import QtQuick.Controls
import Quickshell.Io
import qs.Commons
import qs.Ui as Ui
import "Model.js" as Model

Ui.Panel {
  id: root
  moduleName: "io.github.xgborgeso.gta6-countdown"
  ipcTarget: "io.github.xgborgeso.gta6-countdown"
  manageIpc: false

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  // A bar chip follows `barForeground`, which tracks a transparent bar; panel
  // content follows `foreground`. They are not interchangeable.
  readonly property color barTextColor: svc.released || root.cd.calendarDays <= 1
    ? urgent
    : barForeground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var cd: svc.countdown
  readonly property string lastError: svc.lastError
  // Only the text chip prefixes the glyph; the icon chip is the glyph.
  readonly property string barText: Model.GLYPH + "  " + Model.formatBar(cd, svc.barFormat)
  readonly property string tooltip: Model.formatTooltip(cd, svc.target.date)
  readonly property bool exactOnly: svc.panelFormat === "exact"

  // Chosen when the panel opens rather than bound, so the subtitle holds still
  // while the panel is up instead of resampling on every minute tick.
  property string heroPhrase: ""
  readonly property string heroMeta: lastError !== ""
    ? "Check the release date"
    : heroPhrase

  function pickHeroPhrase() {
    heroPhrase = Model.pickPhrase(root.cd, heroPhrase)
  }

  // A finished countdown retires itself rather than sitting on the bar forever.
  visible: !svc.retired
  implicitWidth: visible ? button.implicitWidth : 0
  implicitHeight: visible ? button.implicitHeight : 0

  onOpenedChanged: if (opened) {
    pickHeroPhrase()
    if (panelFlick) panelFlick.contentY = 0
    svc.refresh()
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  // Confirmation that the click did something, reset shortly after so the
  // button does not sit there claiming success from ten minutes ago.
  property bool copied: false

  function copyRemoveCommand() {
    svc.copyRemoveCommand()
  }

  Service {
    id: svc
    settings: root.settings
    onCopied: {
      root.copied = true
      copiedReset.restart()
    }
  }

  Timer {
    id: copiedReset
    interval: 2000
    onTriggered: root.copied = false
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { svc.refresh(); return "ok" }
    function link(): string { svc.openOfficial(); return Model.OFFICIAL_URL }
    // Plain enough to drop straight into a script or another status bar.
    function status(): string {
      if (svc.released) return "released"
      return Model.formatBar(root.cd, "dhm")
    }
    function days(): string {
      return String(root.cd.released ? 0 : root.cd.calendarDays)
    }
  }

  // Two different primitives, because they are two different shapes. An icon
  // belongs in BarIconButton's fixed square slot, which optically centres the
  // glyph and lines it up with every other icon in the bar; a ticking string
  // needs WidgetButton, which sizes to its label. Forcing either to do the
  // other's job leaves the widget either clipped or a different height.
  Loader {
    id: button
    anchors.fill: parent
    sourceComponent: svc.barFormat === "icon" ? iconChip : textChip
  }

  Component {
    id: iconChip
    Ui.BarIconButton {
      bar: root.bar
      text: Model.GLYPH
      tooltipText: root.tooltip
      useActiveColor: false
      foreground: root.barTextColor
      onPressed: function (buttonCode) { root.chipPressed(buttonCode) }
    }
  }

  Component {
    id: textChip
    Ui.WidgetButton {
      bar: root.bar
      text: root.barText
      fontSize: Style.font.caption
      horizontalMargin: 6
      tooltipText: root.tooltip
      useActiveColor: false
      foreground: root.barTextColor
      onPressed: function (buttonCode) { root.chipPressed(buttonCode) }
    }
  }

  function chipPressed(buttonCode) {
    if (buttonCode === Qt.MiddleButton) svc.openOfficial()
    else root.toggle()
  }

  Ui.KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    // Sized so "Grand Theft Auto VI - Countdown" clears the title's elide point
    // with the link button already taking its share of the row.
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(520))

    Ui.PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }
      onTextKey: function (text) {
        var key = String(text).toLowerCase()
        if (key === "r") svc.refresh()
        else if (key === "o") svc.openOfficial()
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(14)

          Ui.PanelHero {
            id: hero
            width: parent.width
            // The suffix goes once the date has passed and there is nothing
            // left to count.
            title: root.cd.released
              ? "Grand Theft Auto VI"
              : "Grand Theft Auto VI - Countdown"
            meta: root.heroMeta
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconComponent: Component {
              Text {
                textFormat: Text.PlainText
                text: Model.GLYPH
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
              }
            }
            trailingControl: Component {
              Ui.PanelActionButton {
                iconText: Model.LINK_GLYPH
                tooltipText: "Open rockstargames.com/VI"
                foreground: root.dim
                hoverColor: root.foreground
                fontFamily: root.fontFamily
                onClicked: svc.openOfficial()
              }
            }
          }

          Text {
            textFormat: Text.PlainText
            visible: root.lastError !== ""
            width: parent.width
            text: root.lastError
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            wrapMode: Text.WordWrap
          }

          // The two readings sit together on purpose. The big one is how many
          // sleeps away it is, the small one is exact time remaining; above a
          // day apart they differ by one, and showing both makes that obvious
          // instead of looking like a bug in whichever you saw second.
          Column {
            width: parent.width
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.exactOnly ? Model.formatBar(root.cd, "dhm") : Model.formatHeadline(root.cd)
              color: root.cd.released || root.cd.calendarDays <= 1 ? root.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
              font.bold: true
              horizontalAlignment: Text.AlignHCenter
            }

            Text {
              textFormat: Text.PlainText
              visible: Model.showsExactLine(root.cd, svc.panelFormat)
              width: parent.width
              text: Model.formatExact(root.cd)
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              horizontalAlignment: Text.AlignHCenter
            }
          }

          Ui.PanelSeparator {
            width: parent.width
            foreground: root.foreground
          }

          DateRow {
            width: parent.width
            label: "Release"
            value: Model.formatDate(svc.target.date)
            highlight: root.cd.released
          }

          DateRow {
            width: parent.width
            // Once the game is out, the pre-load date is history nobody needs.
            visible: !root.cd.released
            label: "Pre-load"
            value: Model.formatDate(svc.preloadDate)
            highlight: root.cd.preloadOpen
            note: root.cd.preloadOpen ? "open" : ""
          }

          // The way out, offered rather than hidden. The widget retires itself
          // on `hideAfterDays` anyway, but someone who opens the panel after
          // launch should not have to go looking for the command.
          Column {
            width: parent.width
            visible: root.cd.released
            spacing: Style.space(8)

            Ui.PanelSeparator {
              width: parent.width
              foreground: root.foreground
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: Model.farewellText(root.cd, svc.hideAfterDays)
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
              horizontalAlignment: Text.AlignHCenter
            }

            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(8)

              Text {
                id: removeCommand
                textFormat: Text.PlainText
                text: Model.REMOVE_COMMAND
                color: Qt.darker(root.foreground, 1.4)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideMiddle
                width: Math.max(0, column.width - Style.space(64))
                anchors.verticalCenter: parent.verticalCenter
              }

              Ui.PanelActionButton {
                iconText: root.copied ? Model.CHECK_GLYPH : Model.COPY_GLYPH
                tooltipText: root.copied ? "Copied" : "Copy the removal command"
                foreground: root.copied ? root.foreground : root.dim
                hoverColor: root.foreground
                fontFamily: root.fontFamily
                anchors.verticalCenter: parent.verticalCenter
                onClicked: root.copyRemoveCommand()
              }
            }
          }
        }
      }
    }
  }

  component DateRow: Item {
    id: dateRow
    property string label: ""
    property string value: ""
    property string note: ""
    property bool highlight: false

    implicitHeight: rowInner.implicitHeight + Style.spacing.md

    Row {
      id: rowInner
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(6)
      anchors.rightMargin: Style.space(6)
      spacing: Style.space(8)

      Text {
        textFormat: Text.PlainText
        text: dateRow.label
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        width: Style.space(72)
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        textFormat: Text.PlainText
        text: dateRow.value
        color: dateRow.highlight ? root.foreground : Qt.darker(root.foreground, 1.4)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: dateRow.highlight
        elide: Text.ElideRight
        width: Math.max(0, parent.width - Style.space(72) - Style.space(8) - Style.space(52))
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        textFormat: Text.PlainText
        text: dateRow.note
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
        width: Style.space(52)
        horizontalAlignment: Text.AlignRight
        anchors.verticalCenter: parent.verticalCenter
      }
    }
  }
}
