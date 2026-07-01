# Workflow: Figma to Ship

> **When to use:** Taking a design from Figma concept through design system compliance, code annotation, accessibility verification, and developer handoff.
>
> **Trigger phrase to Eidos:** `"Ship [feature/component] from Figma to dev-ready handoff."`
>
> **Agents involved:** Eidos (orchestrator) → Mnemon → Techne → Ergon → Hephaestus → (optional) Talos
>
> **Estimated sessions:** 2–4 sessions depending on design system complexity.

---

## Overview: The Figma Cluster

The Figma sub-cluster is a 9-agent system orchestrated by **Eidos**. For design-to-ship work, the core pipeline uses 4 agents:

| Agent | Role | When to invoke |
|---|---|---|
| **Eidos** (🎭) | Figma Orchestrator | Always first — routes all Figma work |
| **Mnemon** | Design Memory & Context | Pull prior decisions, component inventory, design tokens |
| **Techne** | Design System Auditor | Confirm token compliance, component state completeness, Dev Mode alignment |
| **Ergon** | Code Annotation | Generate annotated Figma frames ready for developer handoff |
| **Hephaestus** (🔨) | Design Systems | WCAG 2.1 AA accessibility review, responsive spec |

---

## Phase 1 — Context & Design Memory

### Step 1: Eidos receives the design request

Eidos is the entry point for all Figma work. Never invoke Mnemon, Techne, or Ergon directly — route through Eidos.

```
🎭 EIDOS — FIGMA ORCHESTRATION

Received: Design request for [feature/component].

Context pull in progress — routing to Mnemon to establish existing component inventory,
prior design decisions, and token map before design work begins.

Routing:
  • Mnemon → Pull context: prior decisions for [feature area], component inventory, token map

Dependency order:
  1. Mnemon delivers context (required before Techne or Ergon — avoids recreating what exists)
  2. Techne audits design system compliance (after we know what exists)
  3. Ergon generates code layers (after Techne confirms compliance)
  4. Hephaestus reviews accessibility (before handoff)
```

---

### Step 2: Mnemon — Design Context Pull

**Trigger:** "Mnemon, pull context for [feature area]: existing component inventory, prior design decisions, and current token map."

**Mnemon delivers:**
- Prior design decisions relevant to this feature (ADR-equivalent for design choices)
- Existing component inventory: which components from the design system can be reused vs. need to be created
- Design token map: which tokens apply to this feature area (color, typography, spacing, elevation, border-radius)
- Component usage patterns: how similar features were built previously
- Open design debt: any known inconsistencies or deprecated components in this area

**Quality gate:** If Mnemon surfaces that the requested component already exists in the design system under a different name or in a slightly different form, Eidos routes back to the requester for confirmation before proceeding: "A similar component exists as [Component Name] — do you want to extend it or create a new variant?"

---

## Phase 2 — Design System Compliance Audit

### Step 3: Techne — Design System Audit

**Trigger:** "Techne, audit [component/screen] for design system compliance. Reference Mnemon's token map: [paste token map]. Flag token gaps, missing component states, and Dev Mode alignment issues."

**Techne delivers:**

**Token compliance report:**
- ✅ Colors: all hex values matched to design tokens (flag any hardcoded hex)
- ✅ Typography: all text styles use defined type tokens (flag any custom font-size or line-height)
- ✅ Spacing: all padding/margin values align to the spacing scale (flag any off-grid values)
- ✅ Elevation: shadow values matched to elevation tokens
- ⚠️ Token gap: [specific value] not represented in the current token set — recommend adding `[token-name]` to the token library before handoff

**Component state completeness:**

Every interactive component must have all states defined:
| Component | Default | Hover | Focus | Active | Disabled | Error | Loading | Empty |
|---|---|---|---|---|---|---|---|---|
| [Component] | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ Missing | ⚠️ Missing | — |

Missing states must be designed before handoff. Ergon cannot annotate a state that does not exist in the Figma file.

**Dev Mode alignment check:**
- Component names in Figma match the codebase component names (from Mnemon's inventory)
- Layer names are clean (no "Frame 47", "Rectangle 12" — must be semantic layer names)
- Auto-layout is used instead of fixed-size frames wherever responsive behavior is needed
- Variants are organized with consistent property naming (not "State=Hover" in one component and "variant=hover" in another)

**Quality gate:** Techne output is a blocklist. Any component with missing states, hardcoded hex values, or misaligned Dev Mode naming is returned to the designer for correction before Ergon begins annotation.

---

## Phase 3 — Code Layer Generation

### Step 4: Ergon — Code Annotations

**Trigger:** "Ergon, generate code layers for [component/screen]. Techne has confirmed compliance. Produce annotated Figma frames ready for developer handoff."

**Ergon delivers:**
- Annotated Figma frames with code layer overlays for each component
- Per-component specification:
  - Component name (matching codebase)
  - Props list: each prop with type, default value, and allowed values
  - Slot definitions: named slots for content injection
  - CSS/Tailwind class mapping (or design token → CSS variable mapping)
  - Interaction behavior: hover state trigger, focus behavior, animation (references Morpheus's motion spec if applicable)
  - Responsive breakpoint behavior: how the component reflows at mobile/tablet/desktop
- Code snippet (starter): React/Vue/HTML structure showing the component with props wired
- Storybook story structure (if applicable): the prop combinations that should be tested as stories

**Ergon handoff format:**
```
Component: [ComponentName]
File: src/components/[path]/[ComponentName].tsx
Props:
  - variant: 'primary' | 'secondary' | 'ghost' (default: 'primary')
  - size: 'sm' | 'md' | 'lg' (default: 'md')
  - disabled: boolean (default: false)
  - loading: boolean (default: false)
  - onClick: () => void

States defined: default, hover, focus, active, disabled, loading
Token usage: color.interactive.primary, spacing.md, typography.label.md
Animation: 150ms ease-out on hover (Morpheus spec: --motion-fast)
Responsive: full-width on mobile (<768px), auto-width on tablet+
```

---

## Phase 4 — Accessibility Review

### Step 5: Hephaestus — WCAG 2.1 AA Review

**Trigger:** "Hephaestus, review [component/screen] for WCAG 2.1 AA compliance and design token adherence before developer handoff."

**Hephaestus delivers:**

**WCAG 2.1 AA checklist:**
- [ ] **Color contrast (1.4.3):** All text/background combinations ≥ 4.5:1 (body text), ≥ 3:1 (large text, UI components)
- [ ] **Focus visible (2.4.7):** Focus indicator present and visible on all interactive elements — no outline-none without focus-visible replacement
- [ ] **Keyboard navigation (2.1.1):** All interactive elements reachable and operable via keyboard
- [ ] **Touch target size (2.5.5):** Interactive targets ≥ 44×44px on mobile
- [ ] **Motion (2.3.3):** `prefers-reduced-motion` behavior specified for all animations (references Morpheus spec)
- [ ] **Alt text (1.1.1):** All meaningful images have alt text specified in the design annotation; decorative images marked `aria-hidden`
- [ ] **Form labels (1.3.1):** All form inputs have associated labels — not placeholder text as the only label
- [ ] **Error messages (3.3.1):** Error states include descriptive error text, not just a red border
- [ ] **ARIA roles:** Interactive custom components specify the correct ARIA role in Ergon's annotation

**Design token compliance (cross-check with Techne):**
- Confirms no hardcoded hex values survived to this phase
- Confirms no hardcoded font sizes survived (all type uses token references)
- Flags any token that has accessibility implications (e.g., a color token that fails contrast in a specific state combination)

**Responsive spec confirmation:**
- Mobile, tablet, and desktop frames verified to exist for all layouts
- Breakpoint behavior confirmed in Ergon's annotation
- Touch vs. cursor interaction differences noted where relevant

**Quality gate:** Hephaestus is the last gate before handoff. Any WCAG 2.1 AA failure blocks handoff. All failures must be resolved and re-reviewed. A component that ships with a contrast failure is a legal liability in accessibility-regulated markets.

---

## Eidos Council Report (Final)

```
🎭 EIDOS — FIGMA COUNCIL REPORT

📚 Mnemon has delivered: Context pull complete. [N] existing components identified as reusable.
   [N] new components required. Token map established for [feature area].

⚙️ Techne has delivered: Design system audit complete.
   Token compliance: ✅ (0 hardcoded values remaining).
   Component states: ✅ ([N] states defined across [M] components).
   Dev Mode alignment: ✅ (layer names clean, auto-layout confirmed).

🔧 Ergon has delivered: Code annotations complete for [N] components.
   Developer handoff ready at: [Figma file link / layer reference].

🔨 Hephaestus has delivered: WCAG 2.1 AA review complete.
   Color contrast: ✅. Focus states: ✅. Keyboard nav: ✅.
   Touch targets: ✅. Motion: ✅ (prefers-reduced-motion specified).
   Accessibility gate: CLEARED.

Handoff status: READY FOR DEVELOPMENT.
Components: [N] | States per component: [N] | Token gaps resolved: [N]

— Eidos | Figma Orchestration
```

---

## Optional Phase 5 — Development Implementation

### Conditional Step 6: Talos — Web Development

**Triggered when:** The design handoff is complete AND the same team is responsible for implementation (not just the design org).

**Trigger:** "Talos, implement [component/screen] based on Ergon's handoff annotation and Hephaestus's WCAG spec. Reference the code snippet in Ergon's output."

**Talos delivers:**
- Component implementation in the project's framework (React/Vue/Next.js)
- Token references wired: CSS variables or Tailwind config tokens used throughout (no hardcoded values)
- All states implemented: default, hover, focus, active, disabled, error, loading
- Keyboard interaction wired: Tab focus, Enter/Space activation, Escape dismissal where applicable
- ARIA attributes implemented per Hephaestus's spec
- Storybook stories created: one story per major state combination
- Unit tests for interactive behavior (click handler called, disabled state prevents interaction)

---

## Handoff contracts

| From | To | What is handed off |
|---|---|---|
| Eidos | Mnemon | Feature area, request scope |
| Mnemon | Eidos | Prior decisions, component inventory, token map |
| Eidos | Techne | Component/screen scope + Mnemon's token map |
| Techne | Eidos | Compliance blocklist (must be resolved before Ergon starts) |
| Eidos | Ergon | Compliance-confirmed screens + component list |
| Ergon | Eidos | Annotated frames + code handoff specs per component |
| Eidos | Hephaestus | Annotated screens + Ergon's state map |
| Hephaestus | Eidos | WCAG checklist result + any remaining blockers |
| Eidos | Talos | Full handoff package: Ergon annotations + Hephaestus WCAG spec |

---

## Quick reference: when to use each Figma agent directly

| Task | Route to |
|---|---|
| "Is this component in our design system already?" | Mnemon |
| "Does this Figma frame use the right tokens?" | Techne |
| "Generate code annotations for this screen" | Ergon |
| "Check this design for accessibility" | Hephaestus |
| "Design a new component from scratch" | Eidos (will route internally) |
| "Implement this Figma design in code" | Talos (via Eidos handoff) |
| "Animate this interaction" | Morpheus (separate from Figma cluster) |
