import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { parseDateRange } from '@kinetic/shared/format'
import type { ImportProgress, ImportSummary } from '@kinetic/shared/stravaImport'
import { useNotify } from '../Notify'
import { Button, Caption, Card, CardTitle, Field, Stat, StatGrid, T, useColors } from '../ui'
import { activitiesFromFiles, importStravaActivities, openStravaZip, type PickedFile } from '../../lib/stravaExport'

type Source = { kind: 'zip'; file: PickedFile } | { kind: 'files'; files: PickedFile[] }

function describe(source: Source | null): string {
  if (!source) return 'Nothing chosen yet'
  if (source.kind === 'zip') return source.file.name
  return `${source.files.length} activity file${source.files.length === 1 ? '' : 's'}`
}

/** Strava: how to get the archive, and the bulk import of it (or of loose activity files). */
export function StravaSection() {
  const notify = useNotify()
  const c = useColors()
  const [source, setSource] = useState<Source | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const pickZip = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
    })
    if (result.canceled) return
    const file = result.assets[0]
    setSource({ kind: 'zip', file: { name: file.name, uri: file.uri } })
    setSummary(null)
  }

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' })
    if (result.canceled) return
    setSource({ kind: 'files', files: result.assets.map((f) => ({ name: f.name, uri: f.uri })) })
    setSummary(null)
  }

  const runImport = async () => {
    if (!source) return
    let range
    try {
      range = parseDateRange(since, until)
    } catch (error) {
      notify((error as Error).message, 'error')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setSummary(null)
    setProgress({ fraction: 0, message: 'Reading export…' })
    let close = () => {}
    try {
      let activities
      if (source.kind === 'zip') {
        const zip = await openStravaZip(source.file.uri)
        close = zip.close
        activities = zip.activities
      } else activities = activitiesFromFiles(source.files)
      if (!activities.length) throw new Error('No .fit, .gpx or .tcx files chosen')
      const result = await importStravaActivities(activities, { range, onProgress: setProgress, signal: controller.signal })
      setSummary(result)
      notify(`Strava import complete: ${result.imported} imported`, 'success')
    } catch (error) {
      if ((error as Error).name === 'AbortError') notify('Import cancelled', 'info')
      else notify((error as Error).message, 'error', 8000)
    } finally {
      close()
      abort.current = null
      setProgress(null)
    }
  }

  const importing = progress !== null

  return (
    <>
      <Card>
        <CardTitle>Get your archive</CardTitle>
        <Caption>Strava has no sync for other apps; it sends every activity in one zip.</Caption>
        <T>1. On strava.com, open Settings → My Account → Download or Delete Your Account → Get Started.</T>
        <T>2. Under Download Request, choose Request Your Archive. Strava emails a download link, usually within a few hours.</T>
        <T>3. Download the zip to this phone (Files on iPhone, Downloads on Android) and choose it below. No need to unzip it.</T>
        <Caption>
          Each activity keeps its Strava name, type and description. Activities already in Kinetic, for instance from Garmin,
          are skipped, so you can import the archive again later.
        </Caption>
      </Card>

      <Card>
        <CardTitle>Import activities</CardTitle>
        <Caption>Only the activity files are sent, not your photos. Keep the app open until the import finishes.</Caption>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Export zip" icon="folder_zip" variant="outlined" onPress={pickZip} disabled={importing} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Activity files" icon="library_add" variant="outlined" onPress={pickFiles} disabled={importing} />
          </View>
        </View>
        <T muted numberOfLines={1} style={{ fontSize: 12 }}>
          {describe(source)} · .fit, .gpx or .tcx, gzipped or not
        </T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field label="From (dd-mm-yyyy)" placeholder="optional" value={since} onChangeText={setSince} style={{ flex: 1 }} />
          <Field label="Until (dd-mm-yyyy)" placeholder="optional" value={until} onChangeText={setUntil} style={{ flex: 1 }} />
        </View>
        <Button title={importing ? 'Importing…' : 'Import activities'} icon="download" onPress={runImport} busy={importing} disabled={!source} />
        {importing && <Button title="Cancel" variant="text" onPress={() => abort.current?.abort()} />}

        {progress && (
          <View style={{ gap: 6 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(progress.fraction * 100)}%`, height: '100%', backgroundColor: c.primary }} />
            </View>
            <T muted style={{ fontSize: 12 }}>{progress.message}</T>
          </View>
        )}

        {summary && (
          <>
            <T style={{ fontWeight: '700' }}>Import complete — {summary.found} activity files{since.trim() || until.trim() ? ' in the date range' : ''}
            </T>
            <StatGrid>
              <Stat label="Imported" value={summary.imported} color={c.positive} />
              <Stat label="Skipped" value={summary.skipped} />
              <Stat label="Errors" value={summary.errors.length} color={summary.errors.length ? c.negative : undefined} />
            </StatGrid>
            {summary.errors.slice(0, 20).map((err, i) => (
              <T key={i} style={{ color: c.negative, fontSize: 12 }}>
                • {err}
              </T>
            ))}
          </>
        )}
      </Card>
    </>
  )
}
