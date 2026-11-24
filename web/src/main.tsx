import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './index.css'
import { AppThemeProvider } from './theme'
import { NotifyProvider } from './components/Notify'
import { BackgroundJobsProvider } from './lib/backgroundJobs'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './pages/Login'
import { ActivitiesPage } from './pages/Activities'
import { ActivityDetailPage } from './pages/ActivityDetail'
import { RacesPage } from './pages/Races'
import { MapPage } from './pages/Map'
import { BestEffortsPage } from './pages/BestEfforts'
import { TopActivitiesPage } from './pages/TopActivities'
import { FriendsPage } from './pages/Friends'
import { FriendDetailPage } from './pages/FriendDetail'
import { SyncPage } from './pages/Sync'
import { PageLoading } from './components/PageLoading'

// The dashboard and chart pages pull in Plotly (several MB), so they load on first visit only
const GraphsPage = lazy(() => import('./pages/Graphs').then((m) => ({ default: m.GraphsPage })))
const DashboardPage = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })))
const TrainingPage = lazy(() => import('./pages/Training').then((m) => ({ default: m.TrainingPage })))
const BestEffortDistancePage = lazy(() =>
  import('./pages/BestEffortDistance').then((m) => ({ default: m.BestEffortDistancePage })),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppThemeProvider>
      <NotifyProvider>
        <BackgroundJobsProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage mode="login" />} />
              <Route path="/register" element={<LoginPage mode="register" />} />
              <Route element={<RequireAuth><Layout /></RequireAuth>}>
                <Route path="/" element={<Suspense fallback={<PageLoading />}><DashboardPage /></Suspense>} />
                <Route path="/activities" element={<ActivitiesPage />} />
                <Route path="/activity/:id" element={<ActivityDetailPage />} />
                <Route path="/races" element={<RacesPage />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/graphs" element={<Suspense fallback={<PageLoading />}><GraphsPage /></Suspense>} />
                <Route path="/training" element={<Suspense fallback={<PageLoading />}><TrainingPage /></Suspense>} />
                <Route path="/best-efforts" element={<BestEffortsPage />} />
                <Route path="/best-efforts/top/:metric" element={<TopActivitiesPage />} />
                <Route path="/best-efforts/:distance" element={<Suspense fallback={<PageLoading />}><BestEffortDistancePage /></Suspense>} />
                <Route path="/friends" element={<FriendsPage />} />
                <Route path="/friends/:id" element={<FriendDetailPage />} />
                <Route path="/sync" element={<SyncPage />} />
                <Route path="*" element={<div className="text-grey-6 q-mt-xl">Page not found.</div>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </BackgroundJobsProvider>
      </NotifyProvider>
    </AppThemeProvider>
  </StrictMode>,
)
