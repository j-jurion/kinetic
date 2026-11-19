import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, IconButton, TextField } from '@mui/material'
import { api } from '../lib/api'
import type { RaceResult } from '../lib/types'
import { Icon } from './icons'
import { useNotify } from './Notify'

function formatTimeInput(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function parseTimeInput(text: string): number | null {
  const value = text.trim()
  if (!value) return null
  const parts = value.split(':').map(Number)
  if (parts.some((p) => Number.isNaN(p))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

const isValidSplitTime = (value: string) => /^\d+:[0-5]\d$/.test(value.trim())

interface SplitRow {
  key: number
  label: string
  time: string
  rank: string
}

const DEFAULT_SPLITS: Record<string, string[]> = {
  triathlon: ['Swim', 'T1', 'Bike', 'T2', 'Run'],
  duathlon: ['Run 1', 'T1', 'Bike', 'T2', 'Run 2'],
}

interface Props {
  open: boolean
  activityId: number
  sport: string
  existing: RaceResult | null
  onClose: () => void
  onSaved: () => void
}

/** Enter the official result, rankings and splits of a race. */
export function RaceResultDialog({ open, activityId, sport, existing, onClose, onSaved }: Props) {
  const notify = useNotify()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [splits, setSplits] = useState<SplitRow[]>([])

  useEffect(() => {
    if (!open) return
    const rr = existing
    const num = (v: number | null | undefined) => (v == null ? '' : String(v))
    setFields({
      official: formatTimeInput(rr?.official_time_seconds),
      bib: rr?.bib_number ?? '',
      ageGroup: rr?.age_group ?? '',
      overallRank: num(rr?.overall_rank),
      overallTotal: num(rr?.overall_total),
      genderRank: num(rr?.gender_rank),
      genderTotal: num(rr?.gender_total),
      agRank: num(rr?.age_group_rank),
      agTotal: num(rr?.age_group_total),
      url: rr?.results_url ?? '',
      notes: rr?.notes ?? '',
    })
    setSplits(
      rr?.splits.length
        ? rr.splits.map((s, i) => ({
            key: i,
            label: s.label,
            time: formatTimeInput(s.duration_seconds),
            rank: s.rank ? String(s.rank) : '',
          }))
        : (DEFAULT_SPLITS[sport] ?? []).map((label, i) => ({ key: i, label, time: '', rank: '' })),
    )
  }, [open, existing, sport])

  const set = (key: string) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }))
  const setSplit = (key: number, field: keyof SplitRow, value: string) =>
    setSplits((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const intOrNull = (v: string | undefined) => (v && v.trim() !== '' ? Math.round(Number(v)) : null)

  const save = async () => {
    const invalid = splits.find((r) => r.time.trim() && !isValidSplitTime(r.time))
    if (invalid) {
      notify(`Invalid time for ${invalid.label || 'split'}; use M:SS with seconds from 00 to 59.`, 'error')
      return
    }
    const payload = {
      official_time_seconds: parseTimeInput(fields.official ?? ''),
      bib_number: fields.bib || null,
      age_group: fields.ageGroup || null,
      overall_rank: intOrNull(fields.overallRank),
      overall_total: intOrNull(fields.overallTotal),
      gender_rank: intOrNull(fields.genderRank),
      gender_total: intOrNull(fields.genderTotal),
      age_group_rank: intOrNull(fields.agRank),
      age_group_total: intOrNull(fields.agTotal),
      results_url: fields.url || null,
      notes: fields.notes || null,
      splits: splits
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label,
          duration_seconds: parseTimeInput(r.time),
          rank: /^\d+$/.test(r.rank.trim()) ? Number(r.rank) : null,
        })),
    }
    try {
      await api.put(`/activities/${activityId}/race-result`, payload)
      onClose()
      onSaved()
    } catch (error) {
      notify(`Failed to save: ${(error as Error).message}`, 'error')
    }
  }

  const rankField = (key: string) => (
    <TextField
      type="number"
      value={fields[key] ?? ''}
      onChange={set(key)}
      sx={{ maxWidth: 80 }}
      slotProps={{ htmlInput: { min: 1, step: 1 } }}
    />
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} scroll="paper">
      <DialogContent sx={{ p: 2, width: 'min(680px, calc(100vw - 32px))', minWidth: { sm: 520 }, maxHeight: '90vh' }}>
        <div className="text-h6 q-mb-md">Race Results</div>
        <div className="row gap-3 w-full items-start">
          <TextField label="Official time" placeholder="H:MM:SS" value={fields.official ?? ''} onChange={set('official')} sx={{ flex: '1 1 150px' }} />
          <TextField label="Bib #" value={fields.bib ?? ''} onChange={set('bib')} sx={{ width: 80 }} />
          <TextField label="Age group" placeholder="M40-44" value={fields.ageGroup ?? ''} onChange={set('ageGroup')} sx={{ width: 110 }} />
        </div>

        <div className="text-caption text-grey-6 q-mt-md q-mb-xs">Rankings</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 80px 80px', columnGap: 16, rowGap: 4, alignItems: 'center', width: 'fit-content' }}>
          <span />
          <span className="text-caption text-grey-6 text-center">Rank</span>
          <span className="text-caption text-grey-6 text-center">Total</span>
          <span className="text-body2">Overall</span>
          {rankField('overallRank')}
          {rankField('overallTotal')}
          <span className="text-body2">Gender</span>
          {rankField('genderRank')}
          {rankField('genderTotal')}
          <span className="text-body2">Age group</span>
          {rankField('agRank')}
          {rankField('agTotal')}
        </div>

        <div className="text-caption text-grey-6 q-mt-md q-mb-xs">Splits</div>
        <div className="row gap-2 q-mb-xs">
          <span className="text-caption text-grey-5" style={{ width: 80 }}>Label</span>
          <span className="text-caption text-grey-5" style={{ width: 110 }}>Time (M:SS)</span>
          <span className="text-caption text-grey-5" style={{ width: 65 }}>Rank</span>
        </div>
        {splits.map((row) => {
          const invalid = !!row.time.trim() && !isValidSplitTime(row.time)
          return (
            <div key={row.key} className="row items-center no-wrap gap-2 q-mb-xs">
              <TextField size="small" value={row.label} onChange={(e) => setSplit(row.key, 'label', e.target.value)} sx={{ width: 80 }} />
              <TextField
                size="small"
                placeholder="M:SS"
                value={row.time}
                onChange={(e) => setSplit(row.key, 'time', e.target.value)}
                error={invalid}
                helperText={invalid ? 'Use M:SS with seconds from 00 to 59' : undefined}
                sx={{ width: 110 }}
              />
              <TextField size="small" value={row.rank} onChange={(e) => setSplit(row.key, 'rank', e.target.value)} sx={{ width: 65 }} />
              <IconButton size="small" onClick={() => setSplits((rows) => rows.filter((r) => r.key !== row.key))} aria-label="Remove split">
                <Icon name="close" size={14} className="text-grey-6" />
              </IconButton>
            </div>
          )
        })}
        <Button
          size="small"
          className="q-mt-xs"
          onClick={() => setSplits((rows) => [...rows, { key: Date.now(), label: '', time: '', rank: '' }])}
        >
          + Add split
        </Button>

        <TextField label="Results URL" placeholder="https://..." value={fields.url ?? ''} onChange={set('url')} fullWidth sx={{ mt: 2 }} />
        <TextField label="Notes" value={fields.notes ?? ''} onChange={set('notes')} fullWidth multiline minRows={2} sx={{ mt: 1 }} />

        <div className="row justify-end gap-2 q-mt-md">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
