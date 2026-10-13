import type { Playbook } from '../../shared/studio.js';

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: 'council-brief', name: 'Zeus · Council brief', category: 'Leadership',
    description: 'Turn the project evidence and workboard into clear priorities for the council.',
    owner: 'Zeus', reviewer: 'Themis', worker: 'ollama', cadence: 'At the start of the workday',
    steps: ['Read project evidence', 'Separate finished and pending work', 'Choose the next three priorities', 'Expose decisions and dependencies'],
    acceptance: ['Priorities have owners', 'No invented completion or commitments', 'External actions remain unapproved'],
    output: 'Council priorities and decision brief',
    instruction: 'As Zeus, prepare an internal council brief from the supplied project evidence and actual workboard. Give the three most useful next priorities, each with a named Greek god owner, desired deliverable, dependency, and acceptance check. Include decisions for Matthew and distinguish accepted work from unreviewed drafts. Do not invent revenue, dates, client communications, or completed external actions. Keep the council focused rather than asking every god to debate.',
  },
  {
    id: 'delivery-audit', name: 'Delivery readiness audit', category: 'Assurance',
    description: 'Inspect the actual project. Separate verified readiness from open launch blockers.',
    owner: 'Themis', reviewer: 'Zeus', worker: 'evidence', cadence: 'Before every handoff',
    steps: ['Capture source evidence', 'Inspect website and content', 'Identify release blockers', 'Prepare review packet'],
    acceptance: ['Every finding has a source', 'Demo and production are distinguished', 'Unknowns remain visible'],
    output: 'Evidence-backed readiness report',
    instruction: 'Produce a readiness report grounded in the supplied evidence. Do not certify a production release.',
  },
  {
    id: 'seo-plan', name: 'SEO & discoverability', category: 'Growth',
    description: 'Build a prioritized search plan from site structure, metadata, and documented observations.',
    owner: 'Hermes', reviewer: 'Themis', worker: 'ollama', cadence: 'Monthly / after a site change',
    steps: ['Review evidence', 'Prioritize technical gaps', 'Map useful content', 'Define measurement'],
    acceptance: ['No guaranteed rankings', 'Historical findings are dated', 'Recommendations have owners and evidence'],
    output: 'Search improvement plan',
    instruction: 'Create a practical SEO plan with a prioritized action table, owner, acceptance criteria, and measurement. Do not infer rankings, traffic, penalties, or live technical failures. Google does not require llms.txt or special AI schema for AI Overviews. Distinguish source facts from proposals.',
  },
  {
    id: 'content-brief', name: 'Content & campaign brief', category: 'Creative',
    description: 'Turn approved business facts into a focused brief and reviewable draft.',
    owner: 'Apollo', reviewer: 'Erato', worker: 'ollama', cadence: 'Per campaign',
    steps: ['Confirm audience and outcome', 'Select source facts', 'Draft message and content', 'Flag required approvals'],
    acceptance: ['Claims cite supplied sources', 'No fabricated testimonials', 'Client and clinical approval are explicit'],
    output: 'Creative brief and draft copy',
    instruction: 'Create a campaign brief and concise draft copy. Include audience, goal, message, channels, deliverables, and approvals. Do not invent outcomes, quotes, credentials, certifications, client budgets, or patient stories. Any healthcare claim requires qualified client review.',
  },
  {
    id: 'figma-handoff', name: 'Figma design handoff', category: 'Design',
    description: 'Prepare an actionable design specification with components, states, and accessibility checks.',
    owner: 'Hephaestus', reviewer: 'Themis', worker: 'ollama', cadence: 'Before implementation',
    steps: ['Establish design requirements', 'Inventory components', 'Specify responsive states', 'Prepare acceptance checklist'],
    acceptance: ['Empty, error, and loading states specified', 'Keyboard and contrast checks included', 'Uninspected Figma files labeled unverified'],
    output: 'Design specification and handoff checklist',
    instruction: 'Produce a Figma-ready design handoff specification grounded in the source project. Include components, spacing and typography proposals, responsive behavior, focus and error states, assets needed, and acceptance checks. This is a specification, not a created or inspected Figma file. Label visual choices as proposals.',
  },
  {
    id: 'website-handoff', name: 'Website delivery package', category: 'Delivery',
    description: 'Package implementation notes, launch checks, client responsibilities, and acceptance steps.',
    owner: 'Hephaestus', reviewer: 'Themis', worker: 'ollama', cadence: 'Per release',
    steps: ['Inspect implementation', 'Document gaps and dependencies', 'Prepare launch and rollback checks', 'Assemble client handoff'],
    acceptance: ['Forms and production domain checked', 'No invented test results', 'Publishing requires separate approval'],
    output: 'Website handoff and launch checklist',
    instruction: 'Produce a website handoff package: delivered scope versus proposed scope, release blockers, missing assets, domain/redirect checklist, form/intake test plan, rollback preparation, and client acceptance steps. Do not claim a build, accessibility test, deployment, or integration succeeded without supplied evidence. Do not deploy or edit files.',
  },
  {
    id: 'weekly-review', name: 'Weekly client review', category: 'Operations',
    description: 'Make progress, open decisions, and the next useful actions visible.',
    owner: 'Metis', reviewer: 'Zeus', worker: 'ollama', cadence: 'Weekly, on demand',
    steps: ['Read project and workboard', 'Summarize completed evidence', 'Identify pending decisions', 'Prepare next-action list'],
    acceptance: ['Completed work is supported by evidence', 'No invented deadlines or commitments', 'Unapproved delivery stays pending'],
    output: 'Client status brief and action list',
    instruction: 'Produce a concise internal weekly review. Use the supplied workboard to report actual approved versus pending work. Summarize risks, decisions, and the next three actions with owners. Never invent client communications, completed jobs, hours, revenue, or promised dates.',
  },
  {
    id: 'engagement-plan', name: 'Scope & engagement plan', category: 'Strategy',
    description: 'Define a clear engagement, dependencies, acceptance criteria, and change-control process.',
    owner: 'Athena', reviewer: 'Metis', worker: 'ollama', cadence: 'Before an engagement',
    steps: ['Define outcome and scope', 'Map milestones and responsibilities', 'Expose assumptions', 'Prepare acceptance and change control'],
    acceptance: ['Budget and deadlines are proposals unless confirmed', 'Dependencies and exclusions are explicit', 'No external commitment is made'],
    output: 'Internal engagement plan',
    instruction: 'Create an internal engagement plan based on the brief and project evidence. Include outcomes, deliverables, sequence, responsibilities, assumptions, client inputs, acceptance, and change control. Do not invent agreed pricing, signed contracts, deadlines, or approvals.',
  },
];

export function getPlaybook(id: string): Playbook {
  const result = PLAYBOOKS.find((p) => p.id === id);
  if (!result) throw new Error('Unknown playbook');
  return result;
}
