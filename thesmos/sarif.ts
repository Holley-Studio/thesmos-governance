/**
 * SARIF 2.1.0 serializer for Thesmos findings.
 *
 * Static Analysis Results Interchange Format (SARIF) is the universal standard
 * consumed by GitHub's Security tab, VS Code's Problems panel, and Azure DevOps.
 * This lets Thesmos findings appear natively in enterprise toolchains without
 * any extra integration work.
 *
 * Usage:
 *   import { toSarif } from './sarif.js';
 *   const sarif = toSarif(rules, findings);
 *   process.stdout.write(JSON.stringify(sarif, null, 2));
 *
 * GitHub upload:
 *   thesmos ci --format sarif --output thesmos.sarif
 *   # then in GHA: github/codeql-action/upload-sarif@v3
 */

import type { Finding, ThesmosRule } from './types.js';

// ── SARIF level mapping ───────────────────────────────────────────────────────

const SARIF_LEVEL: Record<string, 'error' | 'warning' | 'note'> = {
  BLOCKER: 'error',
  HIGH: 'error',
  MEDIUM: 'warning',
  LOW: 'note',
  TECH_DEBT: 'note',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SarifArtifactLocation {
  uri: string;
  uriBaseId?: string;
}

interface SarifRegion {
  startLine: number;
}

interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

interface SarifMessage {
  text: string;
}

interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: SarifMessage;
  locations: SarifLocation[];
}

interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  fullDescription: SarifMessage;
  defaultConfiguration: { level: 'error' | 'warning' | 'note' };
  properties: { tags: string[]; severity: string };
}

interface SarifTool {
  driver: {
    name: string;
    version: string;
    informationUri: string;
    rules: SarifReportingDescriptor[];
  };
}

interface SarifRun {
  tool: SarifTool;
  results: SarifResult[];
}

export interface SarifDocument {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

// ── Serializer ────────────────────────────────────────────────────────────────

/**
 * Converts Thesmos rules + findings to a SARIF 2.1.0 document.
 *
 * Pass the full THESMOS_RULES array so rule metadata (descriptions, tags)
 * is included even for rules that produced no findings.
 */
export function toSarif(
  rules: ThesmosRule[],
  findings: Finding[],
  version = '2.0.0',
): SarifDocument {
  const ruleDescriptors: SarifReportingDescriptor[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.category,
    shortDescription: { text: rule.description },
    fullDescription: { text: rule.explain?.why ?? rule.description },
    defaultConfiguration: { level: SARIF_LEVEL[rule.severity] ?? 'warning' },
    properties: { tags: rule.tags, severity: rule.severity },
  }));

  const results: SarifResult[] = findings.map((finding) => {
    const location: SarifLocation = {
      physicalLocation: {
        artifactLocation: {
          uri: finding.file,
          uriBaseId: '%SRCROOT%',
        },
        ...(finding.line !== undefined ? { region: { startLine: finding.line } } : {}),
      },
    };

    const text = finding.suggestion
      ? `${finding.message} — ${finding.suggestion}`
      : finding.message;

    return {
      ruleId: finding.category,
      level: SARIF_LEVEL[finding.severity] ?? 'warning',
      message: { text },
      locations: [location],
    };
  });

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'thesmos-governance',
            version,
            informationUri: 'https://github.com/Holley-Studio/thesmos-governance',
            rules: ruleDescriptors,
          },
        },
        results,
      },
    ],
  };
}
