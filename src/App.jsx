import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './notifications/NotificationManager';
import PresenceRoot from './context/PresenceRoot';
import AuthGate from './context/AuthGate';
import OfflineBanner from './components/OfflineBanner';
import PageSkeleton from './components/PageSkeleton';
// Login and Home stay as regular (non-lazy) imports — they're the two
// screens almost every visit starts on, so there's nothing to gain from
// splitting them out; it would just add a network round-trip to the very
// first thing anyone sees.
import Login from './pages/Login';
import Home from './pages/Home';

// Everything else loads on demand. Previously every page in the app —
// all 6 activities, every chat/call screen, and the admin panel — was
// bundled into the one JS file shipped on first load, so a person who
// only ever opens Mood Chat was still downloading Collab Studio's canvas
// code and the admin reports screen. React.lazy() + route-based Suspense
// means each route's code is only fetched the first time someone actually
// navigates to it.
const MoodChat = lazy(() => import('./pages/MoodChat'));
const MatchFinder = lazy(() => import('./pages/MatchFinder'));
const MatchChat = lazy(() => import('./pages/MatchChat'));
const MatchCall = lazy(() => import('./pages/MatchCall'));
const DailyQuestion = lazy(() => import('./pages/DailyQuestion'));
const SkillSwap = lazy(() => import('./pages/SkillSwap'));
const SkillSwapChat = lazy(() => import('./pages/SkillSwapChat'));
const SkillSwapCall = lazy(() => import('./pages/SkillSwapCall'));
const EventBuddy = lazy(() => import('./pages/EventBuddy'));
const EventChat = lazy(() => import('./pages/EventChat'));
const CollabStudio = lazy(() => import('./pages/CollabStudio'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <AuthGate>
          <PresenceRoot>
            <OfflineBanner />
            <BrowserRouter>
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                  <Route path="/" element={<Login />} />
                  <Route path="/aura" element={<Home />} />
                  <Route path="/aura/chat" element={<MoodChat />} />
                  <Route path="/aura/match" element={<MatchFinder />} />
                  <Route path="/aura/match/chat/:matchId" element={<MatchChat />} />
                  <Route path="/aura/match/call/:matchId" element={<MatchCall />} />
                  <Route path="/aura/question" element={<DailyQuestion />} />
                  <Route path="/aura/swap" element={<SkillSwap />} />
                  <Route path="/aura/swap/chat/:swapId" element={<SkillSwapChat />} />
                  <Route path="/aura/swap/call/:swapId" element={<SkillSwapCall />} />
                  <Route path="/aura/event" element={<EventBuddy />} />
                  <Route path="/aura/event/chat/:eventId" element={<EventChat />} />
                  <Route path="/aura/collab" element={<CollabStudio />} />
                  <Route path="/aura/admin/reports" element={<AdminReports />} />
                  <Route path="/aura/settings" element={<AccountSettings />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </PresenceRoot>
        </AuthGate>
      </NotificationProvider>
    </ThemeProvider>
  );
}