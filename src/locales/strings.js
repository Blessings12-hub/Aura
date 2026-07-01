// Comprehensive English strings — keys mirror what the UI needs.
// Other locales are loaded dynamically and missing strings are auto-translated
// at runtime via the backend Gemini translation proxy.
export default {
  app_name: 'Aura',
  app_tagline: 'A mood-based social app for anonymous chat, matching, and shared activities.',
  app_description: 'Six daily activities. Anonymous. Resets every 24 hours.',

  // Auth / login
  welcome_back: 'Welcome to Aura',
  enter_anonymously: 'Enter Aura anonymously',
  log_in: 'Log in',
  sign_up: 'Sign up',
  age: 'Your age',
  gender: 'Gender',
  select_gender: 'Select gender',
  female: 'Female',
  male: 'Male',
  non_binary: 'Non-binary',
  prefer_not: 'Prefer not to say',
  pick_color: 'Pick your colour',
  age_placeholder: 'e.g. 23',
  age_error: 'You must be 16 or older to join Aura.',
  fill_required: 'Please enter your age and choose a gender.',
  signin_failed: 'Could not sign you in. Please try again.',
  entering: 'Entering…',
  privacy_note: 'No email, no phone, no name. Just presence — and only what you choose to share.',

  // Common
  back: 'Back',
  send: 'Send',
  cancel: 'Cancel',
  accept: 'Accept',
  decline: 'Decline',
  start: 'Start',
  open: 'Open',
  close: 'Close',
  post: 'Post',
  clear: 'Clear',
  reset: 'Reset',
  loading: 'Loading…',
  dark_mode: 'Dark mode',
  light_mode: 'Light mode',
  notifications: 'Notifications',
  enable_notifications: 'Enable notifications',
  notifications_enabled: 'Notifications enabled',
  online_now: 'online now',

  // Home
  six_activities: 'Six daily activities. Anonymous. Resets every 24 hours.',
  privacy_footer: 'Everything disappears after 24 hours. No profiles, no history, just presence.',

  // Activities (titles + descriptions)
  mood_chat: 'Mood Chat',
  mood_chat_desc: 'Anonymous group chat for people feeling the same mood right now.',
  match_finder: 'Match Finder',
  match_finder_desc: 'Anonymous pairing — match first, profiles unlock after both agree.',
  daily_question: 'Daily Question',
  daily_question_desc: 'A short prompt each day. Share an answer and read anonymous replies.',
  skill_swap: 'Skill Swap',
  skill_swap_desc: 'Teach a skill, learn a skill. Chat first, video only if both accept.',
  event_buddy: 'Event Buddy',
  event_buddy_desc: 'Find someone to join an event with — concerts, dinners, walks.',
  collab_studio: 'Collab Studio',
  collab_studio_desc: 'Draw together on a live canvas. See each other’s cursors in real-time.',

  // Mood Chat
  feeling_now: 'How are you feeling right now?',
  pick_a_mood: 'Pick a mood to enter the room',
  change_mood: 'Change mood',
  type_message: 'Type an anonymous message…',
  no_messages: 'No messages yet. Be the first to say hi.',
  recording: 'Recording…',
  voice_note: 'Voice note',
  send_voice_note: 'Send voice note',

  // Match Finder
  match_create_card: 'Create your card',
  bio: 'Short bio',
  hobbies: 'Hobbies, separated by commas',
  looking_for: 'What you’re looking for',
  post_card: 'Post card',
  available_matches: 'People to match with',
  request_match: 'Request match',
  match_pending: 'Match requested — waiting for them',
  match_accepted: 'Matched! Profiles are now visible.',
  reveal_profile: 'Reveal profile',
  start_chat: 'Start chat',
  anonymous_profile: 'Anonymous • profile locked until matched',

  // Daily question
  write_answer: 'Write an anonymous answer…',
  submit_answer: 'Submit answer',

  // Skill Swap
  i_can_teach: 'I can teach… (Python, guitar, cooking)',
  i_want_to_learn: 'I want to learn… (Spanish, drawing, marketing)',
  post_swap: 'Post swap',
  available_swaps: 'Available swaps',
  request_swap: 'Request swap',
  swap_pending: 'Pending — waiting for them to accept',
  swap_accepted: 'Swap accepted — open chat',
  open_chat: 'Open chat',
  request_video: 'Request video call',
  video_pending: 'Video call requested — waiting for them',
  start_video: 'Start video',
  end_call: 'End call',

  // Event buddy
  event_name: 'Event name (concert, dinner, movie…)',
  event_date: 'Date',
  event_time: 'Time',
  event_location: 'Location',
  event_location_ph: 'e.g. Central Park, the coffee shop downtown',
  post_event: 'Post event',
  available_events: 'Available events',
  join_event: 'Join event',
  join_pending: 'Request sent',
  join_accepted: 'You’re going — open chat',

  // Collab
  canvas_clear: 'Clear canvas',
  canvas_undo: 'Undo my last stroke',
  canvas_color: 'Colour',
  canvas_size: 'Size',
  canvas_invite: 'Invite a friend to draw',
  canvas_strokes: '{{n}} strokes on the board',

  // Errors / empty
  empty_no_messages: 'No messages yet. Say hi to get started.',
  empty_no_matches: 'No one’s here yet — post a card to be first.',
  empty_no_swaps: 'No swaps yet. Be the first to post.',
  empty_no_events: 'No events yet. Create one.',
};