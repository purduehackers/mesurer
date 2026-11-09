<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://mesurer.dev/logo-dark.svg">
  <img src="https://mesurer.dev/logo.svg" alt="Mesurer" width="200">
</picture>

<br>

# Mesurer

[![npm version](https://img.shields.io/npm/v/mesurer)](https://www.npmjs.com/package/mesurer)
[![downloads](https://img.shields.io/npm/dm/mesurer)](https://www.npmjs.com/package/mesurer)

**Inspect, annotate, and give feedback on any live interface.**

Mesurer runs directly where you build. Share feedback with your agents and your team.

Mesurer is an open-source UI inspector and visual feedback tool for the browser.
Use guides, rulers, measurements, arrows, freehand pen strokes, text annotations,
color inspection, typography tools, X-ray mode, and screenshots to understand interfaces and communicate precise
visual feedback to coding agents. Capture a short video of any visible region to show interaction details that a screenshot cannot.

[Full documentation](https://mesurer.dev/)

## Install

```bash
npm install mesurer
```

## Usage

```tsx
import { Mesurer } from "mesurer";

function App() {
  return (
    <>
      <YourApp />
      <Mesurer />
    </>
  );
}
```

## Props

| Prop                    | Description                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| `highlightColor`        | Base color for selection/hover overlays (defaults to `oklch(0.62 0.18 255)`). |
| `guideColor`            | Base color for guides (defaults to `oklch(0.63 0.26 29.23)`).                 |
| `arrowColor`            | Base color for arrows (defaults to `oklch(0.63 0.26 29.23)`).                 |
| `guideHighlightEnabled` | Highlights guides when they are hovered or selected. Default `true`.          |
| `hoverHighlightEnabled` | Disables hover highlight and deselects on click when `false`.                 |
| `layoutDetailsEnabled`  | Shows gap and padding under selected dimensions. Default `true`.              |
| `persistOnReload`       | Persists workspace state across reloads; defaults to `true`.                  |
| `shortcutsEnabled`      | Enables global keyboard shortcuts when `true`. Default `true`.                |
| `persistKey`            | Optional workspace storage key; default workspaces are isolated per browser tab. |
| `portalTarget`          | Optional element or shadow root used as the overlay portal mount target.      |
| `persistence`           | Optional storage adapter for custom or extension-backed persistence.           |
| `bridge`                | Keep comments in the project through the dev server (see [Agent bridge](#agent-bridge)). `true` or an endpoint. |
| `captureVisibleTab`      | Optional function supplying a PNG of the visible tab for Screenshot capture.  |
| `features`               | Enable or disable `screenshot`, `rulers`, `settings`, and `responsive`; each defaults to `true`. |
| `onPersistenceError`    | Called when persistence is unavailable or a storage write fails.              |
| `colorPickerFormats`     | Color formats displayed in the picker popover, in display order.             |
| `colorPickerClickFormat` | Format copied to the clipboard when a color is picked.                       |
| `snapEnabled`            | Snap selection to nearby elements. Default `true`.                           |
| `snapGuidesEnabled`      | Snap guides to other guides. Default `true`.                                 |
| `snapArrowsEnabled`      | Snap arrow endpoints to nearby elements. Default `true`.                     |
| `arrowClickToPlace`      | Place arrows with clicks instead of drag gestures. Default `false`.           |
| `selectNewGuideEnabled`  | Highlight a guide when it is placed. Default `true`.                         |
| `multiMeasureEnabled`    | Keep previous measurements visible. Default `false`.                         |
| `guideStyle`             | Guide opacity, width, pattern, dash length, and gap.                         |
| `rulerSettings`          | Ruler opacity and edge reveal.                                               |
| `textStyle`              | Font, color, and background new text notes start with.                       |

Props are the defaults. Saved settings override them; **Use defaults** restores the props.

## Commands

| Shortcut               | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| `M`                    | Toggle Comments mode.                                 |
| `E`                    | Toggle the Tweak tool.                                |
| `` ` ``                | Minimize Mesurer to use the page (comment pins stay), or bring it back. |
| `I`                    | Toggle Inspect mode.                                  |
| `S`                    | Toggle Select mode for annotations.                   |
| `A`                    | Toggle Typography mode.                               |
| `D`                    | Toggle Arrows mode.                                   |
| `N`                    | Toggle Pen mode.                                      |
| `T`                    | Toggle Text mode.                                     |
| `1`                    | Switch to the Select & Inspect tools.                 |
| `2`                    | Switch to the Annotate tools.                         |
| `P`                    | Open the native color sampler.                        |
| `C`                    | Drag a region of the visible tab for a screenshot.    |
| `V`                    | Drag a region of the visible tab to record a video.  |
| `G`                    | Toggle Guides mode.                                   |
| `X`                    | Toggle X-ray mode.                                    |
| `R`                    | Toggle pixel rulers along the top and left edges.     |
| `B`                    | Preview the page at other screen sizes.               |
| `H`                    | Set guide orientation to horizontal.                  |
| `V`                    | Set guide orientation to vertical.                    |
| `Alt`                  | Temporarily enable option/guide measurement overlays. |
| `Option + S` / `Alt + S` | Pin the measurement currently shown under `Option` / `Alt` so it stays on screen. |
| `Esc`                  | Close an open panel, cancel the current interaction, or deselect the tool. Press again to minimize Mesurer. |
| `Backspace` / `Delete` | Remove selected guides, arrows, pen strokes, or text. |
| `Cmd/Ctrl + Z`         | Undo.                                                 |
| `Cmd/Ctrl + Shift + Z` | Redo.                                                 |
| `Cmd/Ctrl + A`         | Select all annotations.                               |
| `Cmd/Ctrl + ,`         | Open Settings.                                        |
| `Cmd/Ctrl + K`         | Copy comments for an agent.                           |

`initialState` accepts `enabled`, `minimized`, `toolbarPosition`, `toolMode`, guides, arrows, pen strokes, text annotations, measurements, and comments. Saved workspace state overrides it.

```tsx
<Mesurer initialState={{ minimized: true, toolbarPosition: { x: 24, y: 24 } }} />
```

## Agent bridge

With the bridge on, comments are kept in `.mesurer/comments.json` in your project (the folder
ignores itself in git). A coding agent reads them, replies and resolves them with the CLI, and
the browser shows that live. It runs only on the dev server.

```js
// astro.config.mjs (or vite.config.ts: plugins: [mesurer()])
import mesurer from "mesurer/vite";
export default defineConfig({ vite: { plugins: [mesurer()] } });
```

```astro
<Mesurer client:only="react" bridge={import.meta.env.DEV} />
```

```sh
npx mesurer comments list            # open comments, with source file:line when Astro gives one
npx mesurer comments show <id>
npx mesurer comments reply <id> "…"
npx mesurer comments resolve <id> "what changed"
npx mesurer comments instructions    # the guide for agents (bridge/AGENT.md)
```

For other Node servers, `mesurer/server` exports `createCommentsHandler()`, a Connect-style
middleware. In React apps, `createBridgePersistence()` can be passed as `persistence`.

## Tweak tool

Press `E`, click an element, and change it with the keyboard: `↑`/`↓` change the value
(`Shift` for ×10), `←`/`→` move between properties, `T` snaps to the page's tokens (Tailwind v4
`@theme`, shadcn variables, any `:root` custom properties), `A` applies to every element with the
same classes, hold `B` to see before. `Enter` saves the changes as a comment with exact
`from → to` values and tokens, `Esc` reverts. Saved changes stay previewed until the page's own
CSS matches them.

## Features

- **Inspect mode** - Click elements to measure their bounds
- **Annotation tools** - Draw arrows, freehand pen strokes, and text notes
- **Annotation selection** - Select, move, resize, rotate, delete, and multi-select annotations
- **Guides mode** - Add configurable column, row, and pixel grid guides
- **Rulers** - Drag guides from pixel rulers along the top and left edges
- **Typography** - Inspect typography styles and pin text details
- **X-ray mode** - Reveal element structure without changing the page
- **Responsive** - Preview the page at several screen sizes side by side, from named devices or its own breakpoints
- **Sample color** - Sample rendered colors and copy values in your chosen format
- **Screenshot** - Drag a region of the visible tab and copy or download it. In a React integration without the extension, the browser may show a tab-sharing prompt.
- **Video recording** - Drag a region of the visible tab, record up to 60 seconds, trim the result, and export it as WebM, GIF, or MP4 when supported. The Chrome extension records the active tab without a second sharing prompt.
- **Distance overlays** - Hold Alt for quick spacing checks
- **Undo/redo** - Command history for guides, measurements, arrows, pen strokes, and text annotations
- **Comments** - Pin threads to live elements, add replies, move targets, search threads, and copy structured feedback for agents
- **Agent bridge** - Keep comments in the project for a coding agent to answer and resolve, live
- **Tweak** - Nudge spacing, radius, type and colors with the keyboard, snapped to design tokens, and hand the exact changes to an agent
- **Settings** - Configure selection, guide, ruler, arrow, color, format, and persistence behavior
- **Workspace controls** - Persist page workspaces, restore defaults, clear annotations, and minimize Mesurer to a single toolbar button (from the toolbar or with `` ` ``), keeping comment pins on the page

## Requirements

- React 18+
- Chromium-based browser. The native screen color picker requires Chromium on Windows or macOS; Linux Chromium builds may not expose the EyeDropper API.
- Video recording uses the Chrome extension's tab-capture integration for the smoothest active-tab workflow. Without the extension, browser capture permissions and supported export formats depend on the browser. MP4 requires browser WebCodecs support.

Settings are stored separately from workspace state. The default adapter uses `localStorage`; integrations can provide a `persistence` adapter such as the browser extension's `chrome.storage.local` implementation.

## License

Licensed under the MIT License.
