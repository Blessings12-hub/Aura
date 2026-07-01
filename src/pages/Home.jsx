import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Heart, HelpCircle, Repeat, CalendarHeart, Brush, ArrowRight } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

const ACTIVITY_ICONS = {
  'mood-chat': MessageCircle,
  'match-finder': Heart,
  'daily-question': HelpCircle,
  'skill-swap': Repeat,
  'event-buddy': CalendarHeart,
  'collab-studio': Brush,
};

const ACTIVITY_TINTS = {
  'mood-chat': 'rgba(99, 102, 241, 0.25)',
  'match-finder': 'rgba(236, 72, 153, 0.25)',
  'daily-question': 'rgba(16, 185, 129, 0.25)',
  'skill-swap': 'rgba(245, 158, 11, 0.25)',
  'event-buddy': 'rgba(59, 130, 246, 0.25)',
  'collab-studio': 'rgba(168, 85, 247, 0.25)',
};

const ACTIVITY_COLORS = {
  'mood-chat': '#6366f1',
  'match-finder': '#ec4899',
  'daily-question': '#10b981',
  'skill-swap': '#f59e0b',
  'event-buddy': '#3b82f6',
  'collab-studio': '#a855f7',
};

const ACTIVITY_KEYS = [
  { id: 'mood-chat', titleKey: 'mood_chat', descKey: 'mood_chat_desc', route: '/aura/chat' },
  { id: 'match-finder', titleKey: 'match_finder', descKey: 'match_finder_desc', route: '/aura/match' },
  { id: 'daily-question', titleKey: 'daily_question', descKey: 'daily_question_desc', route: '/aura/question' },
  { id: 'skill-swap', titleKey: 'skill_swap', descKey: 'skill_swap_desc', route: '/aura/swap' },
  { id: 'event-buddy', titleKey: 'event_buddy', descKey: 'event_buddy_desc', route: '/aura/event' },
  { id: 'collab-studio', titleKey: 'collab_studio', descKey: 'collab_studio_desc', route: '/aura/collab' },
];

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading } = useCurrentUser();

  if (loading || !user) {
    return (
      <div className=\"aura-page\">
        <div className=\"aura-shell\">
          <div className=\"aura-card\">{t('loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar
          title={t('welcome_back')}
          subtitle={t('six_activities')}
        />

        <div className=\"aura-grid\">
          {ACTIVITY_KEYS.map((a, i) => {
            const Icon = ACTIVITY_ICONS[a.id];
            const tint = ACTIVITY_TINTS[a.id];
            const color = ACTIVITY_COLORS[a.id];
            return (
              <button
                key={a.id}
                type=\"button\"
                onClick={() => navigate(a.route)}
                className={`activity-card fade-in delay-${Math.min(i, 3)}`}
                data-testid={`activity-${a.id}`}
                style={{ '--card-tint': tint }}
                aria-label={`Open ${t(a.titleKey)}`}
              >
                <div className=\"activity-card__icon\" style={{ background: color }} aria-hidden=\"true\">
                  <Icon size={22} />
                </div>
                <div>
                  <h3 className=\"activity-card__title\">{t(a.titleKey)}</h3>
                  <p className=\"activity-card__desc\">{t(a.descKey)}</p>
                </div>
                <span className=\"activity-card__cta\">{t('open')} <ArrowRight size={14} /></span>
              </button>
            );
          })}
        </div>

        <div className=\"aura-banner fade-in\">{t('privacy_footer')}</div>
      </div>
    </div>
  );
}