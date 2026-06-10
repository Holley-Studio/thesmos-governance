---
id: seo-audit
name: SEO Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - seo
  - meta
  - performance
  - structured-data
enabled: true
---

# SEO Audit

## Purpose

Audits pages for SEO completeness: title tags, meta descriptions, canonical URLs, Open Graph tags, structured data (JSON-LD), Core Web Vitals, and crawlability via robots.txt and sitemap.

## When to use

- Before launching a new public page
- After a URL structure change
- When organic search traffic drops
- Pre-launch SEO reviews

## Required inputs

- Page component files (`app/**/page.tsx`)
- `app/layout.tsx` for root metadata
- `app/sitemap.ts` and `app/robots.ts`

## Workflow steps

1. Audit each page file for `export const metadata` completeness
2. Check title uniqueness across pages
3. Verify canonical links for pages with potential duplicate content
4. Validate JSON-LD structured data format
5. Check Open Graph image dimensions (1200×630 recommended)
6. Verify pages are included in the sitemap and not blocked by robots.txt

## Prometheus commands

```bash
npm run prometheus:scan
```

## Expected output

A page-by-page SEO assessment with missing fields, duplicate titles, invalid structured data, and prioritised fixes (critical / important / nice-to-have) ordered by estimated traffic impact.

## Related agents

- seo-reviewer
- performance-reviewer

## Related rule packs

- @prometheus/core
