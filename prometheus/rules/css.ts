import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, isTestPath, isCommentLine } from './helpers';

const CSS_EXT = /\.(tsx|jsx|css|scss|sass|less)$/;

export const CSS_RULES: PrometheusRule[] = [
  {
    id: 'CSS_001',
    category: 'tailwind_arbitrary_value_overuse',
    description: "Excessive Tailwind arbitrary values (w-[347px]) bypass the design system and make maintenance harder.",
    severity: 'LOW',
    tags: ['css', 'tailwind', 'design-system'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Tailwind arbitrary values like w-[347px] are escape hatches. Using them extensively means the design system values don't fit, or developers are hardcoding magic numbers instead of using spacing/sizing tokens.",
      commonViolations: ['w-[347px] h-[83px] top-[127px] left-[43px]'],
      goodExample: "w-80 h-20 mt-4 ml-2  // design system tokens\n// If custom: define in tailwind.config.js theme.extend",
      badExample: "w-[347px] h-[83px] translate-x-[127px]  // hardcoded magic numbers everywhere",
      relatedPlaybooks: ['design-system.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('tailwind_arbitrary_value_overuse', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const arbitraryValues = (line.match(/\w+\[\d+px\]/g) || []);
          if (arbitraryValues.length >= 3) {
            findings.push({ severity, category: 'tailwind_arbitrary_value_overuse', file: path, line: i + 1, message: `${arbitraryValues.length} Tailwind arbitrary pixel values on one line — bypasses the design system.`, suggestion: "Use spacing/sizing tokens from tailwind.config.js or extend the theme with custom values." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_002',
    category: 'missing_responsive_breakpoint',
    description: 'Layouts without responsive breakpoints (sm:, md:, lg:) break on mobile or large screens.',
    severity: 'MEDIUM',
    tags: ['css', 'tailwind', 'responsive', 'mobile'],
    sinceVersion: '3.0.0',
    explain: {
      why: "56% of web traffic is mobile. A grid-cols-4 without sm:grid-cols-1 is unusable on small screens. Always design mobile-first with responsive breakpoints.",
      commonViolations: ["<div className='grid grid-cols-4'>  // no mobile breakpoint"],
      goodExample: "<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'>",
      badExample: "<div className='grid grid-cols-4 gap-6'>  // 4 columns on mobile = horizontal scroll",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_responsive_breakpoint', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/grid-cols-[3-9]|grid-cols-1[0-9]/.test(line) && !/(sm|md|lg|xl):grid-cols/.test(line) && !/(sm|md):grid/.test(content)) {
            findings.push({ severity, category: 'missing_responsive_breakpoint', file: path, line: i + 1, message: 'Multi-column grid without responsive breakpoints — unusable on mobile.', suggestion: "Add responsive variants: grid-cols-1 sm:grid-cols-2 lg:grid-cols-4." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_003',
    category: 'hardcoded_color_value',
    description: "Hardcoded hex colors in Tailwind JSX bypass the design system's color tokens and break dark mode.",
    severity: 'MEDIUM',
    tags: ['css', 'tailwind', 'design-system', 'dark-mode'],
    sinceVersion: '3.0.0',
    explain: {
      why: "style={{ color: '#1a56db' }} and className='text-[#1a56db]' bypass the design system and break dark mode. Use semantic color tokens like text-primary or colors defined in tailwind.config.js.",
      commonViolations: ["style={{ color: '#1a56db' }}", "className='text-[#3f3f46]'"],
      goodExample: "className='text-primary'  // mapped to CSS variable\n// Or in tailwind.config: colors: { primary: 'var(--color-primary)' }",
      badExample: "style={{ backgroundColor: '#1a56db' }}  // bypasses dark mode, theming, design tokens",
      relatedPlaybooks: ['design-system.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('hardcoded_color_value', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:color|background|border).*#[0-9a-fA-F]{3,8}/.test(line) && !line.includes('// design')) {
            findings.push({ severity, category: 'hardcoded_color_value', file: path, line: i + 1, message: 'Hardcoded hex color bypasses design system tokens and dark mode.', suggestion: "Use design tokens from tailwind.config.js or CSS variables: var(--color-primary)." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_004',
    category: 'inline_style_overuse',
    description: "Excessive inline styles (style={{}}) in React components prevent Tailwind's purge/JIT and make UI inconsistent.",
    severity: 'LOW',
    tags: ['css', 'react', 'tailwind', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Inline styles bypass Tailwind utility classes, making it impossible to override with responsive variants or dark mode. They're also not tree-shaken or cached by the browser's CSS engine.",
      commonViolations: ["style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}"],
      goodExample: "className='flex flex-col gap-4'  // Tailwind utility equivalent",
      badExample: "style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderRadius: '8px' }}",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('inline_style_overuse', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const properties = (line.match(/(?:display|flex|padding|margin|font|border|background|color|width|height)\s*:/g) || []);
          if (properties.length >= 3 && line.includes('style=')) {
            findings.push({ severity, category: 'inline_style_overuse', file: path, line: i + 1, message: `${properties.length} CSS properties as inline styles — use Tailwind utility classes instead.`, suggestion: "Replace with Tailwind: style={{ display: 'flex', gap: '16px' }} → className='flex gap-4'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_005',
    category: 'missing_dark_mode',
    description: "Components with hardcoded light-theme colors without dark: variants fail in dark mode.",
    severity: 'MEDIUM',
    tags: ['css', 'tailwind', 'dark-mode', 'ux'],
    sinceVersion: '3.0.0',
    explain: {
      why: "42% of users prefer dark mode (OS-level). bg-white text-black without dark:bg-gray-900 dark:text-white causes eye-strain and renders unusable in system dark mode.",
      commonViolations: ["className='bg-white text-gray-900'  // no dark mode variants"],
      goodExample: "className='bg-white dark:bg-gray-900 text-gray-900 dark:text-white'",
      badExample: "className='bg-white text-black border-gray-200'  // burns eyes in dark mode",
      relatedPlaybooks: ['design-system.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_dark_mode', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (content.includes('dark:')) return findings;
        const BG_COLORS = /className=['"][^'"]*bg-(?:white|gray-(?:50|100)|slate-(?:50|100))[^'"]*['"]/;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (BG_COLORS.test(line)) {
            findings.push({ severity, category: 'missing_dark_mode', file: path, line: i + 1, message: 'Light background color without dark: variant — unusable in dark mode.', suggestion: "Add dark mode variants: bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100." });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_006',
    category: 'css_variable_not_used',
    description: "Defining CSS custom properties (--color-primary) but using hardcoded values instead defeats the theming system.",
    severity: 'LOW',
    tags: ['css', 'design-system', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If you define :root { --color-primary: #1a56db } but use #1a56db directly elsewhere, changing the primary color requires a find-and-replace instead of updating one variable.",
      commonViolations: ['color: #1a56db  /* same as --color-primary but hardcoded */'],
      goodExample: 'color: var(--color-primary)',
      badExample: '.button { background: #1a56db }  /* matches --color-primary but hardcoded */',
      relatedPlaybooks: ['design-system.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('css_variable_not_used', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.css$|\.scss$/.test(path)) continue;
        const varValues = [...content.matchAll(/--[\w-]+\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map(m => m[1]!.toLowerCase());
        if (varValues.length === 0) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line) || line.includes('--')) continue;
          const hexMatch = line.match(/#([0-9a-fA-F]{3,8})\b/);
          if (hexMatch && varValues.includes(hexMatch[0]!.toLowerCase())) {
            findings.push({ severity, category: 'css_variable_not_used', file: path, line: i + 1, message: `Hardcoded color ${hexMatch[0]} matches a CSS variable — use var(--...) instead.`, suggestion: 'Replace hardcoded color with the corresponding CSS custom property: var(--color-name).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_007',
    category: 'tailwind_class_explosion',
    description: "Elements with 15+ Tailwind classes become impossible to review and should be extracted to a component.",
    severity: 'LOW',
    tags: ['css', 'tailwind', 'maintainability', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "className='flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow duration-200 cursor-pointer select-none' is unreadable. Extract to a component or use cva/clsx.",
      commonViolations: ['// 20+ class string on one line'],
      goodExample: "// Use cva for variant-based components:\nconst cardStyles = cva('flex rounded-lg shadow', { variants: { size: { sm: 'p-2', md: 'p-4' } } })",
      badExample: "className='flex items-center justify-between px-4 py-3 bg-white rounded-lg shadow-md border hover:shadow-lg transition duration-200 cursor-pointer'  // extract to component",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('tailwind_class_explosion', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const classMatch = line.match(/className=['"]([^'"]+)['"]/);
          if (classMatch) {
            const classCount = classMatch[1]!.split(/\s+/).length;
            if (classCount >= 15) {
              findings.push({ severity, category: 'tailwind_class_explosion', file: path, line: i + 1, message: `${classCount} Tailwind classes on one element — extract to a component or use cva().`, suggestion: "Extract to a named component or use cva/clsx for variant-based class composition." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_008',
    category: 'z_index_magic_number',
    description: "Hardcoded z-index values (z-9999) without a defined stacking context cause unpredictable layering.",
    severity: 'MEDIUM',
    tags: ['css', 'tailwind', 'design-system', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "z-index: 9999 is an arms race. Without a documented stacking order, one developer adds 9999, another adds 99999, and soon nothing makes sense. Define a z-index scale in tailwind.config or a zIndex constant.",
      commonViolations: ['z-[9999]', 'z-[99999]', "style={{ zIndex: 9999 }}"],
      goodExample: "// tailwind.config.js: theme.extend.zIndex: { modal: '100', overlay: '200' }\nclassName='z-modal'",
      badExample: "className='z-[9999]'  // z-index without a stacking context definition",
      relatedPlaybooks: ['design-system.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('z_index_magic_number', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/z-\[\d{3,}\]|z-index\s*:\s*\d{3,}|zIndex\s*:\s*\d{3,}/.test(line)) {
            findings.push({ severity, category: 'z_index_magic_number', file: path, line: i + 1, message: 'Large arbitrary z-index value — define a named stacking scale in tailwind.config.js instead.', suggestion: "Define: theme.extend.zIndex: { modal: '100', tooltip: '200' } and use className='z-modal'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_009',
    category: 'missing_focus_visible',
    description: "Removing or overriding focus styles (outline-none without focus-visible:) breaks keyboard navigation — WCAG 2.4.7.",
    severity: 'HIGH',
    tags: ['css', 'accessibility', 'a11y', 'keyboard'],
    sinceVersion: '3.0.0',
    explain: {
      why: "outline-none (often added to 'fix ugly focus rings') hides the focus indicator for keyboard users, making it impossible to see which element is focused. Use focus-visible: to show focus only for keyboard navigation, not mouse.",
      commonViolations: ["className='outline-none'", "focus:outline-none  // without focus-visible replacement"],
      goodExample: "className='outline-none focus-visible:ring-2 focus-visible:ring-blue-500'",
      badExample: "className='outline-none'  // keyboard users can't see focus — WCAG 2.4.7 violation",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_focus_visible', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/(?:outline-none|outline: none|outline:none)/.test(line) && !line.includes('focus-visible')) {
            const surrounding = lines.slice(i, i + 3).join('\n');
            if (!surrounding.includes('focus-visible')) {
              findings.push({ severity, category: 'missing_focus_visible', file: path, line: i + 1, message: 'outline-none without focus-visible replacement — removes keyboard focus indicator (WCAG 2.4.7).', suggestion: "Replace with: focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_010',
    category: 'animation_no_reduce_motion',
    description: "CSS animations without prefers-reduced-motion guards cause nausea in users with vestibular disorders — WCAG 2.3.3.",
    severity: 'HIGH',
    tags: ['css', 'accessibility', 'a11y', 'animation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Users with vestibular disorders experience nausea and dizziness from motion. WCAG 2.3.3 (AAA) and many legal requirements mandate respecting prefers-reduced-motion. Tailwind's motion-reduce: prefix handles this elegantly.",
      commonViolations: ["animate-spin, animate-bounce, animate-pulse without motion-reduce:"],
      goodExample: "className='animate-spin motion-reduce:animate-none'",
      badExample: "className='animate-bounce'  // always bounces, including for users with motion sensitivity",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('animation_no_reduce_motion', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/animate-(?:spin|bounce|pulse|ping|wiggle|fade|slide)/.test(line) && !line.includes('motion-reduce') && !content.includes('prefers-reduced-motion')) {
            findings.push({ severity, category: 'animation_no_reduce_motion', file: path, line: i + 1, message: 'CSS animation without prefers-reduced-motion guard — causes discomfort for users with vestibular disorders.', suggestion: "Add motion-reduce: variant: className='animate-spin motion-reduce:animate-none'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_011',
    category: 'font_size_too_small',
    description: "Text smaller than 12px is unreadable on most screens and fails WCAG 1.4.4 (Resize Text).",
    severity: 'MEDIUM',
    tags: ['css', 'accessibility', 'a11y', 'typography'],
    sinceVersion: '3.0.0',
    explain: {
      why: "WCAG 1.4.4 requires text to be resizable to 200% without loss of content. Text below 12px is already near the threshold of legibility at 100%. Tailwind text-xs is 12px (acceptable), text below that is not.",
      commonViolations: ["className='text-[10px]'", "style={{ fontSize: '10px' }}"],
      goodExample: "className='text-xs'  // 12px — minimum readable size\nclassName='text-sm'  // 14px — better for body text",
      badExample: "className='text-[9px]'  // unreadable on most screens, fails WCAG 1.4.4",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('font_size_too_small', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const match = line.match(/text-\[(\d+)px\]|font-size\s*:\s*(\d+)px|fontSize\s*:\s*['"]?(\d+)(?:px)?['"]?/);
          if (match) {
            const size = parseInt(match[1] || match[2] || match[3] || '0', 10);
            if (size > 0 && size < 12) {
              findings.push({ severity, category: 'font_size_too_small', file: path, line: i + 1, message: `Font size ${size}px is below the 12px minimum — fails WCAG 1.4.4 legibility requirements.`, suggestion: "Use at least text-xs (12px) for body text. Consider text-sm (14px) for better readability." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_012',
    category: 'color_contrast_low',
    description: "Light gray text on white backgrounds fails WCAG 1.4.3 contrast ratio requirements (4.5:1 for normal text).",
    severity: 'HIGH',
    tags: ['css', 'accessibility', 'a11y', 'color-contrast'],
    sinceVersion: '3.0.0',
    explain: {
      why: "text-gray-300 on bg-white is approximately 1.6:1 contrast — far below WCAG 1.4.3's 4.5:1 minimum for normal text. text-gray-600 on white is ~5.74:1 (passes AA). Use a contrast checker to verify.",
      commonViolations: ["text-gray-300 on white background", "text-gray-400 on bg-white"],
      goodExample: "text-gray-700  // ~6.7:1 on white — passes WCAG AA\ntext-gray-600  // ~5.7:1 on white — passes WCAG AA",
      badExample: "text-gray-300  // ~1.6:1 — fails WCAG AA for all text sizes",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('color_contrast_low', config.severityRules);
      const findings: Finding[] = [];
      const LOW_CONTRAST = /text-(?:gray|slate|zinc|neutral)-(?:100|200|300|400)/;
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (LOW_CONTRAST.test(line) && /(?:text-\w+-(?:100|200|300|400))/.test(line)) {
            findings.push({ severity, category: 'color_contrast_low', file: path, line: i + 1, message: 'Very light text color — likely fails WCAG 1.4.3 contrast ratio of 4.5:1.', suggestion: "Use text-gray-600 or darker for body text. Verify contrast at webaim.org/resources/contrastchecker/." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_013',
    category: 'tailwind_content_missing',
    description: "Files not covered by tailwind.config.js 'content' glob will have their classes purged in production builds.",
    severity: 'HIGH',
    tags: ['css', 'tailwind', 'build', 'configuration'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Tailwind's JIT mode purges all classes not found in the content glob. If you add a new directory (e.g., packages/ui/**) without updating the content array, all Tailwind classes in those files are stripped in production.",
      commonViolations: ['// New packages/ui directory not added to tailwind.config.js content'],
      goodExample: "content: ['./src/**/*.{js,ts,jsx,tsx}', './packages/ui/**/*.{tsx,jsx}']",
      badExample: "content: ['./src/**/*.{js,ts,jsx,tsx}']  // packages/ui classes will be purged",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('tailwind_content_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('tailwind.config')) continue;
        if (!content.includes('content:') && !content.includes('content =')) {
          findings.push({ severity, category: 'tailwind_content_missing', file: path, message: 'tailwind.config.js missing content array — Tailwind cannot purge unused classes or know which files to scan.', suggestion: "Add: content: ['./src/**/*.{js,ts,jsx,tsx}'] to tailwind.config.js." });
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_014',
    category: 'css_specificity_war',
    description: "Using !important in CSS (or Tailwind's ! prefix) signals a specificity conflict that should be fixed at the source.",
    severity: 'LOW',
    tags: ['css', 'maintainability', 'tailwind'],
    sinceVersion: '3.0.0',
    explain: {
      why: "!important is a code smell. One !important cascades into needing more !important to override it. Fix the underlying specificity issue by restructuring the cascade, not by adding !important.",
      commonViolations: ["className='!text-red-500'  // Tailwind ! modifier", "color: red !important"],
      goodExample: '// Fix the specificity issue at the source:\n// Move the rule to a more specific selector\n// Or restructure the component to avoid the conflict',
      badExample: "className='!mt-0'  // fighting a specificity war — fix the source instead",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('css_specificity_war', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!CSS_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/!\important|!important|className=['"][^'"]*!\w+/.test(line)) {
            findings.push({ severity, category: 'css_specificity_war', file: path, line: i + 1, message: '!important / Tailwind ! modifier signals a CSS specificity conflict — fix the source.', suggestion: 'Restructure CSS selectors or component hierarchy to resolve specificity without !important.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_015',
    category: 'image_no_aspect_ratio',
    description: "Images without explicit width/height or aspect-ratio cause cumulative layout shift (CLS) — a Core Web Vital.",
    severity: 'MEDIUM',
    tags: ['css', 'performance', 'core-web-vitals', 'cls'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When a browser loads an image without knowing its dimensions, it reserves 0 height then reflows when the image loads — causing layout shift (CLS). Set width and height attributes or use aspect-ratio-box CSS.",
      commonViolations: ["<img src='/hero.jpg' className='w-full' />  // no height — causes CLS"],
      goodExample: "<img src='/hero.jpg' width={1200} height={630} className='w-full' alt='Hero' />\n// or: className='aspect-video w-full'",
      badExample: "<img src={imgUrl} className='w-full' />  // no height — page jumps when image loads",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('image_no_aspect_ratio', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/<img\s/.test(line) && !line.includes('width=') && !line.includes('height=') && !line.includes('aspect-')) {
            findings.push({ severity, category: 'image_no_aspect_ratio', file: path, line: i + 1, message: '<img> without width/height attributes causes cumulative layout shift (CLS) — a Core Web Vital.', suggestion: "Add width and height attributes, or use Next.js <Image> component which handles this automatically." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_016',
    category: 'tailwind_dynamic_class',
    description: "Dynamically constructed Tailwind class names (e.g., `bg-${color}-500`) are purged in production builds.",
    severity: 'HIGH',
    tags: ['css', 'tailwind', 'build', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Tailwind JIT scans for complete class name strings at build time. bg-${color}-500 is never seen as bg-red-500 in static analysis — it's purged. Use a lookup object with complete class names instead.",
      commonViolations: ["`bg-${color}-500`", "`text-${size}`"],
      goodExample: "const colorMap = { red: 'bg-red-500', blue: 'bg-blue-500' }\nclassName={colorMap[color]}",
      badExample: "className={`bg-${themeColor}-500`}  // 'bg-red-500' never seen by Tailwind JIT — purged",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('tailwind_dynamic_class', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/`[^`]*(?:bg|text|border|ring|from|to|via)-\$\{[^}]+\}-\d{3}/.test(line) || /`[^`]*\$\{[^}]+\}-\d{3}[^`]*`/.test(line)) {
            findings.push({ severity, category: 'tailwind_dynamic_class', file: path, line: i + 1, message: 'Dynamic Tailwind class name — JIT cannot detect it at build time, class will be purged.', suggestion: "Use a complete class name lookup object: const cls = { red: 'bg-red-500', blue: 'bg-blue-500' }." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_017',
    category: 'global_css_overrides',
    description: 'Global CSS that overrides framework/component styles (* { margin: 0 } style) causes unexpected style leaks.',
    severity: 'MEDIUM',
    tags: ['css', 'maintainability', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Global CSS rules like * { box-sizing: border-box } are fine. But * { color: inherit } or h1 { font-size: 32px } in globals.css overrides component-level styles and library defaults unexpectedly.",
      commonViolations: ['a { text-decoration: none }  // in globals.css — overrides all links globally'],
      goodExample: '/* Only set CSS resets and custom properties in globals.css */\n/* Component-specific styles should live in the component */\n:root { --color-primary: #1a56db }',
      badExample: '/* globals.css */\na { color: blue; text-decoration: none }  /* overrides all link components globally */',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('global_css_overrides', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('global') || !/\.css$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/^(?:a|h[1-6]|p|button|input|ul|li)\s*\{/.test(line)) {
            findings.push({ severity, category: 'global_css_overrides', file: path, line: i + 1, message: 'Global element style override — may conflict with component and library styles unexpectedly.', suggestion: 'Scope styles to components. Only use globals.css for CSS custom properties, resets, and @font-face.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_018',
    category: 'print_styles_missing',
    description: "Pages without @media print styles print with dark backgrounds, cut-off content, and navigation visible.",
    severity: 'LOW',
    tags: ['css', 'print', 'ux'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Reports, invoices, and documents are often printed. Without print styles, the page prints with navigation, sidebars, dark backgrounds, and improper page breaks. Add @media print or Tailwind print: variants.",
      commonViolations: ['// Report page with no print media query or print: Tailwind classes'],
      goodExample: "@media print {\n  nav, .sidebar { display: none }\n  body { color: black; background: white }\n}\n// Or Tailwind: className='print:hidden' on nav",
      badExample: "// Invoice page with no print styles — prints with dark background and navigation",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('print_styles_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!path.includes('invoice') && !path.includes('report') && !path.includes('receipt') && !path.includes('print')) return findings;
        if (!content.includes('@media print') && !content.includes('print:')) {
          findings.push({ severity, category: 'print_styles_missing', file: path, message: 'Invoice/report page without print styles — will print with navigation, dark backgrounds, and cut-off content.', suggestion: "Add @media print { nav { display: none } } in CSS or use Tailwind's print: variant: className='print:hidden'." });
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_019',
    category: 'scroll_restoration_missing',
    description: "Single-page navigation without scroll restoration leaves users at random scroll positions on back navigation.",
    severity: 'LOW',
    tags: ['css', 'ux', 'navigation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When a user navigates to a detail page and presses Back, they expect to return to their scroll position on the list page. Next.js 13+ App Router restores scroll by default, but custom routers or programmatic navigation may not.",
      commonViolations: ['router.push(url)  // without scroll restoration'],
      goodExample: "// Next.js: <Link scroll={true}> (default)\n// For custom routing: window.history.scrollRestoration = 'auto'",
      badExample: "router.push(url, { scroll: false })  // user lands at top after back navigation",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('scroll_restoration_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/scroll\s*:\s*false/.test(line) || /scrollRestoration\s*=\s*['"]manual['"]/.test(line)) {
            findings.push({ severity, category: 'scroll_restoration_missing', file: path, line: i + 1, message: "Scroll restoration disabled — users will lose their scroll position on back navigation.", suggestion: "Remove scroll: false unless intentional. Let Next.js handle scroll restoration automatically." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'CSS_020',
    category: 'touch_target_too_small',
    description: "Interactive elements smaller than 44×44px fail WCAG 2.5.5 and are unreliable for touch users.",
    severity: 'MEDIUM',
    tags: ['css', 'accessibility', 'mobile', 'touch'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Apple's HIG and WCAG 2.5.5 (Target Size) recommend at least 44×44px for touchable elements. Small icon buttons (16×16) cause mis-taps on mobile. Use min-w and min-h to ensure adequate tap targets.",
      commonViolations: ["className='w-4 h-4'  // on a button — 16×16px, too small for touch"],
      goodExample: "className='w-11 h-11 flex items-center justify-center'  // 44×44px minimum touch target",
      badExample: "<button className='w-4 h-4'><Icon /></button>  // 16px button fails on touch screens",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('touch_target_too_small', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/<button/.test(line)) {
            const classMatch = line.match(/className=['"]([^'"]+)['"]/);
            if (classMatch) {
              const classes = classMatch[1]!;
              const wMatch = classes.match(/\bw-(\d+)\b/);
              const hMatch = classes.match(/\bh-(\d+)\b/);
              if (wMatch && hMatch) {
                const w = parseInt(wMatch[1]!, 10) * 4;
                const h = parseInt(hMatch[1]!, 10) * 4;
                if (w < 44 || h < 44) {
                  findings.push({ severity, category: 'touch_target_too_small', file: path, line: i + 1, message: `Button is approximately ${w}×${h}px — below the 44×44px minimum touch target (WCAG 2.5.5).`, suggestion: "Use min-w-[44px] min-h-[44px] or w-11 h-11 for adequate touch targets." });
                }
              }
            }
          }
        }
      }
      return findings;
    },
  },
];
