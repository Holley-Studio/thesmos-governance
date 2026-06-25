// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine } from './helpers';

function isFormFile(content: string): boolean {
  return /react-hook-form|useForm|useField|formik|Formik|Controller|register\(|handleSubmit|setValue\(|getValues\(/.test(content);
}

export const FORM_RULES: ThesmosRule[] = [
  {
    id: 'FORM_001',
    category: 'form_no_validation',
    description: 'Form submission handler without input validation allows empty or malformed data to reach the server.',
    severity: 'HIGH',
    tags: ['forms', 'validation', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'A form onSubmit that passes data directly to an API without validation means garbage-in-garbage-out. Any validation schema (zod, yup) or built-in HTML attributes (required, pattern) should be present.',
      commonViolations: ['const onSubmit = (data) => api.post("/users", data)  // no validation'],
      goodExample: "const form = useForm({ resolver: zodResolver(userSchema) })\nconst onSubmit = form.handleSubmit(async (data) => api.post('/users', data))",
      badExample: 'const onSubmit = (e) => { e.preventDefault(); api.post("/users", formData) }  // no validation',
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_no_validation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!content.includes('<form') && !content.includes('onSubmit')) continue;
        if (content.includes('zodResolver') || content.includes('yupResolver') || content.includes('resolver:') || content.includes('validate:')) continue;
        if (content.includes('required') && content.includes('pattern')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/onSubmit\s*=\s*\{?\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/.test(line)) {
            findings.push({ severity, category: 'form_no_validation', file: path, line: i + 1, message: 'Form onSubmit without a validation resolver — invalid data may reach the server.', suggestion: "Add zodResolver: useForm({ resolver: zodResolver(schema) }) for type-safe validation." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_002',
    category: 'form_accessibility_label',
    description: 'Form inputs without associated labels are inaccessible to screen readers and fail WCAG 2.1 Level A.',
    severity: 'HIGH',
    tags: ['forms', 'accessibility', 'a11y'],
    sinceVersion: '3.0.0',
    explain: {
      why: "An <input> without a <label htmlFor> or aria-label is invisible to screen readers. WCAG 2.1 Success Criterion 1.3.1 (Info and Relationships) is Level A — the minimum accessibility requirement.",
      commonViolations: ["<input type='email' placeholder='Email' />  // no label", "<input {...register('name')} />  // no label"],
      goodExample: "<label htmlFor='email'>Email address</label>\n<input id='email' type='email' {...register('email')} />",
      badExample: "<input type='email' placeholder='Email' />  // placeholder is NOT a label substitute",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_accessibility_label', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/<input\s/.test(line) && !line.includes('aria-label') && !line.includes('aria-labelledby') && !line.includes('type="hidden"') && !line.includes("type='hidden'")) {
            const surrounding = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
            if (!surrounding.includes('<label') && !surrounding.includes('htmlFor') && !surrounding.includes('aria-label')) {
              findings.push({ severity, category: 'form_accessibility_label', file: path, line: i + 1, message: 'Input element without an associated label — inaccessible to screen readers.', suggestion: "Add <label htmlFor='fieldId'> or aria-label='...' to the input element." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_003',
    category: 'form_inline_onchange',
    description: "Defining onChange handlers inline in JSX recreates the function on every render, hurting performance in large forms.",
    severity: 'LOW',
    tags: ['forms', 'performance', 'react'],
    sinceVersion: '3.0.0',
    explain: {
      why: "onChange={e => setValue(e.target.value)} creates a new function reference on every render. In large controlled forms with many fields, this causes unnecessary re-renders throughout the tree. Use useCallback or react-hook-form's Controller.",
      commonViolations: ['<input onChange={e => setName(e.target.value)} />'],
      goodExample: "const handleNameChange = useCallback(e => setName(e.target.value), [setName])\n<input onChange={handleNameChange} />",
      badExample: "<input onChange={e => setName(e.target.value)} />  // new function every render",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_inline_onchange', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/on(?:Change|Input)\s*=\s*\{\s*(?:e|event)\s*=>\s*set[A-Z]/.test(line)) {
            findings.push({ severity, category: 'form_inline_onchange', file: path, line: i + 1, message: 'Inline onChange arrow function creates a new reference every render.', suggestion: 'Extract to useCallback or use react-hook-form register() which avoids controlled components entirely.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_004',
    category: 'form_password_no_autocomplete',
    description: 'Password inputs without autocomplete="current-password" or "new-password" prevent password managers from working.',
    severity: 'MEDIUM',
    tags: ['forms', 'accessibility', 'ux', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without the correct autocomplete attribute, password managers cannot reliably autofill credentials. Users fall back to weak, memorable passwords. autocomplete='current-password' on login, 'new-password' on registration/change forms.",
      commonViolations: ["<input type='password' />", "<input type='password' autoComplete='off' />"],
      goodExample: "<input type='password' autoComplete='current-password' />  // login form\n<input type='password' autoComplete='new-password' />  // registration",
      badExample: "<input type='password' autoComplete='off' />  // blocks password managers",
      relatedPlaybooks: ['security.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_password_no_autocomplete', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/type\s*=\s*['"]password['"]/.test(line)) {
            const surrounding = lines.slice(i, i + 3).join('\n');
            if (!surrounding.includes('autoComplete') && !surrounding.includes('autocomplete')) {
              findings.push({ severity, category: 'form_password_no_autocomplete', file: path, line: i + 1, message: 'Password input without autoComplete attribute — password managers may not autofill.', suggestion: "Add autoComplete='current-password' (login) or autoComplete='new-password' (registration)." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_005',
    category: 'form_uncontrolled_then_controlled',
    description: "Switching a React input from uncontrolled to controlled (or vice versa) logs a React error and causes bugs.",
    severity: 'HIGH',
    tags: ['forms', 'react', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If value starts as undefined and later becomes a string, React switches from uncontrolled to controlled mode — it logs 'A component is changing an uncontrolled input to be controlled' and behavior becomes unpredictable.",
      commonViolations: ["value={user?.name}  // undefined initially, then 'Alice' when loaded"],
      goodExample: "value={user?.name ?? ''}  // always a string, never undefined",
      badExample: "value={user?.name}  // undefined then 'Alice' — React will warn and behave oddly",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_uncontrolled_then_controlled', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<input[^>]+value=\{[^}]+\?\./.test(line) && !line.includes('??') && !line.includes('||')) {
            findings.push({ severity, category: 'form_uncontrolled_then_controlled', file: path, line: i + 1, message: "Input value uses optional chaining without null fallback — may switch from uncontrolled to controlled.", suggestion: "Add null fallback: value={data?.field ?? ''} to keep input always controlled." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_006',
    category: 'form_reset_missing',
    description: "Forms with a clear/cancel button that doesn't reset validation state leave stale error messages visible.",
    severity: 'LOW',
    tags: ['forms', 'ux', 'react-hook-form'],
    sinceVersion: '3.0.0',
    explain: {
      why: "reset() from react-hook-form clears both values and errors. Manually setting values to '' (without calling reset()) leaves the form dirty, validation messages visible, and isDirty=true — confusing UX.",
      commonViolations: ["<button onClick={() => setName('')}>Cancel</button>  // errors still visible"],
      goodExample: "const { reset } = useForm()\n<button onClick={() => reset()}>Cancel</button>",
      badExample: "<button type='button' onClick={() => setValues({})}>Clear</button>  // doesn't clear errors",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_reset_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!isFormFile(content)) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/(?:Cancel|Clear|Reset)\w*.*onClick=/.test(line) || /onClick=.*(?:cancel|clear|reset)/i.test(line)) {
            const block = lines.slice(i, i + 3).join('\n');
            if (!block.includes('reset()') && !block.includes('reset(defaultValues')) {
              findings.push({ severity, category: 'form_reset_missing', file: path, line: i + 1, message: "Cancel/clear button doesn't call form reset() — validation errors remain visible.", suggestion: "Call reset() from useForm to clear both values and validation errors on cancel." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_007',
    category: 'form_error_display_missing',
    description: "Registered form fields without error display leave users without feedback on validation failures.",
    severity: 'MEDIUM',
    tags: ['forms', 'ux', 'react-hook-form'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If {...register('email')} is used but errors.email is never rendered, users silently cannot submit without understanding why. Always display formState.errors per field.",
      commonViolations: ['<input {...register("email", { required: true })} />  // no error display'],
      goodExample: "<input {...register('email')} />\n{errors.email && <span role='alert'>{errors.email.message}</span>}",
      badExample: "<input {...register('name', { required: 'Required' })} />  // error message never shown",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_error_display_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!content.includes('register(') && !content.includes('useForm(')) return findings;
        if (!content.includes('errors.') && !content.includes('formState.errors')) {
          findings.push({ severity, category: 'form_error_display_missing', file: path, message: 'react-hook-form used without rendering formState.errors — validation messages never shown to user.', suggestion: "Destructure errors from formState and render: {errors.field && <p role='alert'>{errors.field.message}</p>}." });
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_008',
    category: 'form_button_type_missing',
    description: "Buttons inside a <form> without an explicit type='button' default to type='submit', causing accidental submissions.",
    severity: 'HIGH',
    tags: ['forms', 'html', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "The default type for <button> inside a <form> is 'submit'. An icon button, upload trigger, or \"show password\" toggle inside a form triggers form submission when clicked unless type='button' is explicit.",
      commonViolations: ["<button onClick={togglePassword}>Show</button>  // inside form, will submit"],
      goodExample: "<button type='button' onClick={togglePassword}>Show</button>",
      badExample: "<form>\n  <button onClick={openPicker}>Browse</button>  // defaults to submit!\n</form>",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_button_type_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        if (!content.includes('<form')) return findings;
        const lines = content.split('\n');
        let inForm = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<form[\s>]/.test(line)) inForm = true;
          if (/<\/form>/.test(line)) inForm = false;
          if (inForm && /<button\s/.test(line) && !line.includes('type=') && line.includes('onClick')) {
            findings.push({ severity, category: 'form_button_type_missing', file: path, line: i + 1, message: "Button inside <form> without explicit type — defaults to 'submit', triggers form submission on click.", suggestion: "Add type='button' to all non-submit buttons inside forms." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_009',
    category: 'form_csrf_missing',
    description: 'Forms that POST data without CSRF protection are vulnerable to cross-site request forgery attacks.',
    severity: 'BLOCKER',
    tags: ['forms', 'security', 'csrf'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A malicious site can make a user's browser POST to your API using the user's cookies. CSRF tokens, SameSite=Strict cookies, or Origin header verification prevent this. Next.js Server Actions are protected by default; custom routes are not.",
      commonViolations: ["fetch('/api/transfer', { method: 'POST', body: JSON.stringify({ amount }) })  // no CSRF token"],
      goodExample: "// Option 1: Use Next.js Server Actions (auto-protected)\n// Option 2: Include CSRF token: { headers: { 'X-CSRF-Token': getCsrfToken() } }",
      badExample: "await fetch('/api/delete-account', { method: 'POST', body: JSON.stringify({ id }) })  // CSRF vulnerable",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_csrf_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx|ts|js)$/.test(path) || isTestPath(path)) continue;
        if (content.includes("'use server'") || content.includes('"use server"')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/fetch\s*\([^)]+,\s*\{[^}]*method\s*:\s*['"]POST['"]/.test(line)) {
            const surrounding = lines.slice(i, i + 5).join('\n');
            if (!surrounding.includes('csrf') && !surrounding.includes('CSRF') && !surrounding.includes('X-CSRF')) {
              findings.push({ severity, category: 'form_csrf_missing', file: path, line: i + 1, message: 'POST fetch without CSRF token — vulnerable to cross-site request forgery.', suggestion: "Include CSRF header: { 'X-CSRF-Token': token } or migrate to Next.js Server Actions." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_010',
    category: 'form_file_upload_no_validation',
    description: 'File upload inputs without type/size validation allow attackers to upload malicious files.',
    severity: 'HIGH',
    tags: ['forms', 'security', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without accept= and max-size validation, users can upload executables, oversized files, or files with dangerous MIME types. Always validate MIME type and size client-side (UX) and server-side (security).",
      commonViolations: ["<input type='file' />  // no accept, no size limit"],
      goodExample: "<input type='file' accept='image/jpeg,image/png,image/webp' />\n// Server: validate MIME type and file size (don't trust client-side only)",
      badExample: "<input type='file' onChange={handleUpload} />  // any file type, any size",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_file_upload_no_validation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/type\s*=\s*['"]file['"]/.test(line) && !line.includes('accept=') && !line.includes('accept ')) {
            findings.push({ severity, category: 'form_file_upload_no_validation', file: path, line: i + 1, message: "File input without 'accept' attribute — any file type can be uploaded.", suggestion: "Add accept='image/*' (or specific MIME types) and validate size/type on the server too." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_011',
    category: 'form_sensitive_in_url',
    description: "Submitting forms with GET method sends sensitive data (passwords, tokens) in the URL query string.",
    severity: 'BLOCKER',
    tags: ['forms', 'security', 'privacy'],
    sinceVersion: '3.0.0',
    explain: {
      why: "GET form submissions append all field values to the URL (?password=secret123). This exposes secrets in browser history, server logs, proxy logs, and Referer headers. Login and payment forms must use POST.",
      commonViolations: ["<form method='get'>  // with password field inside"],
      goodExample: "<form method='post' action='/login'>  // password in request body, not URL",
      badExample: "<form method='get'>  // form with password field — password appears in URL",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_sensitive_in_url', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        if (!content.includes('method=')) return findings;
        const lines = content.split('\n');
        let formStartLine = -1;
        let formHasGet = false;
        let formHasSensitive = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<form\s/.test(line)) { formStartLine = i; formHasGet = false; formHasSensitive = false; }
          if (/method\s*=\s*['"]get['"]/i.test(line)) formHasGet = true;
          if (/type\s*=\s*['"]password['"]/.test(line) || /name\s*=\s*['"](?:password|token|secret|key)['"]/.test(line)) formHasSensitive = true;
          if (/<\/form>/.test(line) && formHasGet && formHasSensitive) {
            findings.push({ severity, category: 'form_sensitive_in_url', file: path, line: formStartLine + 1, message: "GET form with sensitive fields — passwords/tokens will appear in URL and server logs.", suggestion: "Change to method='post' for forms containing passwords, tokens, or any sensitive data." });
            formHasGet = false;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_012',
    category: 'form_rhf_defaultvalues-async',
    description: "react-hook-form useForm defaultValues set asynchronously after initialization don't update the form.",
    severity: 'MEDIUM',
    tags: ['forms', 'react-hook-form', 'correctness'],
    sinceVersion: '3.0.0',
    explain: {
      why: "useForm({ defaultValues: { name: '' } }) captures the initial values at mount time. If you later fetch data and call setvalue/setValues on individual fields, the form's isDirty logic and reset() will use the wrong baseline. Use reset(fetchedData) to update defaults after async fetch.",
      commonViolations: ["useEffect(() => { Object.keys(data).forEach(k => setValue(k, data[k])) }, [data])"],
      goodExample: "useEffect(() => { if (data) reset(data) }, [data, reset])  // properly resets defaults",
      badExample: "useEffect(() => { setValue('name', user.name); setValue('email', user.email) }, [user])  // isDirty always true",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_rhf_defaultvalues-async', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!isFormFile(content)) return findings;
        const lines = content.split('\n');
        let inEffect = false;
        let effectSetValueCount = 0;
        let effectStart = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/useEffect\s*\(/.test(line)) { inEffect = true; effectSetValueCount = 0; effectStart = i; }
          if (inEffect && /setValue\s*\(/.test(line)) effectSetValueCount++;
          if (inEffect && /\}\s*,\s*\[/.test(line)) {
            if (effectSetValueCount >= 2) {
              findings.push({ severity, category: 'form_rhf_defaultvalues-async', file: path, line: effectStart + 1, message: 'Multiple setValue() calls in useEffect to set initial form data — use reset(data) instead.', suggestion: 'Use reset(fetchedData) to properly update default values after async data load.' });
            }
            inEffect = false;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_013',
    category: 'form_autocomplete_off',
    description: "autocomplete='off' is ignored by modern browsers for login fields and harms UX by blocking password managers.",
    severity: 'MEDIUM',
    tags: ['forms', 'ux', 'security', 'accessibility'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Chrome and Firefox ignore autocomplete='off' on password fields — they autofill anyway. Beyond being ineffective, it signals to password managers to avoid the field, which pushes users toward weaker passwords. Remove it and let password managers work.",
      commonViolations: ["<input type='password' autoComplete='off' />"],
      goodExample: "<input type='password' autoComplete='current-password' />",
      badExample: "<input type='password' autoComplete='off' />  // ineffective and harmful to UX",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_autocomplete_off', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/autoComplete\s*=\s*['"]off['"]/.test(line) || /autocomplete\s*=\s*['"]off['"]/.test(line)) {
            findings.push({ severity, category: 'form_autocomplete_off', file: path, line: i + 1, message: "autoComplete='off' is ignored by browsers on credential fields and blocks password managers.", suggestion: "Remove autoComplete='off' or replace with 'current-password', 'new-password', 'username' etc." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_014',
    category: 'form_loading_state_missing',
    description: 'Forms without loading state feedback allow double submissions and leave users confused during async operations.',
    severity: 'MEDIUM',
    tags: ['forms', 'ux', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without disabled={isSubmitting} on the submit button, users may click multiple times, sending duplicate requests. Without a loading indicator, users don't know if their action was received.",
      commonViolations: ['<button type="submit">Save</button>  // in a form that calls an API'],
      goodExample: "const { formState: { isSubmitting } } = useForm()\n<button type='submit' disabled={isSubmitting}>\n  {isSubmitting ? 'Saving...' : 'Save'}\n</button>",
      badExample: "<button type='submit'>Save</button>  // no disabled state — allows double submission",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_loading_state_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!isFormFile(content)) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/type\s*=\s*['"]submit['"]/.test(line) && !line.includes('disabled')) {
            findings.push({ severity, category: 'form_loading_state_missing', file: path, line: i + 1, message: "Submit button without disabled={isSubmitting} — allows double submission while the form is pending.", suggestion: "Add disabled={isSubmitting} from useForm's formState and show a loading indicator." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_015',
    category: 'form_no_aria_invalid',
    description: 'Form fields with validation errors should communicate the invalid state to assistive technologies via aria-invalid.',
    severity: 'MEDIUM',
    tags: ['forms', 'accessibility', 'a11y'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Screen readers read aria-invalid='true' to announce field errors. Without it, a sighted user sees red styling but a screen reader user has no indication the field is invalid. Pair with aria-describedby pointing to the error message element.",
      commonViolations: ['<input {...register("email")} />  // no aria-invalid on error'],
      goodExample: "<input\n  {...register('email')}\n  aria-invalid={errors.email ? 'true' : 'false'}\n  aria-describedby={errors.email ? 'email-error' : undefined}\n/>",
      badExample: "<input {...register('email')} />  // visual error styling but no aria-invalid",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_no_aria_invalid', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!content.includes('errors.') || !isFormFile(content)) return findings;
        if (!content.includes('aria-invalid')) {
          findings.push({ severity, category: 'form_no_aria_invalid', file: path, message: 'Form with validation errors does not set aria-invalid on inputs — screen readers cannot announce invalid state.', suggestion: "Add aria-invalid={!!errors.fieldName} and aria-describedby pointing to the error message element." });
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_016',
    category: 'form_number_input_string',
    description: "HTML number inputs always return string values — calling parseInt/Number inside onChange is error-prone.",
    severity: 'LOW',
    tags: ['forms', 'correctness', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: "e.target.value is always a string, even for type='number'. Forgetting to convert leads to '5' + 1 = '51' bugs. react-hook-form's valueAsNumber option handles this automatically.",
      commonViolations: ['register("age")  // in a number input — age will be string "25", not number 25'],
      goodExample: "register('age', { valueAsNumber: true })  // react-hook-form converts to number",
      badExample: "<input type='number' {...register('age')} />  // form value is string '25', not number",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_number_input_string', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!isFormFile(content)) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/type\s*=\s*['"]number['"]/.test(line)) {
            const surrounding = lines.slice(i, i + 3).join('\n');
            if (surrounding.includes('register(') && !surrounding.includes('valueAsNumber')) {
              findings.push({ severity, category: 'form_number_input_string', file: path, line: i + 1, message: "Number input registered without valueAsNumber — form value will be a string, not a number.", suggestion: "Add valueAsNumber: true to register options: register('count', { valueAsNumber: true })." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_017',
    category: 'form_no_error_role',
    description: "Error messages displayed conditionally should have role='alert' so screen readers announce them immediately.",
    severity: 'MEDIUM',
    tags: ['forms', 'accessibility', 'a11y'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When a validation error appears dynamically after form submission, screen readers won't announce it unless the element has role='alert' or aria-live='polite'. Without it, blind users miss the error entirely.",
      commonViolations: ["{errors.email && <p className='error'>{errors.email.message}</p>}"],
      goodExample: "{errors.email && <p role='alert' className='text-red-500'>{errors.email.message}</p>}",
      badExample: "{errors.email && <span>{errors.email.message}</span>}  // screen readers won't announce",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_no_error_role', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        if (!content.includes('errors.')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/errors\.\w+\s*&&\s*<[pspan]/.test(line) && !line.includes("role=") && !line.includes('role =')) {
            findings.push({ severity, category: 'form_no_error_role', file: path, line: i + 1, message: "Dynamic error message without role='alert' — screen readers won't announce when it appears.", suggestion: "Add role='alert' to the error element: <p role='alert'>{errors.field.message}</p>." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_018',
    category: 'form_watch_performance',
    description: "watch() from react-hook-form without field names watches all fields and triggers re-renders on every keystroke.",
    severity: 'MEDIUM',
    tags: ['forms', 'performance', 'react-hook-form'],
    sinceVersion: '3.0.0',
    explain: {
      why: "const values = watch() subscribes the component to every field change. Typing in any field re-renders the component. Use watch('specificField') or useWatch({ name: 'specificField' }) for targeted subscriptions.",
      commonViolations: ['const values = watch()  // watches everything'],
      goodExample: "const email = watch('email')  // only re-renders when email changes\n// or: const email = useWatch({ name: 'email' })",
      badExample: "const { name, email, address } = watch()  // re-renders on every keystroke in any field",
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_watch_performance', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!isFormFile(content)) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/=\s*watch\s*\(\s*\)/.test(line)) {
            findings.push({ severity, category: 'form_watch_performance', file: path, line: i + 1, message: "watch() without field names watches all fields — re-renders on every keystroke.", suggestion: "Watch specific fields: watch('fieldName') or useWatch({ name: 'fieldName' })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_019',
    category: 'form_required_not_communicated',
    description: 'Required fields indicated only by asterisks (*) without screen-reader-accessible text fail WCAG 3.3.2.',
    severity: 'MEDIUM',
    tags: ['forms', 'accessibility', 'a11y'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A visual * asterisk has no semantic meaning for screen readers. Use aria-required='true' or HTML required attribute, and provide a text legend explaining what * means (e.g., '* indicates required field').",
      commonViolations: ["<label>Name *</label><input />  // no aria-required or required attribute"],
      goodExample: "<label>Name <span aria-hidden='true'>*</span><span className='sr-only'>(required)</span></label>\n<input required aria-required='true' />",
      badExample: "<label>Email *</label><input type='email' />  // * not communicated to assistive tech",
      relatedPlaybooks: ['accessibility.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_required_not_communicated', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/<label[^>]*>.*\*.*<\/label>/.test(line) || (line.includes('*') && line.includes('<label'))) {
            const surrounding = lines.slice(i, i + 4).join('\n');
            if (!surrounding.includes('aria-required') && !surrounding.includes('required') && !surrounding.includes('sr-only')) {
              findings.push({ severity, category: 'form_required_not_communicated', file: path, line: i + 1, message: "Required field marker (*) without aria-required or required attribute — not communicated to screen readers.", suggestion: "Add required or aria-required='true' to the input, and add a legend explaining the asterisk." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'FORM_020',
    category: 'form_validation_server_only',
    description: 'Server-side-only validation without client-side feedback forces a round trip for basic errors like empty fields.',
    severity: 'MEDIUM',
    tags: ['forms', 'ux', 'validation'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Sending a form to the server only to discover 'email is required' is poor UX. Add the same validation schema on the client (zodResolver) to catch errors instantly, then re-validate on the server for security.",
      commonViolations: ['// No resolver on useForm, only server action validates'],
      goodExample: "// Client: useForm({ resolver: zodResolver(schema) })\n// Server Action: also validates with same schema — defense in depth",
      badExample: "// Client: useForm()  // no validation\n// Server: if (!email) throw new Error('Required')  // UX: one round trip per mistake",
      relatedPlaybooks: ['security.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('form_validation_server_only', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
        if (!isFormFile(content)) return findings;
        if (content.includes('action=') && content.includes('useForm') && !content.includes('resolver:') && !content.includes('zodResolver') && !content.includes('yupResolver')) {
          findings.push({ severity, category: 'form_validation_server_only', file: path, message: 'Form uses server action without client-side validation resolver — validation errors require a server round trip.', suggestion: "Add zodResolver: useForm({ resolver: zodResolver(sharedSchema) }) for instant client-side feedback." });
        }
      }
      return findings;
    },
  },
];
