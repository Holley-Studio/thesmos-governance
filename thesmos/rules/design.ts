// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isReactFile = (p: string) => /\.(tsx|jsx)$/.test(p);
const isCSSFile = (p: string) => /\.(css|scss|sass|less)$/.test(p);
const isDesignFile = (p: string) => /\.(tsx|jsx|css|scss|sass|less)$/.test(p);
const isTestOrStory = (p: string) => /\.(test|spec|stories)\.(tsx?|jsx?)$|__tests__\/|__mocks__\//.test(p);
const isDesignTokenFile = (p: string) => /tailwind\.config|tokens\.|globals\.css|theme\.|design[-_]system|design-tokens/.test(p);

export const DESIGN_RULES: ThesmosRule[] = [
  // ── DESIGN_001: Hardcoded hex color ─────────────────────────────────────
  {
    id: 'DESIGN_001',
    category: 'design_hardcoded_hex_color',
    description: 'Hardcoded hex color in style prop or CSS — bypasses design tokens.',
    severity: 'HIGH',
    tags: ['design', 'tokens', 'color'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Hardcoded hex values bypass the design token system, making global theme changes impossible and creating visual inconsistencies.',
      commonViolations: [
        "style={{ color: '#3B82F6' }}",
        "background: '#FF5733'",
      ],
      goodExample: "style={{ color: 'var(--color-primary)' }} or className=\"text-primary\"",
      badExample: "style={{ color: '#3B82F6' }} // ❌ hardcoded hex color",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_hex_color', config.severityRules);
      const findings: Finding[] = [];
      const HEX_COLOR_RE = /(?:color|background|backgroundColor|borderColor|fill|stroke|outlineColor)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/;
      for (const { path, content } of changedFiles) {
        if ((!isReactFile(path) && !isCSSFile(path)) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\/|^\s*\/\*/.test(line)) continue;
          if (HEX_COLOR_RE.test(line)) {
            findings.push({
              severity: sev, category: 'design_hardcoded_hex_color', file: path, line: i + 1,
              message: 'Hardcoded hex color bypasses design tokens — use a CSS variable or Tailwind class instead.',
              suggestion: 'Replace with a CSS variable (var(--color-primary)) or a Tailwind semantic color class.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_002: Tailwind arbitrary color ─────────────────────────────────
  {
    id: 'DESIGN_002',
    category: 'design_tailwind_arbitrary_color',
    description: 'Tailwind arbitrary color value (e.g. text-[#3B82F6]) bypasses the design token palette.',
    severity: 'MEDIUM',
    tags: ['design', 'tokens', 'color', 'tailwind'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Arbitrary color values in Tailwind bypass the configured color palette, leading to inconsistent colors that cannot be controlled via theme.',
      commonViolations: [
        'className="text-[#3B82F6]"',
        'className="bg-[rgba(59,130,246,0.5)]"',
      ],
      goodExample: 'className="text-blue-500" or className="text-primary"',
      badExample: 'className="text-[#3B82F6]" // ❌ arbitrary color bypasses palette',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_tailwind_arbitrary_color', config.severityRules);
      const findings: Finding[] = [];
      const ARBITRARY_COLOR_RE = /class(?:Name)?\s*=\s*["'][^"']*(?:text|bg|border|ring|shadow|from|to|via|fill|stroke|caret|accent|decoration)-\[(?:#[0-9a-fA-F]{3,8}|rgb)/;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (ARBITRARY_COLOR_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'design_tailwind_arbitrary_color', file: path, line: i + 1,
              message: 'Tailwind arbitrary color value bypasses the design token palette.',
              suggestion: 'Use a palette color (text-blue-500) or a semantic token class (text-primary).',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_003: Inline style spacing ─────────────────────────────────────
  {
    id: 'DESIGN_003',
    category: 'design_inline_style_spacing',
    description: 'Inline style with arbitrary px spacing bypasses the spacing scale.',
    severity: 'MEDIUM',
    tags: ['design', 'spacing', 'tailwind'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Arbitrary pixel spacing values bypass the spacing scale, creating visual inconsistencies that are hard to maintain.',
      commonViolations: [
        "style={{ padding: '13px' }}",
        "style={{ marginTop: '7px' }}",
      ],
      goodExample: 'className="p-4 mt-2" using Tailwind spacing classes',
      badExample: "style={{ padding: '13px' }} // ❌ arbitrary px spacing",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_inline_style_spacing', config.severityRules);
      const findings: Finding[] = [];
      const SPACING_RE = /style\s*=\s*\{\{[^}]*(?:(?:padding|margin|inset)\w*|gap|top|left|right|bottom)\s*:\s*['"]?\d+px/;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SPACING_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'design_inline_style_spacing', file: path, line: i + 1,
              message: 'Inline style with arbitrary px spacing bypasses the spacing scale — use Tailwind classes.',
              suggestion: 'Use Tailwind spacing utilities (p-4, mt-2, gap-3) or CSS variables instead.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_004: Hardcoded font-family ────────────────────────────────────
  {
    id: 'DESIGN_004',
    category: 'design_hardcoded_font_family',
    description: 'Hardcoded font-family bypasses design system typography.',
    severity: 'HIGH',
    tags: ['design', 'typography', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Hardcoded font families make it impossible to swap fonts globally through theme configuration.',
      commonViolations: [
        "fontFamily: 'Arial, sans-serif'",
        "font-family: 'Inter'",
      ],
      goodExample: "fontFamily: 'var(--font-sans)'",
      badExample: "fontFamily: 'Arial, sans-serif' // ❌ hardcoded font family",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_font_family', config.severityRules);
      const findings: Finding[] = [];
      const FONT_FAMILY_RE = /(?:fontFamily|font-family)\s*:\s*['"][^'"$][^'"]*['"]/;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const match = FONT_FAMILY_RE.exec(line);
          if (match) {
            // Skip values starting with var(, inherit, initial, unset
            const valueMatch = /(?:fontFamily|font-family)\s*:\s*['"]([^'"]+)['"]/.exec(line);
            if (valueMatch) {
              const val = valueMatch[1]!.trim();
              if (val.startsWith('var(') || /^(?:inherit|initial|unset)/.test(val)) continue;
            }
            findings.push({
              severity: sev, category: 'design_hardcoded_font_family', file: path, line: i + 1,
              message: 'Hardcoded font-family bypasses design system typography — use a CSS variable.',
              suggestion: "Use fontFamily: 'var(--font-sans)' or a Tailwind font utility class.",
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_005: Hardcoded font-size ──────────────────────────────────────
  {
    id: 'DESIGN_005',
    category: 'design_hardcoded_font_size',
    description: 'Hardcoded pixel font size bypasses the typography scale.',
    severity: 'MEDIUM',
    tags: ['design', 'typography', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Arbitrary pixel font sizes bypass the type scale, creating visual inconsistency.',
      commonViolations: [
        "fontSize: '15px'",
        'font-size: 13px',
      ],
      goodExample: 'Tailwind text-sm, text-base, or CSS variable from the typography scale',
      badExample: "fontSize: '15px' // ❌ arbitrary pixel font size",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_font_size', config.severityRules);
      const findings: Finding[] = [];
      const FONT_SIZE_RE = /(?:fontSize|font-size)\s*:\s*['"]?\d+px['"]?/;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (FONT_SIZE_RE.test(line) && !/var\(/.test(line)) {
            findings.push({
              severity: sev, category: 'design_hardcoded_font_size', file: path, line: i + 1,
              message: 'Hardcoded pixel font size — use a Tailwind text utility or CSS variable from the typography scale.',
              suggestion: 'Use Tailwind text-sm, text-base, text-lg, etc. or a CSS variable like var(--text-sm).',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_006: Magic z-index ─────────────────────────────────────────────
  {
    id: 'DESIGN_006',
    category: 'design_magic_z_index',
    description: 'Magic z-index value — use a named token or Tailwind z-* utility.',
    severity: 'MEDIUM',
    tags: ['design', 'z-index', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Magic z-index numbers create stacking context nightmares that are impossible to reason about or maintain.',
      commonViolations: [
        'zIndex: 47',
        'z-index: 999',
      ],
      goodExample: "zIndex: 'var(--z-modal)' or className=\"z-50\"",
      badExample: 'zIndex: 47 // ❌ magic z-index',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_magic_z_index', config.severityRules);
      const findings: Finding[] = [];
      const Z_INDEX_RE = /(?:zIndex|z-index)\s*:\s*['"]?(\d+)['"]?/;
      const SKIP_VALUES = new Set(['0', '1', 'auto']);
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/var\(/.test(line)) continue;
          const m = Z_INDEX_RE.exec(line);
          if (m) {
            const val = m[1]!;
            if (SKIP_VALUES.has(val)) continue;
            // Also skip -1
            const num = parseInt(val, 10);
            if (num === -1) continue;
            findings.push({
              severity: sev, category: 'design_magic_z_index', file: path, line: i + 1,
              message: 'Magic z-index value — use a named z-index token or Tailwind z-* utility.',
              suggestion: "Use Tailwind z-10, z-20, z-50 etc., or a CSS variable like zIndex: 'var(--z-modal)'.",
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_007: Hardcoded box-shadow ─────────────────────────────────────
  {
    id: 'DESIGN_007',
    category: 'design_hardcoded_shadow',
    description: 'Hardcoded box-shadow bypasses the elevation scale.',
    severity: 'MEDIUM',
    tags: ['design', 'shadow', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Hardcoded shadows bypass the elevation scale and prevent consistent theming (including dark mode shadows).',
      commonViolations: [
        "boxShadow: '0 4px 6px rgba(0,0,0,0.1)'",
      ],
      goodExample: "Tailwind shadow-md, shadow-lg, or boxShadow: 'var(--shadow-card)'",
      badExample: "boxShadow: '0 4px 6px rgba(0,0,0,0.1)' // ❌ hardcoded shadow",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_shadow', config.severityRules);
      const findings: Finding[] = [];
      const SHADOW_RE = /(?:boxShadow|box-shadow)\s*:\s*['"][^'"]+['"]/;
      const SKIP_VALUES = /^(?:none|inherit)/;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!SHADOW_RE.test(line)) continue;
          const valMatch = /(?:boxShadow|box-shadow)\s*:\s*['"]([^'"]+)['"]/.exec(line);
          if (valMatch) {
            const val = valMatch[1]!.trim();
            if (SKIP_VALUES.test(val) || val.startsWith('var(')) continue;
          }
          findings.push({
            severity: sev, category: 'design_hardcoded_shadow', file: path, line: i + 1,
            message: 'Hardcoded box-shadow bypasses the elevation scale — use a Tailwind shadow utility or CSS variable.',
            suggestion: "Use Tailwind shadow-sm, shadow-md, shadow-lg or boxShadow: 'var(--shadow-card)'.",
          });
        }
      }
      return findings;
    },
  },

  // ── DESIGN_008: !important override ──────────────────────────────────────
  {
    id: 'DESIGN_008',
    category: 'design_important_override',
    description: '!important overrides fight the design system — fix specificity instead.',
    severity: 'HIGH',
    tags: ['design', 'css', 'specificity'],
    sinceVersion: '1.7.0',
    explain: {
      why: '!important cascades are a code smell that indicate a specificity problem. They make styles unpredictable and impossible to override later.',
      commonViolations: [
        'color: red !important',
        'className="!p-4"',
      ],
      goodExample: 'Restructure component hierarchy or specificity instead of using !important',
      badExample: 'color: red !important // ❌ !important override',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_important_override', config.severityRules);
      const findings: Finding[] = [];
      const CSS_IMPORTANT_RE = /\s!\s*important\b/i;
      const TW_IMPORTANT_RE = /class(?:Name)?\s*=\s*["'][^"']*![a-z]/;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (CSS_IMPORTANT_RE.test(line) || TW_IMPORTANT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'design_important_override', file: path, line: i + 1,
              message: '!important overrides fight the design system — fix specificity or use a proper design token.',
              suggestion: 'Restructure component specificity or use CSS layers instead of !important.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_009: Tailwind arbitrary dimension ──────────────────────────────
  {
    id: 'DESIGN_009',
    category: 'design_tailwind_arbitrary_dimension',
    description: 'Tailwind arbitrary pixel/rem dimension — use a spacing scale value instead.',
    severity: 'LOW',
    tags: ['design', 'spacing', 'tailwind'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Arbitrary dimensions bypass the spacing scale and create one-off magic numbers that are hard to maintain.',
      commonViolations: [
        'className="w-[347px]"',
        'className="h-[73px]"',
      ],
      goodExample: 'className="w-full", className="w-96", className="max-w-xl"',
      badExample: 'className="w-[347px]" // ❌ arbitrary pixel dimension',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_tailwind_arbitrary_dimension', config.severityRules);
      const findings: Finding[] = [];
      const ARB_DIM_RE = /class(?:Name)?=[^>]*\b[wh]-\[(\d+)(?:px|rem)\]/;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Skip min/max variants
          if (/(?:min|max)-[wh]-\[/.test(line)) continue;
          if (ARB_DIM_RE.test(line)) {
            findings.push({
              severity: sev, category: 'design_tailwind_arbitrary_dimension', file: path, line: i + 1,
              message: 'Arbitrary pixel dimension in Tailwind — use a spacing scale value or a semantic width utility.',
              suggestion: 'Use Tailwind scale values (w-96, h-48, w-full) or max-w-* for container widths.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_010: Hardcoded border-radius ──────────────────────────────────
  {
    id: 'DESIGN_010',
    category: 'design_hardcoded_border_radius',
    description: 'Hardcoded border-radius with off-scale px value.',
    severity: 'LOW',
    tags: ['design', 'border-radius', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Off-scale border-radius values create visual inconsistency across the UI.',
      commonViolations: [
        "borderRadius: '7px'",
        "borderRadius: '13px'",
      ],
      goodExample: "Tailwind rounded, rounded-md, rounded-lg, or var(--radius)",
      badExample: "borderRadius: '7px' // ❌ off-scale radius",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_border_radius', config.severityRules);
      const findings: Finding[] = [];
      const RADIUS_RE = /(?:borderRadius|border-radius)\s*:\s*['"]?(\d+)px['"]?/;
      const SCALE = new Set(config.design?.borderRadiusScale ?? [0, 2, 4, 6, 8, 12, 16, 24, 9999]);
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const m = RADIUS_RE.exec(line);
          if (m) {
            const val = parseInt(m[1]!, 10);
            if (!SCALE.has(val)) {
              findings.push({
                severity: sev, category: 'design_hardcoded_border_radius', file: path, line: i + 1,
                message: 'Hardcoded border-radius — use a Tailwind rounded utility or --radius CSS variable.',
                suggestion: 'Use Tailwind rounded, rounded-sm, rounded-md, rounded-lg, rounded-xl, rounded-full or var(--radius).',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_011: Hardcoded gradient ───────────────────────────────────────
  {
    id: 'DESIGN_011',
    category: 'design_hardcoded_gradient',
    description: 'Gradient with hardcoded hex values bypasses design token palette.',
    severity: 'MEDIUM',
    tags: ['design', 'color', 'tokens', 'gradient'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Gradients with hardcoded hex colors bypass the design palette and cannot be updated via theme configuration.',
      commonViolations: [
        "background: 'linear-gradient(90deg, #3B82F6, #EC4899)'",
      ],
      goodExample: "Tailwind bg-gradient-to-r from-blue-500 to-pink-500, or CSS variable gradient",
      badExample: "background: 'linear-gradient(90deg, #3B82F6, #EC4899)' // ❌ hardcoded gradient colors",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_gradient', config.severityRules);
      const findings: Finding[] = [];
      const GRADIENT_RE = /(?:background|backgroundImage)\s*:\s*['"][^'"]*(?:linear|radial|conic)-gradient\([^)]*#[0-9a-fA-F]/i;
      const CSS_GRADIENT_RE = /background(?:-image)?\s*:\s*(?:linear|radial|conic)-gradient\([^;]*#[0-9a-fA-F]/i;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (GRADIENT_RE.test(line) || CSS_GRADIENT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'design_hardcoded_gradient', file: path, line: i + 1,
              message: 'Gradient with hardcoded hex values — use Tailwind gradient utilities or CSS variable gradient.',
              suggestion: 'Use Tailwind from-blue-500 to-pink-500 gradient classes or a gradient CSS variable.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_012: Missing focus-visible ────────────────────────────────────
  {
    id: 'DESIGN_012',
    category: 'design_missing_focus_visible',
    description: 'outline-none without a focus-visible alternative — keyboard users lose focus indicator.',
    severity: 'HIGH',
    tags: ['design', 'accessibility', 'focus', 'wcag'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Removing the outline without providing a focus-visible alternative violates WCAG 2.4.7 (Focus Visible), making the UI inaccessible for keyboard-only users.',
      commonViolations: [
        'className="focus:outline-none"',
      ],
      goodExample: 'className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500"',
      badExample: 'className="focus:outline-none" // ❌ no focus-visible alternative',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_missing_focus_visible', config.severityRules);
      const findings: Finding[] = [];
      const OUTLINE_NONE_RE = /\boutline-none\b|\boutline:\s*(?:none|0)\b/;
      const FOCUS_VISIBLE_RE = /focus-visible/;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!OUTLINE_NONE_RE.test(lines[i]!)) continue;
          // Check ±3 lines for focus-visible
          const start = Math.max(0, i - 3);
          const end = Math.min(lines.length, i + 4);
          const context = lines.slice(start, end).join('\n');
          if (!FOCUS_VISIBLE_RE.test(context)) {
            findings.push({
              severity: sev, category: 'design_missing_focus_visible', file: path, line: i + 1,
              message: 'outline-none without focus-visible: alternative — keyboard users will see no focus indicator (WCAG 2.4.7).',
              suggestion: 'Add focus-visible:ring-2 focus-visible:ring-offset-2 alongside outline-none.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_013: SVG hardcoded fill ───────────────────────────────────────
  {
    id: 'DESIGN_013',
    category: 'design_svg_hardcoded_fill',
    description: 'SVG element with hardcoded fill/stroke color — use currentColor instead.',
    severity: 'MEDIUM',
    tags: ['design', 'svg', 'color', 'theming'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Hardcoded SVG fill/stroke colors prevent the icon from inheriting theme colors, breaking dark mode and theming.',
      commonViolations: [
        '<path fill="#3B82F6" d="..."/>',
      ],
      goodExample: '<path fill="currentColor" d="..."/> // follows text color, works with dark mode',
      badExample: '<path fill="#3B82F6" d="..."/> // ❌ hardcoded SVG color',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_svg_hardcoded_fill', config.severityRules);
      const findings: Finding[] = [];
      const SVG_FILL_RE = /<(?:path|circle|rect|polygon|ellipse|line|polyline)\b[^>]*(?:fill|stroke)=['"]#[0-9a-fA-F]/;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SVG_FILL_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'design_svg_hardcoded_fill', file: path, line: i + 1,
              message: 'SVG element with hardcoded fill/stroke color — use currentColor to inherit theme color.',
              suggestion: 'Replace fill="#hex" with fill="currentColor" to allow CSS color inheritance.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_014: Hardcoded animation duration ──────────────────────────────
  {
    id: 'DESIGN_014',
    category: 'design_hardcoded_animation',
    description: 'Arbitrary animation duration — use Tailwind duration utilities for consistent motion timing.',
    severity: 'LOW',
    tags: ['design', 'animation', 'motion', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Arbitrary animation durations create inconsistent motion timing across the UI.',
      commonViolations: [
        "transitionDuration: '237ms'",
        "transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'",
      ],
      goodExample: 'Tailwind duration-200, ease-in-out',
      badExample: "transitionDuration: '237ms' // ❌ arbitrary duration",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_animation', config.severityRules);
      const findings: Finding[] = [];
      const DURATION_RE = /(?:transitionDuration|transition)\s*:\s*['"][^'"]*?(\d{3,4})ms/;
      const SCALE = new Set(config.design?.animationScale ?? [75, 100, 150, 200, 300, 500, 700, 1000]);
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const m = DURATION_RE.exec(line);
          if (m) {
            const val = parseInt(m[1]!, 10);
            if (!SCALE.has(val)) {
              findings.push({
                severity: sev, category: 'design_hardcoded_animation', file: path, line: i + 1,
                message: 'Arbitrary animation duration — use a Tailwind duration utility for consistent motion timing.',
                suggestion: 'Use Tailwind duration-75, duration-100, duration-150, duration-200, duration-300, etc.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_015: Raw form element ─────────────────────────────────────────
  {
    id: 'DESIGN_015',
    category: 'design_raw_form_element',
    description: 'Raw HTML form element without styling class — use a design system component or add a className.',
    severity: 'MEDIUM',
    tags: ['design', 'forms', 'accessibility'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Unstyled raw form elements have inconsistent cross-browser appearances and miss design system accessibility patterns.',
      commonViolations: [
        '<input type="text" name="email" onChange={handleChange} />',
      ],
      goodExample: '<Input ... /> (design system component) or <input className="..." />',
      badExample: '<input type="text" name="email" onChange={handleChange} /> // ❌ raw unstyled form element',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_raw_form_element', config.severityRules);
      const findings: Finding[] = [];
      // Match <input, <select, <textarea that have NO className attribute
      const FORM_RE = /<(input|select|textarea)\b([^>]*?)\/?>(?:[^<]*<\/\1>)?/g;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Reset regex lastIndex per line
          FORM_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = FORM_RE.exec(line)) !== null) {
            const tag = m[1]!;
            const attrs = m[2]!;
            // Skip hidden inputs
            if (/type\s*=\s*['"]hidden['"]/.test(attrs)) continue;
            // Skip if has className
            if (/class(?:Name)?\s*=/.test(attrs)) continue;
            findings.push({
              severity: sev, category: 'design_raw_form_element', file: path, line: i + 1,
              message: "Raw HTML form element without styling class — use your design system's form component or add a className.",
              suggestion: `Use a design system <${tag.charAt(0).toUpperCase() + tag.slice(1)} /> component or add className="..." to style it consistently.`,
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_016: Mixed icon libraries ─────────────────────────────────────
  {
    id: 'DESIGN_016',
    category: 'design_mixed_icon_libraries',
    description: 'Multiple icon libraries imported in the same file — pick one for the whole project.',
    severity: 'HIGH',
    tags: ['design', 'icons', 'consistency'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Multiple icon libraries produce visual inconsistency (different stroke widths, fill styles, optical sizes) and bloat the bundle.',
      commonViolations: [
        "import { Search } from 'lucide-react';\nimport { UserIcon } from '@heroicons/react/solid';",
      ],
      goodExample: "Pick one icon library and use it everywhere: import { Search, User, Bell } from 'lucide-react';",
      badExample: "Importing from both lucide-react AND @heroicons/react // ❌ mixed icon libraries",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_mixed_icon_libraries', config.severityRules);
      const findings: Finding[] = [];
      const BUILT_IN_ICON_LIBS = [
        'lucide-react',
        '@heroicons/react',
        'react-icons',
        'phosphor-react',
        '@tabler/icons-react',
        '@radix-ui/react-icons',
        'feather-icons-react',
      ];
      const ICON_LIBS = config.design?.iconLibraries?.length
        ? [...new Set([...BUILT_IN_ICON_LIBS, ...config.design.iconLibraries])]
        : BUILT_IN_ICON_LIBS;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path)) continue;
        const foundLibs: string[] = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          for (const lib of ICON_LIBS) {
            if (line.includes(`'${lib}'`) || line.includes(`"${lib}"`) || line.includes(`'${lib}/`) || line.includes(`"${lib}/`)) {
              if (!foundLibs.includes(lib)) {
                foundLibs.push(lib);
                if (foundLibs.length > 1) {
                  findings.push({
                    severity: sev, category: 'design_mixed_icon_libraries', file: path, line: i + 1,
                    message: 'Multiple icon libraries imported in same file — pick one icon library for the whole project.',
                    suggestion: `This file imports from ${foundLibs.join(' and ')}. Consolidate to a single icon library.`,
                  });
                }
              }
            }
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_017: Named CSS color ───────────────────────────────────────────
  {
    id: 'DESIGN_017',
    category: 'design_color_named_css',
    description: 'Non-semantic named CSS color bypasses the design palette.',
    severity: 'MEDIUM',
    tags: ['design', 'color', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Decorative CSS named colors (tomato, hotpink, etc.) bypass the design palette and are not themeable.',
      commonViolations: [
        "color: 'tomato'",
        "backgroundColor: 'hotpink'",
      ],
      goodExample: "Use design token: color: 'var(--color-danger)' or className=\"text-red-500\"",
      badExample: "color: 'tomato' // ❌ named CSS color bypasses palette",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_color_named_css', config.severityRules);
      const findings: Finding[] = [];
      const NAMED_COLOR_RE = /(?:color|background|backgroundColor|borderColor)\s*:\s*['"]?(?:tomato|coral|mediumslateblue|cornflowerblue|hotpink|deepskyblue|limegreen|goldenrod|crimson|darkorange|orchid|steelblue|indianred|dodgerblue)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (NAMED_COLOR_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'design_color_named_css', file: path, line: i + 1,
              message: 'Named CSS color bypasses design palette — use a design token or Tailwind color class.',
              suggestion: 'Replace named colors with design token variables or Tailwind palette classes.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_018: Hardcoded opacity ────────────────────────────────────────
  {
    id: 'DESIGN_018',
    category: 'design_hardcoded_opacity',
    description: 'Off-scale opacity value — use a Tailwind opacity utility for consistent transparency.',
    severity: 'LOW',
    tags: ['design', 'opacity', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Arbitrary opacity values create inconsistency across the UI. Tailwind opacity utilities map to a defined scale.',
      commonViolations: [
        'opacity: 0.43',
        'opacity: 0.87',
      ],
      goodExample: 'opacity-50 (Tailwind), opacity: 0.5, opacity: 0.75',
      badExample: 'opacity: 0.43 // ❌ off-scale opacity',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_opacity', config.severityRules);
      const findings: Finding[] = [];
      // Match opacity values with 2+ decimal places
      const OPACITY_RE = /opacity\s*:\s*(0\.\d\d+|\d*\.\d\d+)/;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const m = OPACITY_RE.exec(line);
          if (m) {
            const val = parseFloat(m[1]!);
            const opacityScale = config.design?.opacityScale ?? [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
            const isOnScale = opacityScale.some((s) => Math.abs(val - s) < 0.001);
            if (!isOnScale) {
              findings.push({
                severity: sev, category: 'design_hardcoded_opacity', file: path, line: i + 1,
                message: 'Off-scale opacity value — use a Tailwind opacity utility for consistent transparency.',
                suggestion: 'Use Tailwind opacity-50, opacity-75 etc. or standard values like 0.5, 0.75, 0.25.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_019: Inline style on design system component ──────────────────
  {
    id: 'DESIGN_019',
    category: 'design_inline_style_on_component',
    description: 'Inline style on a design system component bypasses its variant API.',
    severity: 'MEDIUM',
    tags: ['design', 'components', 'variants'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Applying inline styles directly to design system components bypasses their variant/token system and creates inconsistent one-off overrides.',
      commonViolations: [
        "<Button style={{ backgroundColor: 'blue' }}>Submit</Button>",
      ],
      goodExample: '<Button variant="primary">Submit</Button>',
      badExample: "<Button style={{ backgroundColor: 'blue' }}>Submit</Button> // ❌ inline style bypasses variant API",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_inline_style_on_component', config.severityRules);
      const findings: Finding[] = [];
      const COMPONENT_STYLE_RE = /<[A-Z][a-zA-Z]*[^>]*style\s*=\s*\{\{/;
      for (const { path, content } of changedFiles) {
        if (!isReactFile(path) || isTestOrStory(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (COMPONENT_STYLE_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'design_inline_style_on_component', file: path, line: i + 1,
              message: "Inline style on a design system component bypasses its variant API — use the component's props instead.",
              suggestion: 'Use the component variant, size, or color props rather than inline styles.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── DESIGN_020: Hardcoded line-height ────────────────────────────────────
  {
    id: 'DESIGN_020',
    category: 'design_hardcoded_line_height',
    description: 'Pixel line-height bypasses the typography scale.',
    severity: 'LOW',
    tags: ['design', 'typography', 'tokens'],
    sinceVersion: '1.7.0',
    explain: {
      why: 'Pixel line-heights are not relative to font size and cannot scale. Unitless ratios or rem values are preferred.',
      commonViolations: [
        "lineHeight: '21px'",
        'line-height: 18px',
      ],
      goodExample: "lineHeight: 1.5, Tailwind leading-normal, or CSS variable",
      badExample: "lineHeight: '21px' // ❌ pixel line-height",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('design_hardcoded_line_height', config.severityRules);
      const findings: Finding[] = [];
      const LINE_HEIGHT_RE = /(?:lineHeight|line-height)\s*:\s*['"]?\d+(?:\.\d+)?px['"]?/;
      for (const { path, content } of changedFiles) {
        if (!isDesignFile(path) || isTestOrStory(path) || isDesignTokenFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (LINE_HEIGHT_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'design_hardcoded_line_height', file: path, line: i + 1,
              message: 'Pixel line-height bypasses the typography scale — use a unitless ratio or Tailwind leading utility.',
              suggestion: 'Use lineHeight: 1.5 (unitless) or Tailwind leading-tight, leading-normal, leading-relaxed.',
            });
          }
        }
      }
      return findings;
    },
  },
];
