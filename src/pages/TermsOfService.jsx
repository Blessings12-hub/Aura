// src/pages/TermsOfService.jsx
// See the comment at the top of PrivacyPolicy.jsx — same context, same
// disclaimer applies here: an accurate draft, not a substitute for legal
// review before real people rely on it.
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <h3 style={{ marginBottom: 8 }}>{title}</h3>
    <div className="aura-muted" style={{ lineHeight: 1.6 }}>{children}</div>
  </div>
);

export default function TermsOfService() {
  const navigate = useNavigate();
  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar title="Terms of Service" onBack={() => navigate(-1)} />
        <div className="aura-card aura-section fade-in" style={{ marginTop: 16 }}>
          <div
            className="aura-card"
            style={{ background: 'color-mix(in srgb, var(--primary) 8%, transparent)', marginBottom: 20 }}
            data-testid="terms-draft-notice"
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Draft — not yet reviewed by a lawyer.</p>
            <p className="aura-muted" style={{ margin: '4px 0 0' }}>
              This is a working starting point, not a finished legal document.
            </p>
          </div>

          <Section title="Who can use Aura">
            You must be at least 16 to use Aura at all, and honestly report your age. Match
            Finder additionally requires you to be 18 or older and to complete photo ID
            verification before it can be used.
          </Section>

          <Section title="The one absolute rule">
            Zero tolerance for sexual content involving, or contact directed at, anyone under
            18 — this applies everywhere in the app, including the age-tiered under-18 rooms
            in Mood Chat and Daily Question, which exist to give younger users a space
            separated from adults, not to weaken this rule. Any account involved in this is
            permanently banned and, where required by law, reported to the relevant
            authorities. This is not negotiable and not subject to appeal.
          </Section>

          <Section title="What's not allowed">
            Harassment, threats, or targeted abuse of another user. Impersonating someone
            else. Posting illegal content of any kind. Using the app to solicit money,
            advertise another service, or scam another user. Attempting to bypass age
            verification, moderation, or a block another user has placed on you.
          </Section>

          <Section title="Reporting and enforcement">
            Every activity in Aura has a way to report or block another user. Reports are
            reviewed by a human moderator. We can suspend or permanently ban an account for
            violating these terms, at our discretion, without always being able to explain
            every detail of why (to avoid teaching bad actors exactly how to evade detection
            next time).
          </Section>

          <Section title="Meeting people from the app">
            Aura connects you with strangers, including for Event Buddy, which is explicitly
            about meeting up in person. We do not run background checks on any user beyond
            the identity/age verification described in the Privacy Policy. Meeting anyone
            from the internet in person carries real risk — meet in a public place,
            tell someone else where you're going, and trust your own judgment over anything
            an app can vouch for.
          </Section>

          <Section title="Your content">
            You keep ownership of anything you write or post. By posting it, you give Aura
            the permission needed to store it, transmit it to the people it's meant to reach
            (a match, a claimed letter, a room), and moderate it — nothing broader than that,
            like using it for advertising or training external products.
          </Section>

          <Section title="No warranty">
            Aura is provided as-is, still being actively built, and can have bugs, downtime,
            or lost messages. We are not liable for the conduct of other users, or for
            anything that happens as a result of a connection made through the app, to the
            fullest extent the law allows.
          </Section>

          <Section title="Changes">
            These terms may change as the app changes. Continuing to use Aura after a change
            means you accept the updated terms.
          </Section>
        </div>
      </div>
    </div>
  );
}
