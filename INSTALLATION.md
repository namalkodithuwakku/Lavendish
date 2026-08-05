# Lavendish Yield Cron Fix

This package fixes the `401 Cron authorization required` problem, corrects the
manual Master Admin API role check, allows the complete ten-hotel baseline
enough execution time, and adds a daily Vercel Cron check.

## Changed files

1. Replace:

   `app/api/yield/check/route.ts`

   with:

   `Lavendish_Yield_Cron_Fix/app/api/yield/check/route.ts`

2. Replace:

   `app/admin/yield/yield-client.tsx`

   with:

   `Lavendish_Yield_Cron_Fix/app/admin/yield/yield-client.tsx`

3. Add:

   `app/admin/yield/failure-details.css`

   from:

   `Lavendish_Yield_Cron_Fix/app/admin/yield/failure-details.css`

4. Copy this file to the project root:

   `Lavendish_Yield_Cron_Fix/vercel.json`

The schedule runs at `00:30 UTC`, which is `6:00 AM` in Sri Lanka.

## Vercel environment variables

Keep these Production environment variables:

- `CRON_SECRET`
- `SUPABASE_SECRET_KEY`
- `OCCUPANCY_SCRIPT_URL`
- `OCCUPANCY_API_TOKEN`

`YIELD_CRON_SECRET` is optional. The corrected route accepts either
`CRON_SECRET` or `YIELD_CRON_SECRET` independently.

Do not put the actual secret value in GitHub or in `vercel.json`.

## Git commands

From the Lavendish project folder:

```powershell
git add app/api/yield/check/route.ts app/admin/yield/yield-client.tsx app/admin/yield/failure-details.css vercel.json
git commit -m "Make yield occupancy checks reliable"
git push
```

## Test after Vercel deployment

### Manual Master Admin test

1. Sign in as Master Admin.
2. Open `/admin/yield`.
3. Select **Run occupancy check now**.
4. The first successful check may report baselines but no new alerts.

### Authorized cron test in PowerShell

Use the same value stored as `CRON_SECRET` in Vercel:

```powershell
$yieldSecret = "PASTE_YOUR_CRON_SECRET_HERE"

Invoke-RestMethod `
  -Uri "https://YOUR-REAL-VERCEL-DOMAIN.vercel.app/api/yield/check" `
  -Method Get `
  -Headers @{ Authorization = "Bearer $yieldSecret" }
```

A successful response includes:

- `success: true`
- `checkedDates`
- `updatedSnapshots`
- `baselines`
- `createdAlerts`
- `failures`

## Important behavior

The first successful check creates occupancy baselines. A later check creates:

- `RATE_UPDATE` when occupancy changes into another rate/threshold band.
- `OTA_CLOSURE` when available rooms change from above zero to zero.
- `OTA_REOPEN` when a previously full date becomes available again.

This fix does not change or write to the hotel Google Sheets.
