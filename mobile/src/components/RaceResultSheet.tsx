// Enter the official result, rankings and splits of a race: the mobile version of the web dialog,
// with the same form logic (packages/shared/src/forms.ts).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { invalidTime, raceForm, racePayload } from '@kinetic/shared/forms'
import type { RaceFields, SplitRow } from '@kinetic/shared/forms'
import { TIME_RULE } from '@kinetic/shared/time'
import type { RaceResult } from '@kinetic/shared/types'
import { api } from '../lib/api'
import { useNotify } from './Notify'
import { Button, Field, FormSheet, IconButton, T } from './ui'

export function RaceResultSheet({ visible, activityId, sport, existing, onClose, onSaved }: {
  visible: boolean
  activityId: number
  sport: string
  existing: RaceResult | null
  onClose: () => void
  onSaved: () => void
}) {
  const notify = useNotify()
  const [fields, setFields] = useState<RaceFields>(() => raceForm(null, sport).fields)
  const [splits, setSplits] = useState<SplitRow[]>([])

  useEffect(() => {
    if (!visible) return
    const form = raceForm(existing, sport)
    setFields(form.fields)
    setSplits(form.splits)
  }, [visible, existing, sport])

  const set = (key: keyof RaceFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }))
  const setSplit = (key: number, field: keyof SplitRow, value: string) =>
    setSplits((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)))

  const save = async () => {
    const result = racePayload(fields, splits)
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

  const rank = (label: string, rankKey: keyof RaceFields, totalKey: keyof RaceFields) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      <T style={{ width: 80, paddingBottom: 12 }}>{label}</T>
      <Field label="Rank" keyboardType="number-pad" value={fields[rankKey]} onChangeText={set(rankKey)} style={{ flex: 1 }} />
      <Field label="Total" keyboardType="number-pad" value={fields[totalKey]} onChangeText={set(totalKey)} style={{ flex: 1 }} />
    </View>
  )

  return (
    <FormSheet visible={visible} title="Race result" onClose={onClose} onSave={save}>
      <Field label="Official time" placeholder="H:MM:SS" value={fields.official} onChangeText={set('official')} error={invalidTime(fields.official) && TIME_RULE} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field label="Bib #" value={fields.bib} onChangeText={set('bib')} style={{ flex: 1 }} />
        <Field label="Age group" placeholder="M40-44" value={fields.ageGroup} onChangeText={set('ageGroup')} style={{ flex: 1 }} />
      </View>

      <T muted style={{ fontWeight: '600', marginTop: 4 }}>Rankings</T>
      {rank('Overall', 'overallRank', 'overallTotal')}
      {rank('Gender', 'genderRank', 'genderTotal')}
      {rank('Age group', 'agRank', 'agTotal')}

      <T muted style={{ fontWeight: '600', marginTop: 4 }}>Splits</T>
      {splits.map((row) => (
        <View key={row.key} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <Field label="Label" value={row.label} onChangeText={(v) => setSplit(row.key, 'label', v)} style={{ flex: 1.2 }} />
          <Field
            label="Time"
            placeholder="M:SS"
            value={row.time}
            onChangeText={(v) => setSplit(row.key, 'time', v)}
            error={invalidTime(row.time) && 'M:SS or H:MM:SS'}
            style={{ flex: 1.2 }}
          />
          <Field label="Rank" keyboardType="number-pad" value={row.rank} onChangeText={(v) => setSplit(row.key, 'rank', v)} style={{ flex: 0.8 }} />
          <IconButton
            icon="close"
            onPress={() => setSplits((rows) => rows.filter((r) => r.key !== row.key))}
            label={`Remove split ${row.label || ''}`.trim()}
          />
        </View>
      ))}
      <Button title="Add split" icon="add" variant="text" onPress={() => setSplits((rows) => [...rows, { key: Date.now(), label: '', time: '', rank: '' }])} />

      <Field label="Results URL" placeholder="https://..." autoCapitalize="none" keyboardType="url" value={fields.url} onChangeText={set('url')} />
      <Field label="Notes" value={fields.notes} onChangeText={set('notes')} multiline />
    </FormSheet>
  )
}
