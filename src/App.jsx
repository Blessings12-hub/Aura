import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppErrorBoundary from './components/AppErrorBoundary';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './notifications/NotificationManager';
import PresenceRoot from './context/PresenceRoot';
import AuthGate from './context/AuthGate';
import OfflineBanner from './components/OfflineBanner';
import PageSkeleton from './components/PageSkeleton';
import RequireLogin from './components/RequireLogin';
import RequireVerifiedAccount from './components/RequireVerifiedAccount';
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
const AnonymousLetters = lazy(() => import('./pages/AnonymousLetters'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));

export default function App() {
  const protectedElement = (element) => <RequireLogin>{element}</RequireLogin>;
  // TIGHTENED, per explicit request: verification now gates the whole app,
  // not just Match Finder. verifiedElement is used for every activity;
  // Account Settings and Admin Reports stay on the plain protectedElement
  // (login only) deliberately — an account stuck pending/declined still
  // needs to reach Settings to do anything about it (link a Google account,
  // delete the account), and an admin reviewing everyone else's requests
  // shouldn't be locked out of that screen by their own verification
  // status. Both pages' own Firestore reads are still governed by
  // firestore.rules regardless (isAdmin() for the reports queue, isOwner()
  // for settings), so this isn't loosening any actual data access.
  const verifiedElement = (element) => <RequireVerifiedAccount>{element}</RequireVerifiedAccount>;

  return (
    <AppErrorBoundary>
      <ThemeProvider>
      <NotificationProvider>
        <AuthGate>
          <PresenceRoot>
            <OfflineBanner />
            <BrowserRouter>
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                  <Route path="/" element={<Login />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/aura" element={verifiedElement(<Home />)} />
                  <Route path="/aura/chat" element={verifiedElement(<MoodChat />)} />
                  <Route path="/aura/match" element={verifiedElement(<MatchFinder />)} />
                  <Route path="/aura/match/chat/:matchId" element={verifiedElement(<MatchChat />)} />
                  <Route path="/aura/match/call/:matchId" element={verifiedElement(<MatchCall />)} />
                  <Route path="/aura/question" element={verifiedElement(<DailyQuestion />)} />
                  <Route path="/aura/swap" element={verifiedElement(<SkillSwap />)} />
                  <Route path="/aura/swap/chat/:swapId" element={verifiedElement(<SkillSwapChat />)} />
                  <Route path="/aura/swap/call/:swapId" element={verifiedElement(<SkillSwapCall />)} />
                  <Route path="/aura/event" element={verifiedElement(<EventBuddy />)} />
                  <Route path="/aura/event/chat/:eventId" element={verifiedElement(<EventChat />)} />
                  <Route path="/aura/letters" element={verifiedElement(<AnonymousLetters />)} />
                  <Route path="/aura/admin/reports" element={protectedElement(<AdminReports />)} />
                  <Route path="/aura/settings" element={protectedElement(<AccountSettings />)} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </PresenceRoot>
        </AuthGate>
      </NotificationProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
