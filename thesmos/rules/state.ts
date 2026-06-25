// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine, matchLines } from './helpers';

function isStateFile(content: string): boolean {
  return /zustand|createStore|useStore|redux|createSlice|useSelector|useDispatch|createContext|useContext/.test(content);
}

export const STATE_RULES: ThesmosRule[] = [
  {
    id: 'STATE_001',
    category: 'zustand_no_selector',
    description: "Selecting the entire Zustand store object causes all components to re-render on any state change.",
    severity: 'MEDIUM',
    tags: ['state', 'zustand', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const state = useStore() subscribes the component to the entire store. Any state change anywhere re-renders the component. Always use granular selectors: const count = useStore(s => s.count).",
      commonViolations: ['const state = useCounterStore()', 'const { user, posts, settings } = useAppStore()'],
      goodExample: 'const count = useCounterStore(s => s.count)\nconst increment = useCounterStore(s => s.increment)',
      badExample: 'const state = useStore()  // re-renders on any store update',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zustand_no_selector', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!content.includes('useStore') && !content.includes('Store()')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/=\s*use\w+Store\s*\(\s*\)/.test(line)) {
            findings.push({ severity, category: 'zustand_no_selector', file: path, line: i + 1, message: 'Zustand store called without a selector — subscribes to all state changes.', suggestion: 'Use a selector: const count = useStore(s => s.count) to minimize re-renders.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_002',
    category: 'zustand_missing_immer',
    description: "Mutating nested objects directly in Zustand without Immer requires spreading at every level, causing bugs.",
    severity: 'MEDIUM',
    tags: ['state', 'zustand', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "set(state => { state.user.name = 'Alice' }) mutates the existing object — Zustand won't detect the change because reference equality holds. Use spread: set(s => ({ user: { ...s.user, name: 'Alice' } })) or enable Immer middleware.",
      commonViolations: ['set(state => { state.user.profile.name = name })'],
      goodExample: "import { immer } from 'zustand/middleware/immer'\ncreate(immer(set => ({ update: (name) => set(s => { s.user.name = name }) })))",
      badExample: "set(state => { state.nested.value = newVal })  // mutation won't trigger re-render",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zustand_missing_immer', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('zustand') && !content.includes('create(')) continue;
        if (content.includes("immer")) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/set\s*\(\s*(?:state|s|store)\s*=>\s*\{/.test(line)) {
            const block = lines.slice(i, i + 5).join('\n');
            if (/(?:state|s|store)\.\w+\.\w+\s*=/.test(block)) {
              findings.push({ severity, category: 'zustand_missing_immer', file: path, line: i + 1, message: 'Nested state mutation in Zustand without Immer middleware — change may not trigger re-render.', suggestion: 'Use Immer middleware or spread nested objects: set(s => ({ a: { ...s.a, b: newVal } })).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_003',
    category: 'redux_mutating-state',
    description: "Mutating Redux state outside of a createSlice reducer loses Immer's protection and breaks time-travel debugging.",
    severity: 'HIGH',
    tags: ['state', 'redux', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Redux requires state to be treated as immutable. Mutations outside createSlice's Immer-wrapped reducers corrupt the Redux state tree and break DevTools. Always return a new object or rely on createSlice's Immer.",
      commonViolations: ['state.items.push(item)  // in a non-Immer reducer', 'state.user = action.payload  // mutating outside createSlice'],
      goodExample: "const slice = createSlice({ reducers: { addItem(state, action) { state.items.push(action.payload) } } })  // Immer-protected",
      badExample: "function reducer(state, action) { state.items.push(action.payload); return state }  // mutation!",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('redux_mutating-state', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('useReducer') && !content.includes('function reducer') && !content.includes('createReducer')) return findings;
        if (content.includes('createSlice')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\bstate\.\w+(?:\.\w+)?\s*=(?!=)/.test(line) || /\bstate\.\w+\.push\(/.test(line)) {
            findings.push({ severity, category: 'redux_mutating-state', file: path, line: i + 1, message: 'State mutation in a non-Immer reducer — breaks Redux immutability contract.', suggestion: 'Return a new object or migrate to createSlice which wraps reducers with Immer.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_004',
    category: 'context_value_unstable',
    description: "Passing an object or array literal as Context value triggers all consumers to re-render on every parent render.",
    severity: 'HIGH',
    tags: ['state', 'react', 'performance', 'context'],
    sinceVersion: '3.0.0',
    explain: {
      why: "<Context.Provider value={{ user, setUser }}> creates a new object on every render. Since objects are compared by reference, all consumers re-render even if user hasn't changed. Memoize with useMemo.",
      commonViolations: ["<Context.Provider value={{ user, setUser }}>", "<ThemeContext.Provider value={{ theme, setTheme }}>"],
      goodExample: "const value = useMemo(() => ({ user, setUser }), [user, setUser])\n<Context.Provider value={value}>",
      badExample: "<Context.Provider value={{ user, setUser }}>  // new object every render",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('context_value_unstable', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/Context\.Provider\s+value=\{\s*\{/.test(line) || /Provider\s+value=\{\{/.test(line)) {
            findings.push({ severity, category: 'context_value_unstable', file: path, line: i + 1, message: 'Context.Provider passed object literal as value — creates new reference on every render, re-rendering all consumers.', suggestion: 'Memoize: const value = useMemo(() => ({ a, b }), [a, b]) and pass value to Provider.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_005',
    category: 'context_overuse',
    description: 'Using Context for high-frequency state (UI, form values, search queries) causes cascading re-renders.',
    severity: 'MEDIUM',
    tags: ['state', 'react', 'performance', 'context'],
    sinceVersion: '3.0.0',
    explain: {
      why: "React Context triggers re-renders in ALL consumers when the value changes — even for unrelated consumers. Use Context for low-frequency, app-wide state (auth, theme). Use Zustand, Jotai, or local state for frequent updates.",
      commonViolations: ['// SearchContext that updates on every keystroke', '// FormContext that holds all field values'],
      goodExample: '// Context for: auth user, theme, locale — changes rarely\n// Zustand/Jotai for: search state, UI state, cart — changes frequently',
      badExample: "const SearchContext = createContext('')  // updates on every keystroke, rerenders all consumers",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('context_overuse', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const contextNames = [...content.matchAll(/createContext\s*\(/g)];
        if (contextNames.length > 3) {
          findings.push({ severity, category: 'context_overuse', file: path, message: `${contextNames.length} Context objects in one file — consider consolidating or using a state manager for high-frequency state.`, suggestion: 'Use Zustand or Jotai atoms for frequently-updated state. Reserve Context for auth, theme, locale.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_006',
    category: 'useselector_no-equality',
    description: "useSelector without an equality function re-renders on every dispatch, even if the selected value is unchanged.",
    severity: 'MEDIUM',
    tags: ['state', 'redux', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useSelector(s => s.items.filter(...)) creates a new array every call. Since the reference changes, the component re-renders on every action dispatch. Use shallowEqual or reselect memoized selectors.",
      commonViolations: ['const items = useSelector(s => s.items.filter(i => i.active))'],
      goodExample: "import { createSelector } from '@reduxjs/toolkit'\nconst selectActive = createSelector(s => s.items, items => items.filter(i => i.active))",
      badExample: "const items = useSelector(s => s.items.filter(i => i.active))  // new array every dispatch",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('useselector_no-equality', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('useSelector')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useSelector\s*\([^)]*\.(filter|map|reduce|find|flatMap)\s*\(/.test(line)) {
            findings.push({ severity, category: 'useselector_no-equality', file: path, line: i + 1, message: 'useSelector with array method returns new reference on every call — causes unnecessary re-renders.', suggestion: 'Use createSelector from @reduxjs/toolkit for memoized selectors.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_007',
    category: 'atom_in_component',
    description: 'Defining Jotai/Recoil atoms inside a component body recreates them on every render, losing state.',
    severity: 'HIGH',
    tags: ['state', 'jotai', 'recoil', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const myAtom = atom(0) inside a component function creates a new atom on each render. All state resets on re-render. Atoms must be defined at module scope (outside components).",
      commonViolations: ['function MyComponent() { const myAtom = atom(0) }'],
      goodExample: "const countAtom = atom(0)  // module scope\nfunction MyComponent() { const [count, setCount] = useAtom(countAtom) }",
      badExample: "function Counter() {\n  const countAtom = atom(0)  // new atom every render — state lost\n}",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('atom_in_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('atom(') || (!content.includes('jotai') && !content.includes('recoil'))) continue;
        const lines = content.split('\n');
        let depth = 0;
        let inComponent = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:export\s+)?(?:default\s+)?function\s+[A-Z]/.test(line) || /^const\s+[A-Z]\w+\s*=\s*(?:\([^)]*\)|[^=]+)?\s*=>/.test(line)) {
            inComponent = true;
            depth = 0;
          }
          if (inComponent) {
            depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            if (/\batom\s*\(/.test(line) && depth > 0) {
              findings.push({ severity, category: 'atom_in_component', file: path, line: i + 1, message: 'Jotai/Recoil atom defined inside a component — recreated on every render, losing state.', suggestion: 'Move atom definitions to module scope (outside all functions).' });
            }
            if (depth < 0) inComponent = false;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_008',
    category: 'redux_dispatch_in_render',
    description: 'Dispatching Redux actions during component render (not in useEffect or event handlers) causes infinite loops.',
    severity: 'BLOCKER',
    tags: ['state', 'redux', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "dispatch(fetchData()) called at the top level of a component renders → dispatches → state changes → renders again → infinite loop. Always dispatch inside useEffect, event handlers, or async functions.",
      commonViolations: ['const Component = () => { dispatch(loadUser()) }  // dispatch during render'],
      goodExample: "useEffect(() => { dispatch(loadUser()) }, [dispatch])",
      badExample: "function Page() {\n  dispatch(fetchPosts())  // called during render — infinite loop\n  return <div/>\n}",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('redux_dispatch_in_render', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path) || isTestPath(path)) continue;
        if (!content.includes('useDispatch')) return findings;
        const lines = content.split('\n');
        let inComponent = false;
        let inEffect = false;
        let inHandler = false;
        let depth = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:export\s+)?(?:default\s+)?function\s+[A-Z]/.test(line)) { inComponent = true; depth = 0; }
          if (inComponent) {
            if (/useEffect\s*\(/.test(line)) inEffect = true;
            if (/on[A-Z]\w+\s*=|handle\w+\s*=|onClick|onSubmit/.test(line)) inHandler = true;
            depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            if (/\bdispatch\s*\(/.test(line) && !inEffect && !inHandler && depth === 1) {
              findings.push({ severity, category: 'redux_dispatch_in_render', file: path, line: i + 1, message: 'Redux dispatch called during render — will cause an infinite update loop.', suggestion: 'Move dispatch inside useEffect or an event handler.' });
            }
            if (depth < 0) { inComponent = false; inEffect = false; inHandler = false; }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_009',
    category: 'usestate_complex-object',
    description: "useState with a complex object causes full re-renders when any nested value changes. Prefer useReducer or splitting state.",
    severity: 'MEDIUM',
    tags: ['state', 'react', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const [form, setForm] = useState({ name: '', email: '', address: { ... } }) means updating name calls setForm with a full copy, re-rendering everything that reads form. Split into individual fields or use useReducer.",
      commonViolations: ['const [form, setForm] = useState({ name, email, address, phone, preferences })'],
      goodExample: 'const [name, setName] = useState("")\nconst [email, setEmail] = useState("")\n// or: const [state, dispatch] = useReducer(formReducer, initialState)',
      badExample: 'const [form, setForm] = useState({ name: "", email: "", address: {}, preferences: {} })',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('usestate_complex-object', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useState\s*\(\s*\{/.test(line)) {
            const block = lines.slice(i, i + 10).join('');
            const commaCount = (block.match(/:/g) || []).length;
            if (commaCount >= 4) {
              findings.push({ severity, category: 'usestate_complex-object', file: path, line: i + 1, message: 'useState with a complex object (4+ fields) — consider useReducer or splitting into separate state atoms.', suggestion: 'Use useReducer for complex form state or split into individual useState calls per field.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_010',
    category: 'usereducer_missing-default',
    description: 'useReducer switch statements without a default case cause unhandled actions to return undefined.',
    severity: 'HIGH',
    tags: ['state', 'react', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If an unrecognized action type is dispatched, a reducer without default: return state returns undefined, corrupting the state tree and causing cryptic null reference errors.",
      commonViolations: ['function reducer(state, action) { switch(action.type) { case "A": ... } }  // no default'],
      goodExample: "switch(action.type) {\n  case 'INCREMENT': return { count: state.count + 1 }\n  default: return state  // always return current state for unknown actions\n}",
      badExample: "switch(action.type) { case 'A': return newState }  // returns undefined for unknown actions",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('usereducer_missing-default', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('useReducer') && !content.includes('function reducer')) return findings;
        const switchMatches = [...content.matchAll(/switch\s*\(\s*action\.type\s*\)\s*\{/g)];
        for (const match of switchMatches) {
          const switchStart = match.index!;
          const block = content.slice(switchStart, switchStart + 1000);
          if (!block.includes('default:') && !block.includes('default :')) {
            const lineIdx = content.slice(0, switchStart).split('\n').length;
            findings.push({ severity, category: 'usereducer_missing-default', file: path, line: lineIdx, message: 'Reducer switch statement missing default case — unknown actions return undefined.', suggestion: "Add: default: return state as the last case in every reducer switch." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_011',
    category: 'zustand_persist_sensitive',
    description: "Persisting sensitive data (tokens, passwords) to localStorage via zustand/persist exposes it to XSS.",
    severity: 'BLOCKER',
    tags: ['state', 'zustand', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: "localStorage is readable by any JavaScript on the page. If any third-party script or XSS vulnerability exists, persisted tokens are immediately compromised. Store JWTs in httpOnly cookies instead.",
      commonViolations: ['persist({ token, password, ... }, { name: "auth-storage" })'],
      goodExample: '// Use httpOnly cookies for tokens (set by server)\n// Only persist non-sensitive UI state to localStorage',
      badExample: "persist({ token: state.token, apiKey: state.apiKey }, { name: 'auth' })  // token in localStorage",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zustand_persist_sensitive', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('persist') || !content.includes('zustand')) return findings;
        const SENSITIVE = /(?:token|password|secret|apiKey|api_key|accessToken|refreshToken)/i;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/persist\s*\(/.test(line) && SENSITIVE.test(content.slice(content.indexOf('persist(')!, content.indexOf(')', content.indexOf('persist(')!) + 1))) {
            findings.push({ severity, category: 'zustand_persist_sensitive', file: path, line: i + 1, message: 'Sensitive data (token/password/key) may be persisted to localStorage via zustand/persist — XSS risk.', suggestion: 'Store authentication tokens in httpOnly cookies. Only persist non-sensitive UI state.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_012',
    category: 'global_state_server_component',
    description: 'Global mutable state (module-level variables) in Next.js Server Components leaks between requests.',
    severity: 'BLOCKER',
    tags: ['state', 'nextjs', 'security', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js server modules are cached across requests. A module-level let currentUser = null is shared between ALL concurrent users — one user's data bleeds into another's request. Use cookies, headers, or request-scoped stores.",
      commonViolations: ['let currentUser: User | null = null  // module-level in a server file'],
      goodExample: "import { cookies } from 'next/headers'\nconst user = await getUserFromCookie(cookies())",
      badExample: "// In lib/context.ts (server)\nlet currentUser: User | null = null  // shared across all HTTP requests!",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('global_state_server_component', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes("'use client'") || content.includes('"use client"')) return findings;
        if (!path.includes('app/') && !path.includes('server') && !path.includes('actions')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:let|var)\s+\w+\s*(?::\s*\w+[^=]*)?\s*=/.test(line) && !/^(?:let|var)\s+\w+\s*=\s*(?:null|undefined|''|""|0|false|\[\]|\{\})/.test(line) === false) {
            if (/(?:user|session|auth|token|request)/i.test(line)) {
              findings.push({ severity, category: 'global_state_server_component', file: path, line: i + 1, message: 'Mutable module-level variable in server code — shared across all HTTP requests.', suggestion: "Use Next.js request-scoped stores: cookies(), headers(), or AsyncLocalStorage." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_013',
    category: 'usestate_stale_closure',
    description: 'Updating state based on previous value without the functional form causes stale closure bugs.',
    severity: 'HIGH',
    tags: ['state', 'react', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "setCount(count + 1) captures count from the closure at the time the event handler was created. If multiple updates happen in a batch, each reads the same stale count. Use setCount(c => c + 1) for correct functional updates.",
      commonViolations: ['setCount(count + 1)', 'setItems([...items, newItem])'],
      goodExample: 'setCount(c => c + 1)\nsetItems(prev => [...prev, newItem])',
      badExample: 'setCount(count + 1)  // count may be stale in batched updates or async handlers',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('usestate_stale_closure', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/set[A-Z]\w+\s*\(\s*\w+\s*[+\-*]\s*\d+\s*\)/.test(line) || /set[A-Z]\w+\s*\(\s*\[\.\.\.\w+,/.test(line)) {
            if (!/=>\s/.test(line)) {
              findings.push({ severity, category: 'usestate_stale_closure', file: path, line: i + 1, message: 'State update reads current value directly — may be stale in async or batched updates.', suggestion: 'Use functional form: setState(prev => prev + 1) to always reference the latest state.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_014',
    category: 'local_storage_in_ssr',
    description: "Accessing localStorage in code that runs during SSR throws 'localStorage is not defined' in Node.js.",
    severity: 'HIGH',
    tags: ['state', 'nextjs', 'ssr', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "localStorage is a browser-only API. Calling it during SSR (in Next.js getServerSideProps, Server Components, or top-level module code) throws ReferenceError in Node.js.",
      commonViolations: ['const token = localStorage.getItem("token")  // in a shared util'],
      goodExample: "const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null",
      badExample: "const savedTheme = localStorage.getItem('theme')  // throws during SSR",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('local_storage_in_ssr', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (content.includes("'use client'") || content.includes('"use client"')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\blocalStorage\b/.test(line) && !/typeof\s+window/.test(line)) {
            findings.push({ severity, category: 'local_storage_in_ssr', file: path, line: i + 1, message: 'localStorage accessed without SSR guard — throws in Node.js environments.', suggestion: "Guard with: typeof window !== 'undefined' && localStorage.getItem(...), or move to 'use client' component." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_015',
    category: 'redux_toolkit_createasync-unhandled',
    description: "createAsyncThunk results not handled in extraReducers leave loading/error state untracked.",
    severity: 'MEDIUM',
    tags: ['state', 'redux', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "createAsyncThunk generates three action types: pending, fulfilled, rejected. Not handling rejected means errors are silently dropped and components can't show error states.",
      commonViolations: ['extraReducers: (b) => b.addCase(fetchUser.fulfilled, ...) // missing rejected case'],
      goodExample: "builder\n  .addCase(fetchUser.pending, (state) => { state.loading = true })\n  .addCase(fetchUser.fulfilled, (state, action) => { state.data = action.payload })\n  .addCase(fetchUser.rejected, (state, action) => { state.error = action.error.message })",
      badExample: "builder.addCase(fetchUser.fulfilled, ...)  // rejected case missing — errors silently dropped",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('redux_toolkit_createasync-unhandled', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('createAsyncThunk') && !content.includes('extraReducers')) return findings;
        const asyncThunkNames = [...content.matchAll(/const\s+(\w+)\s*=\s*createAsyncThunk\s*\(/g)].map(m => m[1]!);
        for (const name of asyncThunkNames) {
          if (content.includes(`${name}.fulfilled`) && !content.includes(`${name}.rejected`)) {
            findings.push({ severity, category: 'redux_toolkit_createasync-unhandled', file: path, message: `createAsyncThunk '${name}' handles fulfilled but not rejected — errors silently dropped.`, suggestion: `Add .addCase(${name}.rejected, (state, action) => { state.error = action.error.message }) to extraReducers.` });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_016',
    category: 'state_sync_to_url-missing',
    description: "Searchable or filterable UI state should be synced to the URL to enable sharing and browser back/forward.",
    severity: 'LOW',
    tags: ['state', 'ux', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Filters, search queries, sort order, and pagination stored only in useState are lost on page refresh and can't be shared via URL. Use nuqs, next/navigation searchParams, or URLSearchParams to persist them in the URL.",
      commonViolations: ['const [search, setSearch] = useState("")  // in a search/filter page'],
      goodExample: "import { useQueryState } from 'nuqs'\nconst [search, setSearch] = useQueryState('q')",
      badExample: "const [filter, setFilter] = useState('all')  // lost on refresh, can't share URL",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('state_sync_to_url-missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!path.includes('page') && !path.includes('list') && !path.includes('search') && !path.includes('filter')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useState\s*\(\s*['"](?:all|none|asc|desc|recent|popular)['"]\s*\)/.test(line) || (/useState\s*\(\s*['"]{2}\s*\)/.test(line) && /filter|search|sort|query/i.test(line))) {
            findings.push({ severity, category: 'state_sync_to_url-missing', file: path, line: i + 1, message: 'Filter/search/sort state in a list page not synced to URL — lost on refresh, not shareable.', suggestion: "Use nuqs useQueryState() or next/navigation to sync filter/sort state to URL search params." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_017',
    category: 'useeffect_state_sync',
    description: "Using useEffect to sync two pieces of state is an anti-pattern that causes double renders and timing bugs.",
    severity: 'MEDIUM',
    tags: ['state', 'react', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useEffect(() => { setDerived(compute(source)) }, [source]) causes a double render: once when source changes, then again when derived is set. Compute derived values during render: const derived = compute(source).",
      commonViolations: ["useEffect(() => { setFullName(firstName + ' ' + lastName) }, [firstName, lastName])"],
      goodExample: "const fullName = `${firstName} ${lastName}`  // computed during render, no effect needed",
      badExample: "useEffect(() => { setFullName(firstName + ' ' + lastName) }, [firstName, lastName])  // double render",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('useeffect_state_sync', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/.test(line)) {
            const block = lines.slice(i, i + 6).join('\n');
            if (/set[A-Z]\w+\s*\(/.test(block) && !/fetch|axios|api|request/.test(block.toLowerCase())) {
              findings.push({ severity, category: 'useeffect_state_sync', file: path, line: i + 1, message: 'useEffect used to sync derived state — causes double render. Compute derived values during render instead.', suggestion: 'Replace with: const derived = compute(sourceValue) in the render body (no useEffect needed).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_018',
    category: 'context_no-display-name',
    description: "Unnamed React contexts show as 'Context.Consumer' in DevTools, making debugging difficult.",
    severity: 'LOW',
    tags: ['state', 'react', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: "createContext() without a displayName makes React DevTools show generic labels. Setting context.displayName = 'AuthContext' makes component trees readable and debugging far faster.",
      commonViolations: ['const AuthContext = createContext<User | null>(null)  // no displayName'],
      goodExample: "const AuthContext = createContext<User | null>(null)\nAuthContext.displayName = 'AuthContext'",
      badExample: "const MyContext = createContext(null)  // shows as 'Context' in DevTools",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('context_no-display-name', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const contextMatches = [...content.matchAll(/const\s+(\w+Context)\s*=\s*createContext\s*\(/g)];
        for (const match of contextMatches) {
          const name = match[1]!;
          if (!content.includes(`${name}.displayName`)) {
            const lineIdx = content.slice(0, match.index).split('\n').length;
            findings.push({ severity, category: 'context_no-display-name', file: path, line: lineIdx, message: `Context '${name}' missing displayName — shows as 'Context' in React DevTools.`, suggestion: `Add: ${name}.displayName = '${name}' after the createContext call.` });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_019',
    category: 'server_action_state-revalidation',
    description: 'Next.js Server Actions that mutate data without revalidatePath/revalidateTag leave the cache stale.',
    severity: 'HIGH',
    tags: ['state', 'nextjs', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When a Server Action modifies a database record, Next.js still serves the old cached data to other users and on navigation. Call revalidatePath('/path') or revalidateTag('tag') to invalidate stale cache entries.",
      commonViolations: ["'use server'\nasync function updatePost(id, data) { await db.update(...) }  // no revalidation"],
      goodExample: "'use server'\nimport { revalidatePath } from 'next/cache'\nasync function updatePost(id, data) {\n  await db.update(...)\n  revalidatePath('/posts')\n}",
      badExample: "'use server'\nexport async function deleteComment(id) { await prisma.comment.delete({ where: { id } }) }  // cache stays stale",
      relatedPlaybooks: ['nextjs-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('server_action_state-revalidation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes("'use server'") && !content.includes('"use server"')) return findings;
        if (content.includes('revalidatePath') || content.includes('revalidateTag')) return findings;
        const MUTATING = /\b(?:create|update|delete|insert|upsert|save|remove|patch)\w*\s*\(/i;
        if (MUTATING.test(content)) {
          findings.push({ severity, category: 'server_action_state-revalidation', file: path, message: "Server Action file mutates data without revalidatePath/revalidateTag — cache stays stale.", suggestion: "Call revalidatePath('/affected-route') or revalidateTag('data-tag') after mutations." });
        }
      }
      return findings;
    },
  },

  {
    id: 'STATE_020',
    category: 'zustand_store-per-feature',
    description: "One large Zustand store for the entire app causes cross-feature coupling and makes testing harder.",
    severity: 'LOW',
    tags: ['state', 'zustand', 'architecture'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A single useAppStore with 50+ fields mixes unrelated concerns and forces any change to the store shape to touch all selectors across the codebase. Zustand encourages small, focused stores per feature (useAuthStore, useCartStore, useUIStore).",
      commonViolations: ['const useAppStore = create(() => ({ user, cart, posts, comments, settings, ui, theme, ... }))'],
      goodExample: 'const useAuthStore = create(() => ({ user, token }))\nconst useCartStore = create(() => ({ items, total }))',
      badExample: 'const useAppStore = create(() => ({ ...authState, ...cartState, ...uiState }))  // all state in one store',
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('zustand_store-per-feature', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (!content.includes('zustand') || !content.includes('create(')) return findings;
        const createMatch = content.match(/create\s*\(\s*(?:immer\s*\()?\s*(?:\w+\s*=>|set\s*=>)\s*\(\s*\{([^}]{200,})/);
        if (createMatch) {
          const fieldCount = (createMatch[1]!.match(/,\s*\n/g) || []).length;
          if (fieldCount > 10) {
            findings.push({ severity, category: 'zustand_store-per-feature', file: path, message: `Zustand store has ${fieldCount}+ fields — consider splitting into domain-specific stores.`, suggestion: 'Split into useAuthStore, useCartStore, useUIStore etc. for better separation of concerns.' });
          }
        }
      }
      return findings;
    },
  },
];
