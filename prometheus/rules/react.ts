import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, JSX_EXT, isTestPath, isCommentLine } from './helpers';

export const REACT_RULES: PrometheusRule[] = [
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
];
