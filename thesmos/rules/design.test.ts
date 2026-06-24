import { describe, it, expect } from 'vitest';
import { DESIGN_RULES } from './design';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function rule(id: string) {
  const r = DESIGN_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── DESIGN_001 — Hardcoded hex color ─────────────────────────────────────

describe('DESIGN_001 — hardcoded hex color in style/CSS', () => {
  it('fires on inline color style with hex value in TSX', () => {
    const findings = detect('DESIGN_001', [
      {
        path: 'src/components/Button.tsx',
        content: "const el = <div style={{ color: '#3B82F6' }}>hello</div>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_hex_color');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on background hex color in CSS file', () => {
    const findings = detect('DESIGN_001', [
      {
        path: 'src/styles/card.css',
        content: ".card { background: '#FF5733'; }",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using CSS variable', () => {
    const findings = detect('DESIGN_001', [
      {
        path: 'src/components/Button.tsx',
        content: "const el = <div style={{ color: 'var(--color-primary)' }}>hello</div>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files (e.g. .ts)', () => {
    const findings = detect('DESIGN_001', [
      {
        path: 'src/utils/helpers.ts',
        content: "const color = '#3B82F6';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_002 — Tailwind arbitrary color ─────────────────────────────────

describe('DESIGN_002 — Tailwind arbitrary color', () => {
  it('fires on text-[#hex] class', () => {
    const findings = detect('DESIGN_002', [
      {
        path: 'src/components/Badge.tsx',
        content: 'return <span className="text-[#3B82F6] font-bold">badge</span>;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_tailwind_arbitrary_color');
  });

  it('fires on bg-[rgba(...)] class', () => {
    const findings = detect('DESIGN_002', [
      {
        path: 'src/components/Panel.tsx',
        content: 'return <div className="bg-[rgba(59,130,246,0.5)] p-4">content</div>;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on standard Tailwind palette color', () => {
    const findings = detect('DESIGN_002', [
      {
        path: 'src/components/Badge.tsx',
        content: 'return <span className="text-blue-500 font-bold">badge</span>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_002', [
      {
        path: 'src/styles/theme.css',
        content: '.el { @apply text-[#3B82F6]; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_003 — Inline style spacing ────────────────────────────────────

describe('DESIGN_003 — inline style arbitrary px spacing', () => {
  it('fires on inline padding with arbitrary px', () => {
    const findings = detect('DESIGN_003', [
      {
        path: 'src/components/Card.tsx',
        content: 'return <div style={{ padding: "13px" }}>card</div>;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_inline_style_spacing');
  });

  it('fires on marginTop with px value', () => {
    const findings = detect('DESIGN_003', [
      {
        path: 'src/components/Card.tsx',
        content: 'return <div style={{ marginTop: "7px" }}>card</div>;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using Tailwind classes for spacing', () => {
    const findings = detect('DESIGN_003', [
      {
        path: 'src/components/Card.tsx',
        content: 'return <div className="p-4 mt-2">card</div>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_003', [
      {
        path: 'src/styles/card.css',
        content: '.card { padding: 13px; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_004 — Hardcoded font-family ───────────────────────────────────

describe('DESIGN_004 — hardcoded font-family', () => {
  it('fires on inline fontFamily in TSX', () => {
    const findings = detect('DESIGN_004', [
      {
        path: 'src/components/Text.tsx',
        content: "return <p style={{ fontFamily: 'Arial, sans-serif' }}>text</p>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_font_family');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on font-family in CSS file', () => {
    const findings = detect('DESIGN_004', [
      {
        path: 'src/styles/typography.css',
        content: ".heading { font-family: 'Inter'; }",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using CSS variable', () => {
    const findings = detect('DESIGN_004', [
      {
        path: 'src/components/Text.tsx',
        content: "return <p style={{ fontFamily: 'var(--font-sans)' }}>text</p>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_004', [
      {
        path: 'src/utils/logger.ts',
        content: "const family = 'Arial, sans-serif';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_005 — Hardcoded font-size ─────────────────────────────────────

describe('DESIGN_005 — hardcoded pixel font size', () => {
  it('fires on fontSize with px value in TSX', () => {
    const findings = detect('DESIGN_005', [
      {
        path: 'src/components/Label.tsx',
        content: "return <span style={{ fontSize: '15px' }}>label</span>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_font_size');
  });

  it('fires on font-size in CSS', () => {
    const findings = detect('DESIGN_005', [
      {
        path: 'src/styles/type.css',
        content: '.small { font-size: 13px; }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using Tailwind text utility', () => {
    const findings = detect('DESIGN_005', [
      {
        path: 'src/components/Label.tsx',
        content: 'return <span className="text-sm">label</span>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_005', [
      {
        path: 'src/utils/config.ts',
        content: "const size = '15px';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_006 — Magic z-index ────────────────────────────────────────────

describe('DESIGN_006 — magic z-index value', () => {
  it('fires on zIndex: 47 in inline style', () => {
    const findings = detect('DESIGN_006', [
      {
        path: 'src/components/Tooltip.tsx',
        content: 'return <div style={{ zIndex: 47 }}>tooltip</div>;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_magic_z_index');
  });

  it('fires on z-index: 999 in CSS', () => {
    const findings = detect('DESIGN_006', [
      {
        path: 'src/styles/modal.css',
        content: '.modal { z-index: 999; }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on z-index: 0', () => {
    const findings = detect('DESIGN_006', [
      {
        path: 'src/components/Tooltip.tsx',
        content: 'return <div style={{ zIndex: 0 }}>tooltip</div>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when using CSS variable', () => {
    const findings = detect('DESIGN_006', [
      {
        path: 'src/components/Modal.tsx',
        content: "return <div style={{ zIndex: 'var(--z-modal)' }}>modal</div>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_007 — Hardcoded box-shadow ────────────────────────────────────

describe('DESIGN_007 — hardcoded box-shadow', () => {
  it('fires on boxShadow with raw value', () => {
    const findings = detect('DESIGN_007', [
      {
        path: 'src/components/Card.tsx',
        content: "return <div style={{ boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>card</div>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_shadow');
  });

  it('fires on another custom shadow value', () => {
    const findings = detect('DESIGN_007', [
      {
        path: 'src/components/Dropdown.tsx',
        content: "return <div style={{ boxShadow: '2px 2px 8px #00000033' }}>drop</div>;",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on boxShadow: none', () => {
    const findings = detect('DESIGN_007', [
      {
        path: 'src/components/Card.tsx',
        content: "return <div style={{ boxShadow: 'none' }}>card</div>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_007', [
      {
        path: 'src/utils/animation.ts',
        content: "const shadow = '0 4px 6px rgba(0,0,0,0.1)';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_008 — !important override ─────────────────────────────────────

describe('DESIGN_008 — !important override', () => {
  it('fires on CSS !important', () => {
    const findings = detect('DESIGN_008', [
      {
        path: 'src/styles/overrides.css',
        content: '.card { color: red !important; }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_important_override');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on Tailwind ! prefix class', () => {
    const findings = detect('DESIGN_008', [
      {
        path: 'src/components/Override.tsx',
        content: 'return <div className="!p-4 !mt-2">override</div>;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when no !important used', () => {
    const findings = detect('DESIGN_008', [
      {
        path: 'src/styles/card.css',
        content: '.card { color: red; padding: 1rem; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_008', [
      {
        path: 'src/utils/helpers.ts',
        content: 'const x = !important;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_009 — Tailwind arbitrary dimension ─────────────────────────────

describe('DESIGN_009 — Tailwind arbitrary pixel/rem dimension', () => {
  it('fires on w-[347px] class', () => {
    const findings = detect('DESIGN_009', [
      {
        path: 'src/components/Sidebar.tsx',
        content: 'return <aside className="w-[347px] h-full">sidebar</aside>;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_tailwind_arbitrary_dimension');
  });

  it('fires on h-[73px] class', () => {
    const findings = detect('DESIGN_009', [
      {
        path: 'src/components/Header.tsx',
        content: 'return <header className="h-[73px] flex items-center">header</header>;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on standard Tailwind width class', () => {
    const findings = detect('DESIGN_009', [
      {
        path: 'src/components/Sidebar.tsx',
        content: 'return <aside className="w-full max-w-xl">sidebar</aside>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_009', [
      {
        path: 'src/styles/layout.css',
        content: '.sidebar { width: 347px; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_010 — Hardcoded border-radius ─────────────────────────────────

describe('DESIGN_010 — hardcoded off-scale border-radius', () => {
  it('fires on borderRadius: 7px', () => {
    const findings = detect('DESIGN_010', [
      {
        path: 'src/components/Tag.tsx',
        content: "return <span style={{ borderRadius: '7px' }}>tag</span>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_border_radius');
  });

  it('fires on borderRadius: 13px', () => {
    const findings = detect('DESIGN_010', [
      {
        path: 'src/components/Tag.tsx',
        content: "return <span style={{ borderRadius: '13px' }}>tag</span>;",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on scale value (borderRadius: 4px)', () => {
    const findings = detect('DESIGN_010', [
      {
        path: 'src/components/Tag.tsx',
        content: "return <span style={{ borderRadius: '4px' }}>tag</span>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_010', [
      {
        path: 'src/styles/tags.css',
        content: '.tag { border-radius: 7px; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_011 — Hardcoded gradient ──────────────────────────────────────

describe('DESIGN_011 — gradient with hardcoded hex colors', () => {
  it('fires on inline backgroundImage gradient with hex', () => {
    const findings = detect('DESIGN_011', [
      {
        path: 'src/components/Hero.tsx',
        content: "return <div style={{ background: 'linear-gradient(90deg, #3B82F6, #EC4899)' }}>hero</div>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_gradient');
  });

  it('fires on CSS background gradient with hex', () => {
    const findings = detect('DESIGN_011', [
      {
        path: 'src/styles/hero.css',
        content: '.hero { background: linear-gradient(90deg, #3B82F6, #EC4899); }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on Tailwind gradient classes', () => {
    const findings = detect('DESIGN_011', [
      {
        path: 'src/components/Hero.tsx',
        content: 'return <div className="bg-gradient-to-r from-blue-500 to-pink-500">hero</div>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_011', [
      {
        path: 'src/utils/colors.ts',
        content: "const gradient = 'linear-gradient(90deg, #3B82F6, #EC4899)';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_012 — Missing focus-visible ───────────────────────────────────

describe('DESIGN_012 — outline-none without focus-visible alternative', () => {
  it('fires on outline-none with no focus-visible in nearby lines', () => {
    const findings = detect('DESIGN_012', [
      {
        path: 'src/components/Button.tsx',
        content: [
          'return (',
          '  <button',
          '    className="focus:outline-none bg-blue-500 text-white"',
          '  >',
          '    Click me',
          '  </button>',
          ');',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_missing_focus_visible');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on outline: none in CSS without focus-visible nearby', () => {
    const findings = detect('DESIGN_012', [
      {
        path: 'src/styles/button.css',
        content: '.btn { outline: none; color: blue; }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when focus-visible is present nearby', () => {
    const findings = detect('DESIGN_012', [
      {
        path: 'src/components/Button.tsx',
        content: 'return <button className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500">click</button>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_012', [
      {
        path: 'src/utils/helpers.ts',
        content: "const style = 'outline-none';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_013 — SVG hardcoded fill ──────────────────────────────────────

describe('DESIGN_013 — SVG element with hardcoded fill/stroke', () => {
  it('fires on path with hardcoded fill hex', () => {
    const findings = detect('DESIGN_013', [
      {
        path: 'src/components/icons/CheckIcon.tsx',
        content: 'return <svg><path fill="#3B82F6" d="M5 13l4 4L19 7" /></svg>;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_svg_hardcoded_fill');
  });

  it('fires on circle with hardcoded stroke hex', () => {
    const findings = detect('DESIGN_013', [
      {
        path: 'src/components/icons/CircleIcon.tsx',
        content: 'return <svg><circle stroke="#FF0000" cx="12" cy="12" r="10" /></svg>;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using currentColor', () => {
    const findings = detect('DESIGN_013', [
      {
        path: 'src/components/icons/CheckIcon.tsx',
        content: 'return <svg><path fill="currentColor" d="M5 13l4 4L19 7" /></svg>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_013', [
      {
        path: 'src/styles/icons.css',
        content: 'path { fill: #3B82F6; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_014 — Hardcoded animation duration ─────────────────────────────

describe('DESIGN_014 — arbitrary animation duration', () => {
  it('fires on transitionDuration with off-scale ms value', () => {
    const findings = detect('DESIGN_014', [
      {
        path: 'src/components/FadeIn.tsx',
        content: "return <div style={{ transitionDuration: '237ms' }}>content</div>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_animation');
  });

  it('fires on transition with off-scale ms value', () => {
    const findings = detect('DESIGN_014', [
      {
        path: 'src/styles/animate.css',
        content: ".fade { transition: 'opacity 450ms ease'; }",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on scale value (200ms)', () => {
    const findings = detect('DESIGN_014', [
      {
        path: 'src/components/FadeIn.tsx',
        content: "return <div style={{ transitionDuration: '200ms' }}>content</div>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_014', [
      {
        path: 'src/utils/animation.ts',
        content: "const dur = '237ms';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_015 — Raw form element ────────────────────────────────────────

describe('DESIGN_015 — raw HTML form element without className', () => {
  it('fires on <input> with no className', () => {
    const findings = detect('DESIGN_015', [
      {
        path: 'src/components/Form.tsx',
        content: 'return <input type="text" name="email" onChange={handleChange} />;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_raw_form_element');
  });

  it('fires on <select> with no className', () => {
    const findings = detect('DESIGN_015', [
      {
        path: 'src/components/Form.tsx',
        content: 'return <select name="country" onChange={handleChange}><option>US</option></select>;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on <input> with className', () => {
    const findings = detect('DESIGN_015', [
      {
        path: 'src/components/Form.tsx',
        content: 'return <input type="text" className="input input-bordered" name="email" />;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_015', [
      {
        path: 'src/templates/form.html',
        content: '<input type="text" name="email" />',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_016 — Mixed icon libraries ────────────────────────────────────

describe('DESIGN_016 — multiple icon libraries in same file', () => {
  it('fires when both lucide-react and @heroicons/react are imported', () => {
    const findings = detect('DESIGN_016', [
      {
        path: 'src/components/Toolbar.tsx',
        content: [
          "import { Search } from 'lucide-react';",
          "import { UserIcon } from '@heroicons/react/solid';",
          'export default function Toolbar() { return <div><Search /><UserIcon /></div>; }',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_mixed_icon_libraries');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires when lucide-react and react-icons are both imported', () => {
    const findings = detect('DESIGN_016', [
      {
        path: 'src/components/Nav.tsx',
        content: [
          "import { Home } from 'lucide-react';",
          "import { FaUser } from 'react-icons/fa';",
          'export default function Nav() { return <nav><Home /><FaUser /></nav>; }',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when only one icon library is used', () => {
    const findings = detect('DESIGN_016', [
      {
        path: 'src/components/Toolbar.tsx',
        content: [
          "import { Search, User, Bell } from 'lucide-react';",
          'export default function Toolbar() { return <div><Search /><User /><Bell /></div>; }',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_016', [
      {
        path: 'src/utils/icons.ts',
        content: [
          "import { Search } from 'lucide-react';",
          "import { UserIcon } from '@heroicons/react/solid';",
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_017 — Named CSS color ─────────────────────────────────────────

describe('DESIGN_017 — non-semantic named CSS color', () => {
  it('fires on color: tomato in inline style', () => {
    const findings = detect('DESIGN_017', [
      {
        path: 'src/components/Alert.tsx',
        content: "return <div style={{ color: 'tomato' }}>alert</div>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_color_named_css');
  });

  it('fires on backgroundColor: hotpink in CSS', () => {
    const findings = detect('DESIGN_017', [
      {
        path: 'src/styles/promo.css',
        content: '.promo { background-color: hotpink; }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on semantic color (CSS variable)', () => {
    const findings = detect('DESIGN_017', [
      {
        path: 'src/components/Alert.tsx',
        content: "return <div style={{ color: 'var(--color-danger)' }}>alert</div>;",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_017', [
      {
        path: 'src/utils/colors.ts',
        content: "const c = 'tomato';",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_018 — Hardcoded opacity ───────────────────────────────────────

describe('DESIGN_018 — off-scale opacity value', () => {
  it('fires on opacity: 0.43 in inline style', () => {
    const findings = detect('DESIGN_018', [
      {
        path: 'src/components/Overlay.tsx',
        content: 'return <div style={{ opacity: 0.43 }}>overlay</div>;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_opacity');
  });

  it('fires on opacity: 0.87 in CSS', () => {
    const findings = detect('DESIGN_018', [
      {
        path: 'src/styles/overlay.css',
        content: '.overlay { opacity: 0.87; }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on scale opacity (0.5)', () => {
    const findings = detect('DESIGN_018', [
      {
        path: 'src/components/Overlay.tsx',
        content: 'return <div style={{ opacity: 0.5 }}>overlay</div>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_018', [
      {
        path: 'src/utils/canvas.ts',
        content: 'ctx.globalAlpha = 0.43;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_019 — Inline style on design system component ─────────────────

describe('DESIGN_019 — inline style on design system component', () => {
  it('fires on <Button> with inline style', () => {
    const findings = detect('DESIGN_019', [
      {
        path: 'src/pages/Login.tsx',
        content: "return <Button style={{ backgroundColor: 'blue' }}>Submit</Button>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_inline_style_on_component');
  });

  it('fires on <Card> with inline style', () => {
    const findings = detect('DESIGN_019', [
      {
        path: 'src/pages/Dashboard.tsx',
        content: "return <Card style={{ padding: '20px' }}>content</Card>;",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on component using variant prop', () => {
    const findings = detect('DESIGN_019', [
      {
        path: 'src/pages/Login.tsx',
        content: 'return <Button variant="primary">Submit</Button>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-React files', () => {
    const findings = detect('DESIGN_019', [
      {
        path: 'src/styles/buttons.css',
        content: '.Button { background: blue; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── DESIGN_020 — Hardcoded line-height ───────────────────────────────────

describe('DESIGN_020 — pixel line-height', () => {
  it('fires on lineHeight in px in inline style', () => {
    const findings = detect('DESIGN_020', [
      {
        path: 'src/components/Text.tsx',
        content: "return <p style={{ lineHeight: '21px' }}>paragraph</p>;",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('design_hardcoded_line_height');
  });

  it('fires on line-height in px in CSS', () => {
    const findings = detect('DESIGN_020', [
      {
        path: 'src/styles/typography.css',
        content: '.body { line-height: 18px; }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on unitless line-height', () => {
    const findings = detect('DESIGN_020', [
      {
        path: 'src/components/Text.tsx',
        content: 'return <p style={{ lineHeight: 1.5 }}>paragraph</p>;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-design files', () => {
    const findings = detect('DESIGN_020', [
      {
        path: 'src/utils/pdf.ts',
        content: 'const lh = 21;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
