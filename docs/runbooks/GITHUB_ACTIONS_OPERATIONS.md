# GitHub Actions Operations Runbook

This repo protects `main` with four required checks:

- `Typecheck`
- `Runtime smoke`
- `Build`
- `Tier B vs preview URL`

The expected path is:

```text
branch -> PR -> required checks -> squash merge -> Convex deploy -> Vercel prod -> smoke verify
```

## Required Gates

`CI` owns the first three required checks:

- `Typecheck`: Convex codegen, app typecheck, Convex typecheck.
- `Runtime smoke`: focused Vitest coverage for server parsing, agent harness,
  capture routing, workspace persistence, event memory, and search route.
- `Build`: production Vite build after the first two gates pass.

`Tier B regression (preview)` owns the preview smoke:

- It runs Playwright against the Vercel preview when a preview exists.
- It skips green for docs-only or otherwise non-servable PRs.
- If the latest SHA is Vercel-ignored but an earlier ready preview exists for
  the same branch, it tests that ready preview instead of waiting forever.

## Manual Recovery

If a PR shows "required checks expected" but no runs attach:

1. Confirm workflows are active.

```powershell
gh workflow list --repo HomenShum/nodebench-ai --all
```

2. Inspect branch runs.

```powershell
gh run list --repo HomenShum/nodebench-ai --branch <branch> --limit 20
gh pr checks <pr> --repo HomenShum/nodebench-ai
```

3. Dispatch CI if the account can run workflow dispatch.

```powershell
gh workflow run ci.yml --repo HomenShum/nodebench-ai --ref <branch> -f reason="rerun required gates"
```

4. Dispatch Tier B with a known preview URL when Vercel already produced one.

```powershell
gh workflow run tier-b-preview.yml --repo HomenShum/nodebench-ai --ref <branch> `
  -f pr_number=<pr> `
  -f head_ref=<branch> `
  -f head_sha=<sha> `
  -f preview_url=https://<preview>.vercel.app
```

5. If GitHub Actions cannot be dispatched from the current account, do not
   silently bypass branch protection. Run local gates, get explicit approval, then
   temporarily clear only `required_status_checks`, merge, and immediately restore
   the exact four checks.

Capture current required checks:

```powershell
gh api repos/HomenShum/nodebench-ai/branches/main/protection/required_status_checks
```

Clear checks only after explicit approval:

```powershell
@'
{"strict":true,"contexts":[],"checks":[]}
'@ | Set-Content -Encoding utf8 .tmp/required-status-checks-empty.json

gh api repos/HomenShum/nodebench-ai/branches/main/protection/required_status_checks `
  --method PATCH `
  --input .tmp/required-status-checks-empty.json
```

Restore immediately:

```powershell
@'
{
  "strict": true,
  "checks": [
    {"context":"Typecheck","app_id":15368},
    {"context":"Runtime smoke","app_id":15368},
    {"context":"Build","app_id":15368},
    {"context":"Tier B vs preview URL","app_id":15368}
  ]
}
'@ | Set-Content -Encoding utf8 .tmp/required-status-checks-restore.json

gh api repos/HomenShum/nodebench-ai/branches/main/protection/required_status_checks `
  --method PATCH `
  --input .tmp/required-status-checks-restore.json

gh api repos/HomenShum/nodebench-ai/branches/main/protection/required_status_checks
```

## Release Checklist

Before merge:

```powershell
npx tsc -p convex --noEmit --pretty false
npx tsc --noEmit --pretty false
npm run build
```

After merge:

```powershell
git fetch origin main
npm run deploy:convex
```

Verify production:

```powershell
node -e "fetch('https://www.nodebenchai.com/?surface=reports').then(r=>console.log(r.status,r.headers.get('x-vercel-id')))"
node -e "fetch('https://nodebench-mcp-unified.onrender.com/health').then(r=>r.json()).then(j=>console.log(j.status,j.tools,j.anonymousProfiles))"
```

For public MCP profile verification:

```powershell
node -e "fetch('https://nodebench-mcp-unified.onrender.com?profile=gmail-research',{method:'POST',headers:{'content-type':'application/json','x-nodebench-client':'release-verify','x-nodebench-client-id':'release-verify'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(async r=>console.log(r.status,r.headers.get('x-nodebench-auth-mode'),r.headers.get('x-nodebench-account-key'),(await r.json()).result.tools.length))"
```
