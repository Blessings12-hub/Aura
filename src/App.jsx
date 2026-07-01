import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './notifications/NotificationManager';
import Login from './pages/Login';
import Home from './pages/Home';
import MoodChat from './pages/MoodChat';
import MatchFinder from './pages/MatchFinder';
import MatchChat from './pages/MatchChat';
import DailyQuestion from './pages/DailyQuestion';
import SkillSwap from './pages/SkillSwap';
import SkillSwapChat from './pages/SkillSwapChat';
import SkillSwapCall from './pages/SkillSwapCall';
import EventBuddy from './pages/EventBuddy';
import EventChat from './pages/EventChat';
import CollabStudio from './pages/CollabStudio';

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <BrowserRouter>
          <Routes>
            <Route path=\"/\" element={<Login />} />
            <Route path=\"/aura\" element={<Home />} />
            <Route path=\"/aura/chat\" element={<MoodChat />} />
            <Route path=\"/aura/match\" element={<MatchFinder />} />
            <Route path=\"/aura/match/chat/:matchId\" element={<MatchChat />} />
            <Route path=\"/aura/question\" element={<DailyQuestion />} />
            <Route path=\"/aura/swap\" element={<SkillSwap />} />
            <Route path=\"/aura/swap/chat/:swapId\" element={<SkillSwapChat />} />
            <Route path=\"/aura/swap/call/:swapId\" element={<SkillSwapCall />} />
            <Route path=\"/aura/event\" element={<EventBuddy />} />
            <Route path=\"/aura/event/chat/:eventId\" element={<EventChat />} />
            <Route path=\"/aura/collab\" element={<CollabStudio />} />
          </Routes>
        </BrowserRouter>
      </NotificationProvider>
    </ThemeProvider>
  );
}