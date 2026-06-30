export const DAILY_QUESTIONS = [
  'What is one thing that made you smile today?',
  'What would you tell your younger self?',
  'What is a small goal you want to achieve this week?',
  'What is your comfort food and why?',
  'What is a place you want to visit one day?',
  'How are you feeling today?',
  'What are you grateful for today?',
  'What is your top priority today?',
  'What is distracting you the most?',
  'How much water have you had today?',
  'What is your biggest challenge while learning?',
  'Who made your day better today?',
  'Have you checked on someone today?',
  'Who would you like to reconnect with?',
  'What is one thing you are proud of today?',
  'How close are you to your goals?',
  'What is your favourite song today?',
  'What recommendation would you give someone today?',
  'What could you have done better?',
  'If you could relive one moment today, what would it be?',
  'How would you rate your day out of 10?',
  'What is one unpopular opinion you have?',
  'What have you been consistently improving?',
];

/** Returns YYYY-MM-DD in the user's local timezone. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Stable question for a given day so everyone sees the same prompt. */
export function questionForDate(date = new Date()) {
  const dayOfYear = Math.floor(
    (date - new Date(date.getFullYear(), 0, 0)) / 86_400_000,
  );
  return DAILY_QUESTIONS[dayOfYear % DAILY_QUESTIONS.length];
}