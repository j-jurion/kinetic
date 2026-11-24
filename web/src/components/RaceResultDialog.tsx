import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, IconButton, TextField } from '@mui/material'
import { api } from '../lib/api'
import { TIME_RULE, isValidTime } from '@kinetic/shared/time'
import { invalidTime, raceForm, racePayload } from '@kinetic/shared/forms'
import type { SplitRow } from '@kinetic/shared/forms'
import type { RaceResult } from '@kinetic/shared/types'
import { Icon } from './icons'
import { useNotify } from './Notify'


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
    const form = raceForm(existing, sport)
    setFields(form.fields)
    setSplits(form.splits)
  }, [open, existing, sport])

  const set = (key: string) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }))
  const setSplit = (key: number, field: keyof SplitRow, value: string) =>
    setSplits((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const officialInvalid = invalidTime(fields.official)

  const save = async () => {
    const result = racePayload(fields as Parameters<typeof racePayload>[0], splits)
    if ('error' in result) {
      notify(result.error, 'error')
      return
    }
    try {
      await api.put(`/activities/${activityId}/race-result`, result.payload)
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
          <TextField
            label="Official time"
            placeholder="H:MM:SS"
            value={fields.official ?? ''}
            onChange={set('official')}
            error={officialInvalid}
            helperText={officialInvalid ? TIME_RULE : undefined}
            sx={{ flex: '1 1 150px' }}
          />
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
          <span className="text-caption text-grey-5" style={{ width: 120 }}>Time</span>
          <span className="text-caption text-grey-5" style={{ width: 65 }}>Rank</span>
        </div>
        {splits.map((row) => {
          const invalid = !!row.time.trim() && !isValidTime(row.time)
          return (
            <div key={row.key} className="row items-center no-wrap gap-2 q-mb-xs">
              <TextField size="small" value={row.label} onChange={(e) => setSplit(row.key, 'label', e.target.value)} sx={{ width: 80 }} />
              <TextField
                size="small"
                placeholder="M:SS"
                value={row.time}
                onChange={(e) => setSplit(row.key, 'time', e.target.value)}
                error={invalid}
                helperText={invalid ? 'M:SS or H:MM:SS' : undefined}
                sx={{ width: 120 }}
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
          <Button color="inherit" onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
