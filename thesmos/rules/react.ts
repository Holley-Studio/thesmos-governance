// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, JSX_EXT, isTestPath, isCommentLine } from './helpers';

export const REACT_RULES: ThesmosRule[] = [
  {
    id: 'REACT_001',
    category: 'useeffect_async_callback',
    description: 'useEffect does not support async callbacks directly. The cleanup function must be synchronous.',
    severity: 'HIGH',
    tags: ['react', 'async', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'useEffect(() => async () => ...) is not the same as useEffect(async () => ...). The latter makes the callback return a Promise instead of a cleanup function, so React ignores the cleanup. Errors in the async function become unhandled rejections.',
      commonViolations: ['useEffect(async () => { await fetchData(); }, [])', 'useEffect(async () => { const data = await api.get(); setData(data); })'],
      goodExample: "useEffect(() => {\n  let cancelled = false;\n  (async () => {\n    const data = await fetchData();\n    if (!cancelled) setData(data);\n  })();\n  return () => { cancelled = true; };\n}, [id]);",
      badExample: "useEffect(async () => {\n  const data = await fetchUser(id);  // cleanup never runs\n  setUser(data);\n}, [id]);",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('useeffect_async_callback', config.severityRules);
      const RE = /\buseEffect\s*\(\s*async\s*(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'useeffect_async_callback', file: path, line: i + 1, message: 'useEffect with async callback — cleanup function is never returned.', suggestion: 'Define an inner async IIFE inside the effect, and return a cleanup function explicitly.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_002',
    category: 'key_prop_index',
    description: 'Using array index as React key causes incorrect reconciliation when the list order changes.',
    severity: 'MEDIUM',
    tags: ['react', 'performance', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'When items are reordered or removed, index-based keys cause React to reuse the wrong DOM nodes — preserving stale state, skipping animations, and breaking controlled inputs like forms.',
      commonViolations: ['{items.map((item, index) => <Card key={index} />)}', '{list.map((_, i) => <Row key={i} />)}'],
      goodExample: '{items.map(item => <Card key={item.id} />)}',
      badExample: '{users.map((user, index) => <UserRow key={index} user={user} />)}  // wrong on delete/reorder',
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('key_prop_index', config.severityRules);
      const RE = /\bkey\s*=\s*\{[^}]*\bindex\b[^}]*\}/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'key_prop_index', file: path, line: i + 1, message: 'key={index} used in list — incorrect for reorderable lists.', suggestion: 'Use a stable, unique identifier from the data as the key (e.g., key={item.id}).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_003',
    category: 'direct_dom_manipulation',
    description: 'document.getElementById and querySelector in React components bypass the virtual DOM.',
    severity: 'MEDIUM',
    tags: ['react', 'quality', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Direct DOM queries are fragile (the element may not exist during SSR or before mount), bypass React\'s reconciliation, and can cause state inconsistencies. Use refs instead.',
      commonViolations: ['document.getElementById("modal").show()', 'document.querySelector(".input").focus()'],
      goodExample: "const ref = useRef<HTMLDivElement>(null);\nuseEffect(() => { ref.current?.focus(); }, []);",
      badExample: "function Modal() {\n  const show = () => document.getElementById('modal-inner').classList.add('visible');\n}",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('direct_dom_manipulation', config.severityRules);
      const RE = /\bdocument\.(?:getElementById|querySelector|getElementsBy\w+)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'direct_dom_manipulation', file: path, line: i + 1, message: 'Direct DOM query in a React component — use useRef() instead.', suggestion: 'Replace with useRef and ref.current to access the element safely after mount.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_004',
    category: 'window_ssr_unsafe',
    description: 'Accessing `window` at the module or component level breaks server-side rendering.',
    severity: 'HIGH',
    tags: ['react', 'nextjs', 'ssr', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: '`window` does not exist in Node.js (SSR environment). Accessing it outside of useEffect or a typeof window check causes ReferenceError during server rendering, breaking the entire page.',
      commonViolations: ['const width = window.innerWidth', 'window.analytics.track("event")'],
      goodExample: "useEffect(() => {\n  const width = window.innerWidth;\n  setWidth(width);\n}, []);\n// Or: if (typeof window !== 'undefined') { ... }",
      badExample: "// At module level:\nconst isMobile = window.innerWidth < 768;  // ReferenceError during SSR",
      relatedPlaybooks: ['ssr-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('window_ssr_unsafe', config.severityRules);
      const WINDOW_RE = /\bwindow\.\w+/;
      const SAFE_RE = /typeof\s+window|useEffect|componentDidMount/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (WINDOW_RE.test(line) && !SAFE_RE.test(line)) {
            findings.push({ severity, category: 'window_ssr_unsafe', file: path, line: i + 1, message: '`window` accessed outside a browser-only guard — SSR will crash.', suggestion: "Wrap in useEffect or check `typeof window !== 'undefined'` before accessing." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_005',
    category: 'state_mutation',
    description: 'Mutating state arrays or objects directly (push, splice, sort) bypasses React\'s change detection.',
    severity: 'HIGH',
    tags: ['react', 'correctness', 'state'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'React uses reference equality to detect state changes. Mutating an existing array or object preserves the same reference, so React does not re-render. Use immutable update patterns instead.',
      commonViolations: ['state.items.push(newItem); setState(state)', 'items.splice(i, 1); setItems(items)'],
      goodExample: "setItems(prev => [...prev, newItem]);\nsetItems(prev => prev.filter(item => item.id !== id));",
      badExample: "function addItem(item) {\n  items.push(item);  // reference unchanged — no re-render\n  setItems(items);\n}",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('state_mutation', config.severityRules);
      const STATE_ARRAY_RE = /\b(?:state\.|this\.state\.|\bstate\b.*\.)(?:push|pop|shift|unshift|splice|sort|reverse)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (STATE_ARRAY_RE.test(line)) {
            findings.push({ severity, category: 'state_mutation', file: path, line: i + 1, message: 'State array mutated directly — React will not re-render.', suggestion: 'Use immutable patterns: setState(prev => [...prev, item]) or setState(prev => prev.filter(...)).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_006',
    category: 'react_fc_type',
    description: '`React.FC` is discouraged — it implicitly adds children and hides component return type issues.',
    severity: 'LOW',
    tags: ['react', 'typescript', 'quality'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'React.FC automatically includes children in props (even when unintended), wraps the return type in ReactElement, and can mask issues where a component returns undefined. Explicit prop types and plain function types are clearer.',
      commonViolations: ['const MyComp: React.FC = () => <div />', 'const Button: FC<Props> = (props) => ...'],
      goodExample: "function MyComp(props: MyProps): JSX.Element {\n  return <div>{props.label}</div>;\n}",
      badExample: "const MyComp: React.FC<Props> = ({ label }) => <div>{label}</div>;",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('react_fc_type', config.severityRules);
      const RE = /:\s*(?:React\.FC|FC)\s*(?:<|=|\()/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'react_fc_type', file: path, line: i + 1, message: 'React.FC type annotation — use an explicit function signature instead.', suggestion: 'function MyComp(props: MyProps): JSX.Element { ... }' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_007',
    category: 'inline_object_prop',
    description: 'Object or array literals in JSX props create a new reference on every render, causing unnecessary re-renders of children.',
    severity: 'LOW',
    tags: ['react', 'performance'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'JSX is re-evaluated on every render. An inline object like style={{ margin: 0 }} creates a new object reference each time, causing any child wrapped in React.memo or shouldComponentUpdate to always re-render.',
      commonViolations: ['<Chart data={[1, 2, 3]} />', "<Box style={{ margin: 0, padding: 8 }} />"],
      goodExample: "const CHART_DATA = [1, 2, 3];\n<Chart data={CHART_DATA} />\n// Or: const data = useMemo(() => computeData(input), [input]);",
      badExample: '<Component config={{ threshold: 10, timeout: 5000 }} />  // new object every render',
      relatedPlaybooks: ['react-performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('inline_object_prop', config.severityRules);
      const RE = /\b(?:style|config|options|settings|defaultValues)\s*=\s*\{\s*\{/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'inline_object_prop', file: path, line: i + 1, message: 'Inline object literal in JSX prop — new reference every render.', suggestion: 'Extract to a module-level const or wrap in useMemo if it depends on props.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_008',
    category: 'missing_error_boundary',
    description: 'Components that fetch data or render user content should be wrapped in an error boundary.',
    severity: 'MEDIUM',
    tags: ['react', 'reliability', 'ux'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without an error boundary, a single render exception unmounts the entire React tree, showing a blank page to the user. Error boundaries catch render errors and display a fallback UI.',
      commonViolations: ['Async data-fetching component with no error boundary parent', 'User-generated content rendered without fallback'],
      goodExample: "<ErrorBoundary fallback={<ErrorPage />}>\n  <UserDashboard userId={id} />\n</ErrorBoundary>",
      badExample: "// App root:\n<Dashboard />  // one render error wipes the entire page",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, scan }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_error_boundary', config.severityRules);
      const hasErrorBoundary = scan.sharedUiFiles.some(f =>
        /error.?boundary|ErrorBoundary/i.test(f)
      );
      if (hasErrorBoundary || scan.componentCount === 0) return [];
      if (scan.componentCount > 10 && !hasErrorBoundary) {
        return [{
          severity,
          category: 'missing_error_boundary',
          file: 'src/app',
          message: `${scan.componentCount} components found but no ErrorBoundary component detected.`,
          suggestion: 'Create an ErrorBoundary component and wrap your app root and major feature areas.',
        }];
      }
      return [];
    },
  },

  {
    id: 'REACT_009',
    category: 'uselayouteffect_misuse',
    description: 'useLayoutEffect runs synchronously after DOM mutations, blocking paint. Use useEffect unless you need DOM measurements.',
    severity: 'LOW',
    tags: ['react', 'performance'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'useLayoutEffect blocks the browser from painting until it completes — this is intentional for DOM measurement but causes jank when used unnecessarily. It also causes SSR warnings since it runs in the browser only.',
      commonViolations: ['useLayoutEffect(() => { fetchData(); }, [])', 'useLayoutEffect(() => { setVisible(true); }, [])'],
      goodExample: "// useLayoutEffect: only for DOM measurements\nuseLayoutEffect(() => { setHeight(ref.current.clientHeight); }, []);\n// Everything else: useEffect",
      badExample: "useLayoutEffect(() => {\n  dispatch({ type: 'LOAD' });  // blocks paint for no reason\n}, []);",
      relatedPlaybooks: ['react-performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('uselayouteffect_misuse', config.severityRules);
      const RE = /\buseLayoutEffect\s*\(/;
      const MEAS_RE = /(?:clientHeight|clientWidth|offsetHeight|offsetWidth|getBoundingClientRect|scrollHeight)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            const body = lines.slice(i, Math.min(i + 8, lines.length)).join('\n');
            if (!MEAS_RE.test(body)) {
              findings.push({ severity, category: 'uselayouteffect_misuse', file: path, line: i + 1, message: 'useLayoutEffect without DOM measurements — useEffect is likely sufficient.', suggestion: 'Switch to useEffect unless you need to read DOM dimensions synchronously after render.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_010',
    category: 'prop_spreading_dom',
    description: 'Spreading unknown props onto DOM elements passes invalid HTML attributes, causing React warnings and potential XSS.',
    severity: 'MEDIUM',
    tags: ['react', 'quality', 'security'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'When {...props} is spread onto a native DOM element like <div>, any prop that is not a valid HTML attribute generates React warnings. Props like onClick could also carry event handlers from untrusted sources.',
      commonViolations: ['<div {...props} />', '<input {...rest} />'],
      goodExample: "const { children, className, onClick, ...rest } = props;\n// Only spread what you expect:\n<div className={className} onClick={onClick}>{children}</div>",
      badExample: "function Card({ ...props }) {\n  return <div {...props} />;  // passes any prop including invalid HTML attrs\n}",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prop_spreading_dom', config.severityRules);
      const RE = /<(?:div|span|input|button|a|p|section|article|main|nav|header|footer)\s[^>]*\{\.\.\.(?:props|rest)\}/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'prop_spreading_dom', file: path, line: i + 1, message: 'Unknown props spread onto DOM element.', suggestion: 'Destructure and explicitly pass only valid HTML attributes to DOM elements.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_011',
    category: 'missing_useeffect_cleanup',
    description: 'useEffect with subscriptions, timers, or event listeners must return a cleanup function to prevent memory leaks.',
    severity: 'MEDIUM',
    tags: ['react', 'reliability', 'memory'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without cleanup, subscriptions and timers continue running after the component unmounts, causing memory leaks, stale state updates (React warns: "cannot update state on an unmounted component"), and accumulated resource usage.',
      commonViolations: ['useEffect(() => { socket.on("msg", handler); }, [])', 'useEffect(() => { setInterval(tick, 1000); }, [])'],
      goodExample: "useEffect(() => {\n  const interval = setInterval(tick, 1000);\n  return () => clearInterval(interval);  // cleanup\n}, [tick]);",
      badExample: "useEffect(() => {\n  emitter.on('data', handleData);  // never removed — memory leak\n}, []);",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_useeffect_cleanup', config.severityRules);
      const RE = /\buseEffect\s*\(/;
      const LEAK_RE = /(?:addEventListener|setInterval|setTimeout|\.on\s*\(|subscribe|WebSocket|EventSource)/;
      const CLEANUP_RE = /return\s*(?:\(\s*\)|=>\s*|function)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!RE.test(lines[i]!)) continue;
          const body = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
          if (LEAK_RE.test(body) && !CLEANUP_RE.test(body)) {
            findings.push({ severity, category: 'missing_useeffect_cleanup', file: path, line: i + 1, message: 'useEffect with subscription/timer but no cleanup return.', suggestion: 'Return a cleanup function: return () => { clearInterval(id); emitter.off(...); }' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_012',
    category: 'missing_suspense_boundary',
    description: 'Components using useSuspense, lazy(), or use() must be wrapped in a <Suspense> boundary.',
    severity: 'HIGH',
    tags: ['react', 'reliability', 'ux'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without a Suspense boundary, a suspended component causes a runtime error: "A React component suspended while rendering, but no fallback UI was specified." The entire subtree unmounts.',
      commonViolations: ['React.lazy(() => import("./HeavyComp")) without <Suspense>', 'Component using use() with no Suspense wrapper in tree'],
      goodExample: "<Suspense fallback={<Spinner />}>\n  <LazyComponent />\n</Suspense>",
      badExample: "const Chart = React.lazy(() => import('./Chart'));\n// In render:\n<Chart />  // crashes without Suspense",
      relatedPlaybooks: ['react-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_suspense_boundary', config.severityRules);
      const LAZY_RE = /\bReact\.lazy\s*\(|lazy\s*\(\s*\(\s*\)\s*=>\s*import/;
      const SUSPENSE_RE = /\bSuspense\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        if (LAZY_RE.test(content) && !SUSPENSE_RE.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (LAZY_RE.test(lines[i]!)) {
              findings.push({ severity, category: 'missing_suspense_boundary', file: path, line: i + 1, message: 'React.lazy() used without a <Suspense> boundary in this file.', suggestion: 'Wrap the lazy component in <Suspense fallback={<Loading />}>...</Suspense>.' });
              break;
            }
          }
        }
      }
      return findings;
    },
  },

  // ── React hooks, memo, and reconciliation expansions ─────────────────────

  {
    id: 'REACT_013',
    category: 'react_missing_key',
    description: "List items rendered without a stable key prop cause incorrect reconciliation and DOM mutations.",
    severity: 'HIGH',
    tags: ['react', 'performance', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React uses keys to identify which items changed/moved in a list. Without keys (or with array index as key), React may re-render or re-mount items incorrectly when items reorder, causing lost state, focus jumps, and wrong animations.",
      commonViolations: ["items.map(item => <Card>{item.name}</Card>)", "items.map((item, idx) => <Card key={idx}>{item.name}</Card>)"],
      goodExample: "items.map(item => <Card key={item.id}>{item.name}</Card>)  // stable identity-based key",
      badExample: "items.map((item, idx) => <li key={idx}>{item.title}</li>)  // index key breaks on reorder",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('react_missing_key', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\.(map|flatMap)\s*\(\s*(?:\([^)]*\)|[^=]+)\s*=>/.test(line)) {
            const block = lines.slice(i, i + 5).join('\n');
            if (/<[A-Z]\w+|<(?:li|div|td|tr|option)\b/.test(block) && !/key\s*=/.test(block)) {
              findings.push({ severity, category: 'react_missing_key', file: path, line: i + 1, message: 'List rendered via .map() without key prop — React reconciliation may produce incorrect DOM updates.', suggestion: "Add key={item.id} using a stable unique identifier, never the array index." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_014',
    category: 'react_index_key',
    description: "Using array index as React key prop causes incorrect reconciliation when items are added, removed, or reordered.",
    severity: 'MEDIUM',
    tags: ['react', 'correctness', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When items reorder (sort, filter, delete), React matches them by index. Item at index 0 gets the state of the old index 0, not the item itself. This causes component state (focus, input value, animation) to transfer to the wrong item.",
      commonViolations: ["list.map((item, index) => <Input key={index} value={item.value} />)"],
      goodExample: "list.map(item => <Input key={item.id} value={item.value} />)",
      badExample: "items.map((task, i) => <TaskItem key={i} task={task} />)  // state sticks to wrong task after reorder",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('react_index_key', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/key\s*=\s*\{?\s*(?:index|idx|i)\s*\}?/.test(line)) {
            findings.push({ severity, category: 'react_index_key', file: path, line: i + 1, message: 'Array index used as React key — causes incorrect reconciliation on sort/delete/insert.', suggestion: 'Use a stable unique identifier from the data: key={item.id} or key={item.slug}.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_015',
    category: 'use_callback_missing_dep',
    description: "useCallback with missing dependencies will use stale closure values instead of the latest state/props.",
    severity: 'HIGH',
    tags: ['react', 'hooks', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useCallback(() => fn(value), []) with an empty array memoizes the function with the initial value of `value`. When value updates, the memoized function still sees the old value — a classic stale closure bug.",
      commonViolations: ["const handler = useCallback(() => submitForm(formData), [])  // formData is stale"],
      goodExample: "const handler = useCallback(() => submitForm(formData), [formData, submitForm])",
      badExample: "const onClick = useCallback(() => doSomething(count), [])  // count is always 0",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('use_callback_missing_dep', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useCallback\s*\(/.test(line)) {
            const block = lines.slice(i, i + 5).join('\n');
            if (/,\s*\[\s*\]/.test(block) && /\([\w.]+\)/.test(block.replace(/useCallback\s*\(/, ''))) {
              findings.push({ severity, category: 'use_callback_missing_dep', file: path, line: i + 1, message: 'useCallback with empty dependency array calls a function with arguments — those arguments are stale.', suggestion: 'Add the function arguments to the dependency array: useCallback(() => fn(x), [fn, x]).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_016',
    category: 'react_memo_overuse',
    description: "Wrapping every component in React.memo adds comparison overhead and complexity without benefit when props change often.",
    severity: 'LOW',
    tags: ['react', 'performance', 'optimization'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React.memo runs a shallow equality check on every prop on every parent render. If props are objects or change frequently, the check itself costs more than just re-rendering. Only memo components when profiling shows unnecessary re-renders.",
      commonViolations: ["export default memo(SimpleLabel)  // StaticLabel just renders a string — no optimization needed"],
      goodExample: "// Profile first. memo is useful for:\n// - Components with many props that rarely change\n// - Computationally expensive renders\n// - Components at the bottom of a frequently re-rendered tree",
      badExample: "export default memo(function Button({ onClick, children }) { return <button onClick={onClick}>{children}</button> })  // onClick is a new reference anyway",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('react_memo_overuse', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const memoCount = (content.match(/\bReact\.memo\b|(?:^|\s)memo\s*\(/gm) || []).length;
        if (memoCount > 5) {
          findings.push({ severity, category: 'react_memo_overuse', file: path, message: `${memoCount} React.memo usages in one file — memo adds overhead. Profile first, memoize only where needed.`, suggestion: 'Use React DevTools Profiler to identify actual unnecessary renders before applying memo.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_017',
    category: 'state_update_unmounted',
    description: "Calling setState on an unmounted component causes memory leaks and 'Can\\'t perform state update on unmounted component' warnings.",
    severity: 'HIGH',
    tags: ['react', 'hooks', 'reliability', 'memory'],
    sinceVersion: '3.0.0',
    explain: {
      why: "An async operation (fetch, setTimeout) that completes after a component unmounts tries to call setState on a component that no longer exists. This leaks memory and causes errors. Cancel async work in useEffect cleanup.",
      commonViolations: ['useEffect(() => { fetch(url).then(data => setData(data)) }, [url])  // no cleanup on unmount'],
      goodExample: "useEffect(() => {\n  const controller = new AbortController()\n  fetch(url, { signal: controller.signal }).then(r => r.json()).then(setData).catch(() => {})\n  return () => controller.abort()  // cancel on unmount\n}, [url])",
      badExample: "useEffect(() => { fetch(url).then(d => setData(d)) }, [url])  // setState after unmount",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('state_update_unmounted', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useEffect\s*\(/.test(line)) {
            const block = lines.slice(i, i + 12).join('\n');
            const hasFetch = /fetch\s*\(|axios\.|setTimeout|setInterval/.test(block);
            const hasCleanup = /return\s*\(\s*\)|return\s*\(\)?\s*=>\s*\{|controller\.abort|clearTimeout|clearInterval/.test(block);
            if (hasFetch && !hasCleanup) {
              findings.push({ severity, category: 'state_update_unmounted', file: path, line: i + 1, message: 'useEffect with async operation but no cleanup — may setState after component unmounts.', suggestion: 'Return an AbortController cleanup: return () => controller.abort() to cancel on unmount.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_018',
    category: 'react_children_prop_type',
    description: "Using ReactNode instead of PropsWithChildren<T> or FC<T> for components that accept children is less idiomatic.",
    severity: 'LOW',
    tags: ['react', 'typescript', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React.FC was deprecated for implying children is always present. Use PropsWithChildren<Props> or explicitly type children: React.ReactNode. In React 18+, children is no longer implicit in React.FC.",
      commonViolations: ["const MyComponent: React.FC<Props> = ({ children }) => ...  // FC adds implicit any in older React"],
      goodExample: "interface Props { children: React.ReactNode; title: string }\nfunction MyComponent({ children, title }: Props) { ... }",
      badExample: "const Card: React.FC<{ title: string }> = ({ children, title }) => ...  // React 18 removed implicit children from FC",
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('react_children_prop_type', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/:\s*React\.FC</.test(line) || /:\s*FC</.test(line)) {
            findings.push({ severity, category: 'react_children_prop_type', file: path, line: i + 1, message: "React.FC implicitly typed children in React 17 but not React 18 — causes type errors on upgrade.", suggestion: "Declare children explicitly: interface Props { children?: React.ReactNode } in your Props type." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_019',
    category: 'conditional_hook_call',
    description: "Hooks called inside conditionals, loops, or early returns violate Rules of Hooks and cause crashes.",
    severity: 'BLOCKER',
    tags: ['react', 'hooks', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React tracks hook call order per component render. If a hook is called conditionally, the order changes between renders and React loses track of which state belongs to which hook — resulting in crashes or corrupt state.",
      commonViolations: ["if (isAdmin) { const data = useFetch('/admin') }  // conditional hook call"],
      goodExample: "const data = useFetch(isAdmin ? '/admin' : null)  // call hook unconditionally, pass condition as arg",
      badExample: "function Component({ isLoggedIn }) {\n  if (!isLoggedIn) return null  // early return before hook calls\n  const [state] = useState(0)  // violates Rules of Hooks\n}",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('conditional_hook_call', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        let inIf = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s+if\s*\(/.test(line)) inIf = true;
          if (inIf && /\buse[A-Z]\w+\s*\(/.test(line)) {
            findings.push({ severity, category: 'conditional_hook_call', file: path, line: i + 1, message: 'Hook called inside a conditional — violates Rules of Hooks.', suggestion: 'Call hooks unconditionally at the top of the component and pass the condition as a parameter.' });
          }
          if (inIf && /\}/.test(line)) inIf = false;
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_020',
    category: 'event_handler_async',
    description: "Async event handlers without error handling cause unhandled promise rejections that silently swallow errors.",
    severity: 'HIGH',
    tags: ['react', 'error-handling', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "onClick={async () => { await submitForm() }} will silently swallow any thrown errors. React doesn't catch async errors in event handlers. Wrap with try/catch and display errors to the user.",
      commonViolations: ["onClick={async () => { await api.delete(id) }}  // no error handling"],
      goodExample: "onClick={async () => {\n  try {\n    await api.delete(id)\n    showToast('Deleted')\n  } catch(err) {\n    showToast('Failed to delete', 'error')\n  }\n}}",
      badExample: "onSubmit={async (e) => { e.preventDefault(); await saveData(formData) }}  // throws silently",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('event_handler_async', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/on(?:Click|Submit|Change|Blur|Focus)\s*=\s*\{?\s*async\s*\(/.test(line)) {
            const block = lines.slice(i, i + 10).join('\n');
            if (!/try\s*\{/.test(block)) {
              findings.push({ severity, category: 'event_handler_async', file: path, line: i + 1, message: 'Async event handler without try/catch — errors are silently swallowed.', suggestion: 'Wrap with try/catch and update component state to display the error to the user.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_021',
    category: 'prop_drilling_deep',
    description: "Passing props through 4+ levels of components (prop drilling) is a strong signal to use Context or a state manager.",
    severity: 'LOW',
    tags: ['react', 'architecture', 'maintainability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Prop drilling (A→B→C→D→E for a single value) makes all intermediary components aware of data they don't use. Adding, removing, or changing the value requires touching every layer. Use Context or Zustand.",
      commonViolations: ["<Layout user={user}><Dashboard user={user}><Sidebar user={user}><Avatar user={user} /></Sidebar></Dashboard></Layout>"],
      goodExample: "const UserContext = createContext<User | null>(null)\n// In Avatar: const user = useContext(UserContext)",
      badExample: "<A user={user}><B user={user}><C user={user}><D user={user} /></C></B></A>  // 4 levels of prop drilling",
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prop_drilling_deep', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const propMatches = content.match(/\b(\w+)=\{\1\}/g) || [];
        const uniqueProps = new Set(propMatches.map(m => m.split('=')[0]!));
        for (const prop of uniqueProps) {
          const count = (content.match(new RegExp(`\\b${prop}=\\{${prop}\\}`, 'g')) || []).length;
          if (count >= 3) {
            findings.push({ severity, category: 'prop_drilling_deep', file: path, message: `Prop '${prop}' passed through ${count} component levels — use Context or a state manager.`, suggestion: `Create a Context for '${prop}' so consumers can access it directly without prop drilling.` });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_022',
    category: 'large_component',
    description: "Components over 200 lines mix too many concerns — break into smaller focused components.",
    severity: 'LOW',
    tags: ['react', 'maintainability', 'architecture'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A 400-line component likely renders multiple distinct sections, manages several pieces of state, and handles multiple user interactions. Each of these is a candidate for a dedicated component with its own state and tests.",
      commonViolations: ['// UserProfile.tsx that renders header, bio, posts list, settings, and friends'],
      goodExample: "// UserProfile.tsx: orchestrates sub-components\n// UserHeader.tsx, UserBio.tsx, UserPostsList.tsx — each focused",
      badExample: "// Dashboard.tsx: 600 lines handling nav, charts, tables, modals, and forms",
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('large_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lineCount = content.split('\n').length;
        if (lineCount > 250) {
          findings.push({ severity, category: 'large_component', file: path, message: `Component file is ${lineCount} lines — consider splitting into smaller focused components.`, suggestion: "Extract distinct sections (header, list, form) into separate components with their own files." });
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_023',
    category: 'usememo_stable_primitive',
    description: "Wrapping primitive values in useMemo provides no benefit — only memoize expensive computations or object references.",
    severity: 'LOW',
    tags: ['react', 'performance', 'hooks'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useMemo(() => someString, []) memoizes a primitive — this is pointless overhead since primitives are already compared by value in React's reconciliation. useMemo is only useful for expensive calculations or creating stable object/array references.",
      commonViolations: ['const label = useMemo(() => `Hello ${name}`, [name])  // string template — no object allocation'],
      goodExample: "const label = `Hello ${name}`  // just compute inline\nconst expensiveValue = useMemo(() => heavyComputation(data), [data])  // actually useful",
      badExample: "const isActive = useMemo(() => status === 'active', [status])  // boolean comparison — no memoization needed",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('usememo_stable_primitive', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useMemo\s*\(\s*\(\s*\)\s*=>/.test(line)) {
            const block = lines.slice(i, i + 3).join('\n');
            if (/useMemo\s*\(\s*\(\s*\)\s*=>\s*(?:`[^`]*`|'[^']*'|"\w+|\w+\s*===|\w+\s*!==|true|false|\d+)/.test(block)) {
              findings.push({ severity, category: 'usememo_stable_primitive', file: path, line: i + 1, message: 'useMemo on a primitive value provides no benefit — primitives are compared by value in React.', suggestion: 'Only use useMemo for expensive computations or to create stable object/array references.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_024',
    category: 'fragment_wrapper_unnecessary',
    description: "Returning a single element wrapped in <></> or <React.Fragment> is unnecessary boilerplate.",
    severity: 'LOW',
    tags: ['react', 'dx', 'quality'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Fragments exist to return multiple elements without a DOM wrapper. Wrapping a single element in a Fragment adds pointless noise to the JSX tree and slightly increases bundle size.",
      commonViolations: ["return (<><div>content</div></>)  // Fragment wrapping a single div"],
      goodExample: "return <div>content</div>",
      badExample: "return <><Component /></>  // unnecessary Fragment wrapper",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('fragment_wrapper_unnecessary', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/return\s*\(\s*<>$/.test(line)) {
            const block = lines.slice(i + 1, i + 6).join('\n');
            const tags = (block.match(/<\/?[A-Za-z]/g) || []).filter(t => !t.startsWith('</'));
            if (tags.length === 1 && /^\s*<\/>/.test(lines[i + 2] || '')) {
              findings.push({ severity, category: 'fragment_wrapper_unnecessary', file: path, line: i + 1, message: 'Fragment wrapping a single element — Fragment is only needed for multiple siblings.', suggestion: 'Return the element directly: return <Component /> without the wrapping <>...</>.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_025',
    category: 'use_id_for_a11y',
    description: "Generating DOM IDs with Math.random() or counters is unstable in SSR and should use React's useId() hook.",
    severity: 'MEDIUM',
    tags: ['react', 'accessibility', 'ssr'],
    sinceVersion: '3.0.0',
    explain: {
      why: "IDs generated with Math.random() or a module-level counter produce different values between SSR and client hydration, causing React hydration mismatches and mislinked label/input pairs (accessibility failure).",
      commonViolations: ["const id = `field-${Math.random()}`", "const id = `input-${counter++}`"],
      goodExample: "const id = useId()  // React 18+ — stable across SSR and client",
      badExample: "const labelId = `label-${Math.floor(Math.random() * 9999)}`  // different on SSR vs client",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('use_id_for_a11y', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/id.*Math\.random|id.*Date\.now\(\)|htmlFor.*Math\.random/.test(line)) {
            findings.push({ severity, category: 'use_id_for_a11y', file: path, line: i + 1, message: 'DOM ID generated with Math.random() — unstable during SSR/hydration, breaks accessible label associations.', suggestion: 'Use useId() from React 18+: const id = useId() for stable, unique IDs.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_026',
    category: 'dangerouslysetmlhtml_usage',
    description: "dangerouslySetInnerHTML with unescaped user content is a direct XSS vulnerability.",
    severity: 'BLOCKER',
    tags: ['react', 'security', 'xss'],
    sinceVersion: '3.0.0',
    explain: {
      why: "dangerouslySetInnerHTML bypasses React's XSS protection and injects raw HTML. If the content originates from user input or an external API, an attacker can inject <script> tags or event handlers to run arbitrary JavaScript.",
      commonViolations: ["dangerouslySetInnerHTML={{ __html: userComment }}", "dangerouslySetInnerHTML={{ __html: content }}"],
      goodExample: "// Option 1: Sanitize with DOMPurify first:\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />\n// Option 2: Parse Markdown to safe React elements with remark/rehype",
      badExample: "<div dangerouslySetInnerHTML={{ __html: post.content }} />  // XSS if content has user input",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('dangerouslysetmlhtml_usage', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/dangerouslySetInnerHTML/.test(line)) {
            const hasSanitize = content.includes('DOMPurify') || content.includes('sanitize') || content.includes('marked.parse') || content.includes('remark');
            if (!hasSanitize) {
              findings.push({ severity, category: 'dangerouslysetmlhtml_usage', file: path, line: i + 1, message: 'dangerouslySetInnerHTML without sanitization — XSS vulnerability if content contains user data.', suggestion: "Sanitize with DOMPurify.sanitize(content) before passing to dangerouslySetInnerHTML." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_027',
    category: 'use_transition_missing',
    description: "Expensive state updates that cause UI freezes should use startTransition to keep the UI responsive.",
    severity: 'LOW',
    tags: ['react', 'performance', 'concurrent'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When filtering a 10K item list on every keystroke, the UI freezes. React 18's startTransition marks the update as non-urgent, letting React interrupt it to handle more important updates (keystrokes, scroll) first.",
      commonViolations: ['onChange={e => setQuery(e.target.value)}  // expensive filter re-renders on every keystroke'],
      goodExample: "onChange={e => {\n  setInputValue(e.target.value)\n  startTransition(() => setQuery(e.target.value))  // non-urgent — can be interrupted\n}}",
      badExample: "onChange={e => setFilter(e.target.value)}  // expensive filter blocks UI on each keystroke",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('use_transition_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        if (content.includes('startTransition') || content.includes('useTransition')) return findings;
        if (content.includes('.filter(') && content.includes('onChange') && (content.match(/setState|set[A-Z]/g) || []).length > 3) {
          findings.push({ severity, category: 'use_transition_missing', file: path, message: 'Filtering large lists on input change without startTransition — may freeze UI on each keystroke.', suggestion: "Wrap the expensive state update in startTransition(() => setState(filtered)) to keep UI responsive." });
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_028',
    category: 'ref_as_state',
    description: "Using useRef to store values that should trigger re-renders misses the purpose of refs vs state.",
    severity: 'MEDIUM',
    tags: ['react', 'hooks', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useRef values don't trigger re-renders when changed. If you update ref.current and expect the UI to update, it won't — use useState instead. useRef is for: DOM references, previous values, and mutable values where re-render is NOT desired.",
      commonViolations: ['const count = useRef(0)\nsetInterval(() => { count.current++ }, 1000)  // display never updates'],
      goodExample: "const [count, setCount] = useState(0)\n// For non-rendering mutable value:\nconst timerId = useRef<NodeJS.Timeout | null>(null)",
      badExample: "const isOpen = useRef(false)\n<button onClick={() => { isOpen.current = !isOpen.current }}>Toggle</button>  // UI never reflects change",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ref_as_state', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const refMatch = line.match(/const\s+(\w+)\s*=\s*useRef\s*\(/);
          if (refMatch) {
            const refName = refMatch[1]!;
            const restContent = content.slice(content.indexOf(line));
            if (new RegExp(`${refName}\\.current\\s*=`).test(restContent)) {
              if (new RegExp(`\\{${refName}\\.current\\}`).test(restContent) || new RegExp(`>${refName}\\.current<`).test(restContent)) {
                findings.push({ severity, category: 'ref_as_state', file: path, line: i + 1, message: `useRef '${refName}' mutated and rendered — this won't trigger re-renders. Use useState instead.`, suggestion: `Replace with: const [${refName}, set${refName.charAt(0).toUpperCase() + refName.slice(1)}] = useState(...)` });
              }
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_029',
    category: 'portal_missing_container',
    description: "ReactDOM.createPortal should render into a DOM container that exists before mount — not document.body directly.",
    severity: 'MEDIUM',
    tags: ['react', 'portals', 'ssr'],
    sinceVersion: '3.0.0',
    explain: {
      why: "createPortal(children, document.body) renders at the end of <body> without a semantic container. In SSR/SSG, document.body may not exist during server render. Use a dedicated #portal or #modals container element.",
      commonViolations: ["createPortal(modalContent, document.body)  // no semantic container"],
      goodExample: "// index.html: <div id='portal-root'></div>\ncreatePortal(modalContent, document.getElementById('portal-root')!)",
      badExample: "return createPortal(<Modal />, document.body)  // appends to body, breaks SSR",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('portal_missing_container', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/createPortal\s*\([^,]+,\s*document\.body\s*\)/.test(line)) {
            findings.push({ severity, category: 'portal_missing_container', file: path, line: i + 1, message: "createPortal rendering into document.body — use a dedicated #portal-root container.", suggestion: "Create <div id='portal-root'></div> in index.html and use document.getElementById('portal-root')." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_030',
    category: 'effect_on_initial_render',
    description: "useEffect with an empty dependency array that sets visible state causes a flash of incorrect content (FOIC).",
    severity: 'MEDIUM',
    tags: ['react', 'ux', 'hydration'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useEffect only runs client-side after mount. If you use it to detect dark mode or screen size, the component first renders with the wrong value (SSR default), then updates — causing a visible flash. Use useSyncExternalStore for subscription-based reads or CSS media queries for visual-only changes.",
      commonViolations: ["const [isDark, setIsDark] = useState(false)\nuseEffect(() => { setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches) }, [])"],
      goodExample: "// CSS-based: prefers-color-scheme media query (no FOIC)\n// OR: useSyncExternalStore for subscription-based reads",
      badExample: "useEffect(() => { setTheme(localStorage.getItem('theme') ?? 'light') }, [])  // flash of light theme on dark-mode users",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('effect_on_initial_render', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useEffect\s*\(/.test(line)) {
            const block = lines.slice(i, i + 6).join('\n');
            if (/,\s*\[\s*\]/.test(block) && /(?:localStorage|window\.|document\.|matchMedia)/.test(block) && /set[A-Z]/.test(block)) {
              findings.push({ severity, category: 'effect_on_initial_render', file: path, line: i + 1, message: "useEffect reading browser APIs on mount causes a flash of incorrect content (FOIC) during SSR hydration.", suggestion: "Use CSS media queries for visual-only dark mode, or useSyncExternalStore for browser API subscriptions." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_031',
    category: 'async_missing_error_boundary',
    description: "Async data-fetching components without an error boundary crash the entire component tree on failure.",
    severity: 'HIGH',
    tags: ['react', 'error-handling', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React doesn't catch errors thrown during render in the same component — they bubble up to the nearest error boundary. Without one, a single failed fetch crashes the entire page and shows React's generic error screen.",
      commonViolations: ['// Component that fetches data with no error boundary ancestor'],
      goodExample: "import { ErrorBoundary } from 'react-error-boundary'\n<ErrorBoundary fallback={<ErrorFallback />}>\n  <DataFetchingComponent />\n</ErrorBoundary>",
      badExample: "// App renders <UserDashboard /> without error boundary — one API failure crashes everything",
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('async_missing_error_boundary', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        const isPageFile = path.includes('page.') || path.includes('App.');
        if (!isPageFile) return findings;
        if (!content.includes('ErrorBoundary') && !content.includes('error-boundary') && content.includes('await ')) {
          findings.push({ severity, category: 'async_missing_error_boundary', file: path, message: 'Page/App with async data components but no ErrorBoundary — failed fetch crashes entire page.', suggestion: "Wrap async components in <ErrorBoundary fallback={<ErrorFallback />}> from 'react-error-boundary'." });
        }
      }
      return findings;
    },
  },

  {
    id: 'REACT_032',
    category: 'debounce_missing_on_search',
    description: "Search/autocomplete inputs without debouncing fire an API request on every keystroke, overloading the server.",
    severity: 'MEDIUM',
    tags: ['react', 'performance', 'ux'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Calling fetch() on every onChange means 10 keystroke = 10 API requests, all racing. With debounce (300-500ms delay), only the final query fires. This reduces server load by ~90% on search inputs.",
      commonViolations: ["onChange={e => fetchSuggestions(e.target.value)}  // fires on every keystroke"],
      goodExample: "const debouncedSearch = useMemo(() => debounce(fetchSuggestions, 300), [])\nonChange={e => debouncedSearch(e.target.value)}",
      badExample: "onChange={async (e) => { const results = await api.search(e.target.value); setResults(results) }}",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('debounce_missing_on_search', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!JSX_EXT.test(path) || isTestPath(path)) continue;
        if (content.includes('debounce') || content.includes('useDebounce')) return findings;
        if (/onChange.*fetch|onChange.*axios|onChange.*api\./i.test(content)) {
          findings.push({ severity, category: 'debounce_missing_on_search', file: path, message: 'Search/autocomplete fires API calls on every onChange without debouncing — overloads server.', suggestion: "Add debounce: const debouncedFn = useMemo(() => debounce(fetchFn, 300), []) and call debouncedFn in onChange." });
        }
      }
      return findings;
    },
  },
];
