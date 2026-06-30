import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import Login from './pages/Login';
import Home from './pages/Home';
import MoodChat from './pages/MoodChat';
import MatchFinder from './pages/MatchFinder';
import MatchChat from './pages/MatchChat';
import DailyQuestion from './pages/DailyQuestion';
import SkillSwap from './pages/SkillSwap';
import SkillSwapCall from './pages/SkillSwapCall';
import EventBuddy from './pages/EventBuddy';
import CollabStudio from './pages/CollabStudio';
import NotificationManager from './notifications/NotificationManager';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <NotificationManager />
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/aura" element={<Home />} />
          <Route path="/aura/chat" element={<MoodChat />} />
          <Route path="/aura/match" element={<MatchFinder />} />
          <Route path="/aura/match/chat" element={<MatchChat />} />
          <Route path="/aura/question" element={<DailyQuestion />} />
          <Route path="/aura/swap" element={<SkillSwap />} />
          <Route path="/aura/swap/call" element={<SkillSwapCall />} />
          <Route path="/aura/event" element={<EventBuddy />} />
          <Route path="/aura/collab" element={<CollabStudio />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}