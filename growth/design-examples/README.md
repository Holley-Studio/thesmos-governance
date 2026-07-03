# Design Examples — Marketing Reference Set

Rendered JPEGs for planning `growth/` marketing materials. Each `.jpg` has a matching
`.html` source (self-contained, no network requests, brand tokens in `_theme.css`
mirrored from `website/index.html`).

## Files

| JPEG | Maps to | Size |
|---|---|---|
| `ph-01-council-transcript.jpg` | PH gallery slide 1 — "You always know who's working for you" | 1270×760 |
| `ph-02-live-routing.jpg` | PH gallery slide 2 — "Watch them work. Live." | 1270×760 |
| `ph-03-decision-card.jpg` | PH gallery slide 3 — adapts `growth/council-card-template.html` | 1270×760 |
| `ph-04-platform-grid.jpg` | PH gallery slide 4 — "One pantheon, everywhere" | 1270×760 |
| `ph-05-tiers.jpg` | PH gallery slide 5 — "Start free, summon everyone later" | 1270×760 |
| `x-god-drop-card.jpg` | X/Twitter card for `god-drop-template.md` | 1200×675 |
| `email-header-banner.jpg` | Email header for `god-drop-template.md` | 1200×400 |

Product Hunt slide briefs are from `growth/product-hunt/launch-kit.md`. The god-drop
formats use Techne as a placeholder example — swap in whichever god is actually
shipping that month.

## Regenerating

Requires the `playwright` npm package and a matching Chromium build (not part of
this repo's dependencies — install into a scratch location, don't add to
`package.json`):

```
npm install playwright --no-save --prefix /path/to/scratch
npx --prefix /path/to/scratch playwright install chromium
node render.mjs   # run from a location where `playwright` resolves
```

Edit the `.html` files directly, then re-run `render.mjs` to refresh the JPEGs.
