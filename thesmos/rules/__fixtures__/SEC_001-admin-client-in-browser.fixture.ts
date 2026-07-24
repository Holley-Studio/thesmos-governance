// Triggers: [SEC_001] admin_client_in_browser
// Rule fires when 'use client' + SERVICE_ROLE_KEY are both present in the same file.
export const RULE_ID = 'SEC_001';

export const POSITIVE_FIXTURE = `'use client';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.URL!, process.env.SERVICE_ROLE_KEY!);
`;

export const NEGATIVE_FIXTURE = `// server only — no 'use client' directive
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.URL!, process.env.ANON_KEY!);
`;
