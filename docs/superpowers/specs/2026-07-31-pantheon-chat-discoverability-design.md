# Pantheon Chat Discoverability — Design

**Date:** 2026-07-31
**Status:** Approved, ready for implementation planning
**Scope:** `extensions/vscode` status bar and keybinding contributions

## Problem

Users cannot reliably find Pantheon Chat in the installed Marketplace extension (v5.1.0).
The reported symptom is that the `⚡ Pantheon` status bar item is absent from a normal
VS Code window.

The item is created unconditionally in the `StatusBarManager` constructor
(`src/statusBar.ts:60-70`) and is never hidden by extension code — `StatusBarManager.hide()`
(`src/statusBar.ts:278`) touches only the health badge. Its disappearance is therefore
VS Code's doing, and two properties of the current implementation make that outcome
inevitable:

1. **Lowest priority in the group.** All five Thesmos status bar items are
   `StatusBarAlignment.Left` with priorities 100 / 99 / 98 / 97 / 96. `chatItem` holds 96 —
   the lowest. VS Code drops the lowest-priority left-aligned items first when the status
   bar runs out of horizontal room. The item whose own code comment reads
   *"Permanent Pantheon Chat launcher — always visible next to the health badge"* is
   precisely the one engineered to vanish first.

2. **No stable id, so the loss is unrecoverable.** Every item uses the two-argument
   `createStatusBarItem(alignment, priority)` overload. Without an explicit id and `name`,
   the five items surface under indistinguishable labels in the status bar's right-click
   show/hide menu. A user who loses the chat launcher — to compaction or to an accidental
   hide — has no findable entry to switch back on.

A third, independent defect surfaced during investigation: the documented keybinding
`cmd+shift+g` / `ctrl+shift+g` (`package.json:316`) collides with VS Code's built-in
*Find Previous* on macOS and carries no `when` clause.

### Entry points that already exist

For the record, the shipped extension offers four routes to the chat. This design fixes
the ones that are broken; it does not add new ones.

| Surface | Location | State |
|---|---|---|
| Activity bar view | `thesmos.pantheonChat`, view 1 of 5 in the `thesmos` container | Works |
| Status bar | `⚡ Pantheon`, priority 96 | **Broken — compaction target, unrecoverable** |
| Command Palette | `thesmos.pantheon.chat.open` / `.openInTab` | Works |
| Keybinding | `cmd+shift+g` | **Broken — collides with Find Previous** |

## Non-goals

- An `editor/title` button. Considered and rejected — the status bar item was already
  intended to be the permanent launcher; fixing it is the honest repair.
- A dedicated activity bar container for the chat. Rejected as a land-grab for a door
  that already exists.
- Changing the chat item's click target. It stays `thesmos.pantheon.chat.openInTab`.
- The unreachable marketing website (`vercel.json` redirects every path to
  `https://holley.studio/thesmos`, which returns 404) and the four unpushed local commits
  including the 5.1.1 release. Both are real, both are separate.

## Design

### 1. Reprioritize the chat item

`chatItem` moves from priority **96 to 101**, making it the leftmost item of the Thesmos
group and the last one VS Code drops under compaction. The remaining four keep their
current relative order (100 / 99 / 98 / 97).

This deliberately ranks the chat launcher above the health grade. Health has a sidebar
view, a tree, and a command; the chat launcher is the surface users actually lose.

### 2. Stable ids and names on all five items

Switch every item to the three-argument `createStatusBarItem(id, alignment, priority)`
overload and assign an explicit `name`.

| Field | id | name |
|---|---|---|
| `item` | `thesmos.status.health` | Thesmos: Health |
| `governanceItem` | `thesmos.status.governance` | Thesmos: Governance |
| `tokenItem` | `thesmos.status.tokens` | Thesmos: Token Usage |
| `pantheonItem` | `thesmos.status.routing` | Thesmos: Pantheon Routing |
| `chatItem` | `thesmos.status.chat` | Thesmos: Pantheon Chat |

This is the half that makes the failure recoverable: each item gains a distinct, labeled
checkbox in the status bar's right-click menu, so a hidden launcher can be restored by name.

### 3. Replace the conflicting keybinding

Remove `cmd+shift+g` / `ctrl+shift+g` from the `thesmos.pantheon.chat.open` binding and
replace it with a chord that does not appear in VS Code's default keymap.

The specific chord is chosen during implementation rather than guessed at design time.
Acceptance criterion: the chosen `key` and `mac` values must not appear in
**Preferences: Open Default Keyboard Shortcuts (JSON)** on either the macOS or the
Windows/Linux default keymap. Candidates are evaluated in this order, taking the first
that clears the criterion:

1. `ctrl+alt+g` / `cmd+alt+g`
2. `ctrl+k ctrl+g` / `cmd+k cmd+g`
3. `ctrl+alt+p` / `cmd+alt+p`

If none clears, the binding is removed entirely rather than shipped in conflict — a
launcher that steals *Find Previous* is worse than one with no shortcut.

No `when` clause is added. A global launcher should fire globally; the conflict is the
key itself, and scoping the binding would add fragility without fixing the collision.

### 4. Tooltip surfaces the shortcut

The `chatItem` tooltip gains a line naming the bound keystroke, so the visible surface
teaches the invisible one. The keystroke is written as a literal string in the existing
`MarkdownString` — VS Code does not resolve keybindings inside tooltips, and the value
must be kept in sync with the `contributes.keybindings` entry chosen in step 3. If step 3
ends with the binding removed, this line is omitted.

## Testing

`src/__mocks__/vscode.ts` currently defines neither `createStatusBarItem` nor
`StatusBarAlignment`, so `StatusBarManager` has no test coverage at all today. Closing
that gap is part of this work.

**Mock additions:** `StatusBarAlignment` enum and a `createStatusBarItem` factory that
records `id`, `alignment`, `priority`, `name`, `text`, `command`, `tooltip`, and
show/hide/dispose calls, supporting both the two- and three-argument overloads.

**New suite — `src/__tests__/statusBar.test.ts`:**

- the chat item holds the highest priority of the five items
- all five ids are distinct, and every `name` is a non-empty string
- the chat item is shown on construction
- `hide()` hides only the health badge; the chat item remains shown
- `dispose()` disposes all five items

Runs under the existing `npm test` (`vitest run`) in `extensions/vscode`.

## Verification

- `npm run typecheck --workspace=extensions/vscode`
- `npm test --workspace=extensions/vscode`
- `npm run build --workspace=extensions/vscode` — the bundled `dist/extension.js` must be
  rebuilt; the packaged extension runs the bundle, not `src`
- Manual check in a real VS Code window at a narrow width: the `⚡ Pantheon` item survives
  compaction, and all five items appear as separately named entries in the status bar's
  right-click menu

## Release path

None of this reaches users through a merge alone. The Marketplace is on
`holleystudio.thesmos-governance-vscode` v5.1.0 (published 2026-07-24); npm is on
`thesmos-governance` 5.1.0. The local 5.1.1 release commit is unpushed and untagged.
Shipping this fix requires a version bump, a CHANGELOG entry, and a `vsce publish` —
tracked separately from the code change.
