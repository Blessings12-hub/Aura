// src/pages/PrivacyPolicy.jsx
//
// Found during a readiness review: nothing in the app linked to a
// Privacy Policy or Terms of Service anywhere, which isn't optional for
// an app collecting age/gender/selfie/ID photos from users as young as
// 16. This is a genuine, accurate-to-the-actual-code draft — every claim
// below was checked against firestore.rules, api/*.js, and the relevant
// pages rather than written generically — but it is explicitly NOT legal
// advice and NOT a substitute for a lawyer's review before this app is
// put in front of real users, especially given the age range involved.
// See the disclaimer banner at the top of the rendered page too.
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <h3 style={{ marginBottom: 8 }}>{title}</h3>
    <div className="aura-muted" style={{ lineHeight: 1.6 }}>{children}</div>
  </div>
);

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title="Privacy Policy" onBack={() => navigate(-1)} />
        <div className="aura-card aura-section fade-in" style={{ marginTop: 16 }}>
          <div
            className="aura-card"
            style={{ background: 'color-mix(in srgb, var(--primary) 8%, transparent)', marginBottom: 20 }}
            data-testid="privacy-draft-notice"
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Draft — not yet reviewed by a lawyer.</p>
            <p className="aura-muted" style={{ margin: '4px 0 0' }}>
              This describes what the app actually does today, as accurately as we could
              write it. It has not had a legal review, which it should before real people
              rely on it.
            </p>
          </div>

          <p className="aura-muted">Last updated: this is a working draft with no fixed date yet.</p>

          <Section title="What we collect">
            To use Aura at all, we collect your age and gender. To use Match Finder (the
            18+ dating activity), we additionally collect a live selfie and a photo of a
            government ID, used once to verify your age and identity. To use push
            notifications, we store a device notification token. If you choose to link a
            Google account for account recovery, we store that link — nothing else about
            that Google account. Everything else — messages, mood chat posts, daily answers,
            skill swap and event listings, anonymous letters — is content you choose to
            write and send.
          </Section>

          <Section title="How verification photos are handled">
            Your selfie and ID photo are reviewed by a human moderator (or, if unreviewed
            after one hour, an automated fallback check) to confirm you're 18+ and that the
            selfie matches the ID. Once a decision is made, the images are deleted. As a
            backstop, anything older than 24 hours is deleted automatically regardless of
            whether a decision was made.
          </Section>

          <Section title="Who can see what">
            Other users never see your real name, email, or the ID/selfie used for
            verification — they see only the anonymous handle, mood, or card you present in
            each activity. Match Finder cards show age and the traits you choose to list, not
            your identity, unless and until you choose to share more yourself. Admins
            reviewing a report or a verification request can see what's relevant to that
            review only.
          </Section>

          <Section title="Age-tiered spaces">
            Mood Chat and Daily Question separate people under 18 from people 18 and over
            into different rooms, based on the age you provide. Match Finder is 18+ only and
            requires photo ID verification before a profile can be posted.
          </Section>

          <Section title="Moderation">
            Public-facing text (Mood Chat, Daily Question, and card bios/listings on Match
            Finder, Skill Swap, and Event Buddy) is checked for spam and abusive language
            both in the app itself and, as a backstop, on our servers. Reports of harassment
            or other violations go to a human review queue. 1:1 chats between two people who
            have already matched or been paired are not automatically scanned.
          </Section>

          <Section title="Who else sees your data">
            Aura runs on Firebase (Google) for its database, authentication, and real-time
            features, and Vercel for hosting and server-side functions — both process data on
            our behalf under their own infrastructure agreements, not as independent users of
            it. We do not use ad networks, third-party analytics, or trackers, and we do not
            sell data to anyone.
          </Section>

          <Section title="Your data, your control">
            From Account Settings, you can export a full copy of everything Aura has stored
            under your account — your profile, every message you've sent, every listing and
            letter you've written — or permanently delete all of it, including your account
            itself. Deletion removes your data from our active database; it does not
            retroactively delete a message from another person's device if they'd already
            seen it, the same way deleting a text message doesn't unsend it from the other
            phone.
          </Section>

          <Section title="Questions">
            This is a draft policy for an app still being built — there isn't yet a formal
            contact address to publish here. Add one before this goes in front of real users.
          </Section>
        </div>
      </div>
    </div>
  );
}
