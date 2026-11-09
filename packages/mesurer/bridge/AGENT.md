# Mesurer comments: instructions for coding agents

People leave comments on the running site with Mesurer. With the dev-server bridge on, every
comment is kept in `.mesurer/comments.json` in the project, and you answer them with the
`mesurer` CLI. The person's browser shows your replies and resolutions live.

## Commands

```sh
npx mesurer comments list            # open comments: short id, page, first message, source file
npx mesurer comments list --all      # resolved ones too
npx mesurer comments show <id>       # everything about one: element, source:line, styles, messages, changes
npx mesurer comments reply <id> "…"  # ask a question or say what you are doing
npx mesurer comments resolve <id> "what you changed"
npx mesurer comments reopen <id>
```

Add `--json` to `list` or `show` for machine-readable output. An `<id>` can be the short id that
`list` prints.

## How to work through them

1. `list`, then `show` each comment before acting on it.
2. Find the code:
   - **Source** (for example `src/pages/index.astro:42:5`) is the file and line the element came
     from. Start there. It points at the nearest element that has a source; for a component
     rendered inside it, follow the component.
   - Without a source, search for the element's text, classes or selector.
   - **Viewport** says how wide the window was. If a change only makes sense at that width, put
     it in a media query or a responsive class instead of changing every width.
3. **Requested style changes** (a "tweak") are exact: `property: from → to`. If a token is given,
   use the token or the class that maps to it instead of the raw value:
   - `--radius-lg`, `--text-sm`, `--color-red-500`: Tailwind `rounded-lg`, `text-sm`,
     `text-red-500` / `bg-red-500`; elsewhere `var(--radius-lg)`.
   - `--spacing * 6` is Tailwind v4's spacing scale: `p-6`, `px-6`, `gap-6`, `mt-6`.
   - shadcn role colors (`--primary`, `--muted-foreground`): `text-primary`, `bg-muted` and so on.
   Changes to `padding-left` and `padding-right` together are one `px-*`; top and bottom one `py-*`.
   A change's `selector` that is a tag and classes (`a.btn.btn-primary`) means the person wanted
   it on every element with those classes: change the shared class or component, not one place.
4. Make the change in the source. Don't edit `.mesurer/comments.json` by hand: the CLI merges
   with what the browser is saving at the same moment, and a hand edit can lose it.
5. `resolve <id> "note"`, with a short note on what you changed (file and what). If you could not
   do it, or need a decision, `reply` instead and leave it open.

Never resolve a comment you did not act on. A reply from the person after you resolve reopens it.
