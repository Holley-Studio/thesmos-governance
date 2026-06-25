# Brand Guide
# Copy this file to `.thesmos/brand-guide.md` in your project and fill it in.
# The Creative Director agent reads this file to give you brand-specific feedback
# rather than generic best-practice advice.

---

## Project

**Product name:** [Your Product]
**Brand tone:** [e.g. Minimal & professional / Playful & approachable / Bold & editorial]
**Design language:** [e.g. Clean SaaS, Dark console, Marketing-forward, Data-dense]

---

## Colors

### Primary palette (CSS variables or Tailwind config keys)
```
Primary:       var(--color-primary)     / bg-primary       — [your hex, e.g. #3B82F6]
Primary dark:  var(--color-primary-dark)/ bg-primary-dark  — [e.g. #2563EB]
Secondary:     var(--color-secondary)   / bg-secondary     — [e.g. #10B981]
Accent:        var(--color-accent)      / bg-accent        — [e.g. #F59E0B]
```

### Semantic colors
```
Danger:        var(--color-danger)      / bg-danger        — [e.g. #EF4444]
Warning:       var(--color-warning)     / bg-warning       — [e.g. #F97316]
Success:       var(--color-success)     / bg-success       — [e.g. #22C55E]
Info:          var(--color-info)        / bg-info          — [e.g. #06B6D4]
```

### Neutral scale
```
Surface:       bg-white / dark:bg-gray-900
Card:          bg-gray-50 / dark:bg-gray-800
Border:        border-gray-200 / dark:border-gray-700
Muted text:    text-gray-500 / dark:text-gray-400
Body text:     text-gray-900 / dark:text-gray-100
```

### Forbidden colors
<!-- Colors that must NEVER be used directly — always via token -->
- Never use Tailwind primitive `blue-500` directly — use `primary` semantic token
- Never use `red-500` directly — use `danger` semantic token
- Never use hex values directly in components

---

## Typography

### Font families
```
Sans (body):   font-sans  →  var(--font-sans)   →  [e.g. Inter, system-ui]
Mono (code):   font-mono  →  var(--font-mono)   →  [e.g. JetBrains Mono, Fira Code]
Display:       font-display → var(--font-display) → [e.g. Cinzel, Playfair Display] (if any)
```

### Type scale (Tailwind text-* classes)
```
Hero:          text-5xl / text-6xl  (48–60px)
H1:            text-4xl             (36px)
H2:            text-3xl             (30px)
H3:            text-2xl             (24px)
H4:            text-xl              (20px)
Body:          text-base            (16px)
Small:         text-sm              (14px)
Caption:       text-xs              (12px)
```

### Font weights
```
Bold (headings, CTAs):  font-semibold (600) or font-bold (700)
Regular (body):         font-normal (400)
Light (captions, meta): font-light (300) — use sparingly
```

### Forbidden
- No `font-black` (900) — too heavy for our brand
- No pixel font sizes in components — always use Tailwind text-* utilities
- No mixing font families within the same UI section

---

## Spacing

### Scale
We use Tailwind's default 4px base spacing scale. All spacing must be a multiple of 4.

```
Micro:   space-1  (4px)   — icon gaps, badge padding
Tiny:    space-2  (8px)   — tight internal padding
Small:   space-3  (12px)  — compact element padding
Default: space-4  (16px)  — standard component padding
Medium:  space-6  (24px)  — section internal spacing
Large:   space-8  (32px)  — component separation
XL:      space-12 (48px)  — section separation
2XL:     space-16 (64px)  — major section breaks
```

### Grid
- Max content width: `max-w-7xl` (1280px)
- Page padding: `px-4 sm:px-6 lg:px-8`
- Card grid gap: `gap-4` (16px) or `gap-6` (24px)

---

## Border radius

```
None:   rounded-none  (0)
Small:  rounded       (4px)   — tags, badges
Medium: rounded-md    (6px)   — inputs, buttons
Large:  rounded-lg    (8px)   — cards, modals
XL:     rounded-xl    (12px)  — hero cards, panels
Full:   rounded-full  (9999px)— pills, avatars
```

Never use arbitrary border-radius values. Use `var(--radius)` if referencing from CSS.

---

## Shadows / Elevation

```
Level 1 (cards):       shadow-sm
Level 2 (dropdowns):   shadow-md
Level 3 (modals):      shadow-lg
Level 4 (overlays):    shadow-xl
Focus ring:            ring-2 ring-primary ring-offset-2
```

Never use hardcoded `box-shadow` values — always use Tailwind shadow utilities.

---

## Component library

**Primary library:** [e.g. shadcn/ui / Radix UI / Headless UI / MUI / custom]
**Import pattern:** `import { Button } from '@/components/ui/button'`
**Storybook:** [URL if exists]

### Component naming conventions
- Primitive wrappers: PascalCase matching shadcn (`Button`, `Card`, `Input`, `Badge`)
- Page-level components: `[Feature][Page]` (e.g., `DashboardPage`, `SettingsPage`)
- Layout components: `[Name]Layout` (e.g., `AppLayout`, `AuthLayout`)

### Forbidden patterns
- Never use raw `<button>` — always use `<Button>` from the component library
- Never use raw `<input>` — always use `<Input>` from the component library
- Never apply `style={}` to design system components — use variant props instead
- Never `className` override a component's core structure — use the variant API

---

## Icons

**Library:** [e.g. lucide-react / @heroicons/react / phosphor-react]
**Import:** `import { ArrowRight } from 'lucide-react'`

### Sizing
```
Inline with text:   w-4 h-4  (16px)
Button icons:       w-5 h-5  (20px)
Section icons:      w-6 h-6  (24px)
Hero/empty states:  w-8 h-8+ (32px+)
```

### Color
- Always use `currentColor` fill (inherit from text color)
- Never hardcode `fill` or `stroke` colors on icon SVGs
- Icon color should follow the semantic text/action color of its context

### Forbidden
- Never mix icon libraries in the same component
- Never use emoji as icons in UI components

---

## Motion / Animation

**Timing scale:**
```
Instant:   0ms      — no animation (accessibility-safe fallback)
Fast:      100ms    — micro-interactions (hover, click feedback)
Normal:    200ms    — most UI transitions
Slow:      300ms    — panel open/close, route transitions
Sluggish:  500ms+   — use sparingly; only for emphasis
```

**Easing:** `ease-in-out` for most transitions; `ease-out` for enter animations; `ease-in` for exit.

**Rules:**
- Always wrap animations in `@media (prefers-reduced-motion: reduce)` or use Tailwind's `motion-safe:` prefix
- Never use arbitrary ms values — stick to the scale above
- Transitions on hover/focus should be `duration-150 ease-in-out`

---

## Z-index scale

```
Base:       z-0
Raised:     z-10   — cards, sticky elements
Dropdown:   z-20   — menus, tooltips
Modal:      z-30   — dialogs, sheets
Overlay:    z-40   — backdrops
Toast:      z-50   — notifications, toasts
```

Never use arbitrary z-index values. Everything goes through this scale.

---

## Dark mode

**Strategy:** Tailwind `dark:` class variant (class-based, not system preference)
**Root class:** `dark` applied to `<html>` element

Every interactive component must have explicit dark mode classes. Test the following in dark mode before shipping:
- Background colors
- Text colors
- Border colors
- Shadow visibility
- Focus ring visibility
- Icon color inheritance

---

## Copy / Voice

**Tone:** [e.g. Direct, confident, never condescending]

### Error messages
- Lead with what happened, then what to do next
- Never say "Something went wrong" — be specific
- Never use technical error codes in user-facing copy
- Example: "We couldn't save your changes. Try again, or contact support if this keeps happening."

### Empty states
- Include: an icon, a headline, a 1-2 sentence explanation, a CTA
- Tone: helpful, not apologetic
- Example: "No projects yet — Create your first project to get started."

### Loading states
- Use skeleton screens for content that takes > 300ms
- Use a spinner only for instant actions (form submit, button click)
- Copy: "[Verb]ing..." (e.g., "Saving...", "Loading dashboard...")

### Forbidden copy patterns
- Never: "Please" at the start of instructions
- Never: "Click here" — use the action name ("View dashboard", not "Click here to view the dashboard")
- Never: Ellipsis for loading text in buttons — use "Saving..." not "Saving..."

---

## Design Config (`.thesmos/config.json`)

Thesmos design rules work out of the box for any stack, but you can customize the scales and library list in your `.thesmos/config.json`. All fields are optional — only set what differs from the defaults.

```json
{
  "design": {
    "cssFramework": "tailwind",

    "iconLibraries": ["@myorg/icons", "@mui/icons-material"],

    "borderRadiusScale": [0, 2, 4, 6, 8, 12, 16, 24, 9999],

    "animationScale": [75, 100, 150, 200, 300, 500, 700, 1000],

    "opacityScale": [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]
  }
}
```

### Which rules these control

| Config key | Rule | Effect |
|---|---|---|
| `iconLibraries` | DESIGN_016 | Adds your packages to the mixed-icon detection list |
| `borderRadiusScale` | DESIGN_010 | Replaces the default Tailwind radius scale |
| `animationScale` | DESIGN_014 | Replaces the default Tailwind duration scale |
| `opacityScale` | DESIGN_018 | Replaces the default Tailwind opacity scale |
| `cssFramework` | (informational) | Documents your framework; Tailwind rules auto-detect from syntax |

### Common customizations by stack

**Material UI / MUI:** MUI uses a 4px base grid with different breakpoints. Update your borderRadiusScale to [0, 4, 8, 12, 16, 24, 9999] and add `"@mui/icons-material"` to iconLibraries.

**styled-components / Emotion:** Add your custom icon package if it's not in the built-in list. The hex color, font, shadow, and z-index rules all fire on `.tsx` files regardless of CSS framework.

**Vanilla CSS / CSS Modules:** The spacing rules check for `style={}` prop patterns in JSX, which still applies. All hex color, font-family, and CSS-in-JS rules work without Tailwind.

**Custom design system:** Set `borderRadiusScale`, `animationScale`, and `opacityScale` to match your token values precisely. Any value outside your scale gets flagged.

---

## What to catch / common AI drift patterns

When AI tools generate UI without this guide, they typically:

1. **Use Tailwind primitive colors** (`bg-blue-500`) instead of semantic tokens (`bg-primary`)
2. **Hardcode hex values** in inline styles
3. **Skip dark mode** — all components come out light-mode only
4. **Forget focus states** — `outline-none` with no `focus-visible:` alternative
5. **Mix icon libraries** — Heroicons in one component, Lucide in another
6. **Use magic pixel values** — `padding: '13px'` instead of `p-3`
7. **Inline style design system components** — `<Button style={{ color: 'blue' }}>` instead of `<Button variant="primary">`
8. **Pick arbitrary animation durations** — `transition: 'all 0.237s'` instead of `duration-200`
9. **Use raw HTML elements** — `<input>` instead of `<Input>`, `<button>` instead of `<Button>`
10. **Ignore responsive design** — fixed widths with no breakpoints

Flag all of the above in every review.
