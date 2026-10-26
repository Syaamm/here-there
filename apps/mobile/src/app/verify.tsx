import { useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { EmailVerifyCard } from '@/components/EmailVerifyCard';
import { PhoneVerifyCard } from '@/components/PhoneVerifyCard';
import { Banner, Between, Btn, Card, CheckRow, Chip, ErrorBanner, Pill, PillRow, Row, Screen, Txt } from '@/components/ui';
import { del, get, post, type Me } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/hooks';

type Eligibility = Me['eligibility'];
type Status = {
  eligibility: Eligibility;
  emailVerified: boolean;
  adultVerified: boolean;
  phoneVerified: boolean;
  mode: 'manual' | 'auto' | 'sandbox' | string;
  verifiedUntil: string | null;
  reverifyReason: string | null;
  lastRejectionReason: string | null;
  resumeUrl?: string;
};

const STEPS = [
  ['1', 'Agree', 'You confirm you understand and consent to the check below.'],
  ['2', 'Photograph your ID', 'A passport, national ID card or driving licence. The provider reads it and checks it is genuine.'],
  ['3', 'Take a selfie', 'A short live selfie is matched to the photo on your ID, to confirm you are the same real person.'],
  ['4', 'Get your badge', 'Once approved you get the Verified adult badge in both HERE and THERE.'],
];

const REVERIFY_TEXT: Record<string, string> = {
  expired: 'Your verification has expired. It lasts about a year, so we need a fresh check.',
  security: "For your account's security we need you to verify your identity again.",
  fraud_suspected: 'We need to confirm your identity again before you can continue.',
  provider_required: 'Our identity provider asked us to check your identity again.',
  other: 'We need you to verify your identity again.',
};
const REJECT_TEXT: Record<string, string> = {
  liveness: "The selfie check didn't pass. Try again in good light, facing the camera.",
  document: "We couldn't read your ID. Try again with a clear, uncropped photo.",
  resubmission: "We couldn't read your ID. Try again with a clear, uncropped photo.",
};

const IDENTITY_CHIP: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  verified: ['Verified', 'ok'],
  pending: ['In review', 'warn'],
  rejected: ['Not approved', 'bad'],
  expired: ['Expired', 'warn'],
  reverification_required: ['Re-check needed', 'warn'],
  unverified: ['Not started', 'neutral'],
};
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });

/**
 * Identity verification (KYC). Browsing never needs it; creating, joining, applying and chatting do.
 * It is one-time and shared by HERE and THERE: once verified you are not asked again until it expires.
 */
export default function Verify() {
  const { me, reload } = useMe();
  const router = useRouter();
  const st = useLoad(() => get<Status>('/v1/me/verification'), [], 8000);
  const [consent, setConsent] = useState(false);
  // face = ID document + live selfie matched to it (biometric); document = the ID document only, no selfie, nothing biometric
  const [method, setMethod] = useState<'face' | 'document'>('face');
  const act = useAction(() => {
    void reload();
    void st.reload();
  });

  // keep the badge in sync when the decision arrives while this screen is open
  useEffect(() => {
    if (st.data && st.data.eligibility !== me?.eligibility) void reload();
  }, [st.data?.eligibility, me?.eligibility]);

  if (st.loading && !st.data && !me) return <Screen hasHeader><SkeletonDetail /></Screen>;

  const e: Eligibility = st.data?.eligibility ?? me?.eligibility ?? 'unverified';
  const mode = st.data?.mode;
  const emailOk = me?.emailVerified ?? st.data?.emailVerified ?? false;
  const underage = e === 'rejected' && st.data?.lastRejectionReason === 'underage';
  const needsCheck = ['unverified', 'rejected', 'expired', 'reverification_required'].includes(e);
  const [chipLabel, chipTone] = IDENTITY_CHIP[e] ?? IDENTITY_CHIP.unverified;

  const start = async () => {
    const r = await act.run(() => post<{ eligibility: string; url?: string }>('/v1/me/verification', { consent: true, method }));
    // a provider returns its hosted page (ID photo + selfie with liveness): open it
    if (r?.url) void Linking.openURL(r.url);
  };

  return (
    <Screen hasHeader>
      <Txt variant="h1">Get verified</Txt>
      <Txt variant="muted">Everyone can explore. Verification keeps meetups and trips safer by making sure every person you meet is a real adult. You do it once, and it works in HERE and THERE.</Txt>

      <Card style={{ gap: 10 }}>
        <Txt variant="h3">Your statuses</Txt>
        <Between>
          <Txt>✉ Email</Txt>
          <Chip label={emailOk ? 'Confirmed' : 'Not confirmed'} tone={emailOk ? 'ok' : 'warn'} />
        </Between>
        <Between>
          <Txt>🔞 Adult (18+)</Txt>
          <Chip label={st.data?.adultVerified || me?.adultVerified ? 'Confirmed by check' : 'You declared it'} tone={st.data?.adultVerified || me?.adultVerified ? 'ok' : 'neutral'} />
        </Between>
        <Between>
          <Txt>🪪 Identity</Txt>
          <Chip label={chipLabel} tone={chipTone} />
        </Between>
        <Between>
          <Txt>📱 Mobile (optional)</Txt>
          <Chip label={st.data?.phoneVerified || me?.phoneVerified ? 'Confirmed' : 'Not added'} tone={st.data?.phoneVerified || me?.phoneVerified ? 'ok' : 'neutral'} />
        </Between>
      </Card>

      <Row style={{ alignItems: 'stretch' }}>
        <Card style={{ flex: 1 }}>
          <Chip label="Anyone" tone="neutral" />
          <Txt variant="small">✓ Browse activities and trips</Txt>
          <Txt variant="small">✓ Use the map and search</Txt>
          <Txt variant="small">✓ Read details and profiles</Txt>
          <Txt variant="small">✓ Report and block</Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Chip label="Verified ✓" tone="ok" />
          <Txt variant="small">✓ Join activities and trips</Txt>
          <Txt variant="small">✓ Host and propose</Txt>
          <Txt variant="small">✓ Group chat</Txt>
          <Txt variant="small">✓ Verified adult badge</Txt>
        </Card>
      </Row>

      <ErrorBanner message={act.error} />

      {e === 'verified' && (
        <>
          <Banner tone="ok">
            You're a verified adult in both HERE and THERE.{st.data?.verifiedUntil ? ` Valid until ${date(st.data.verifiedUntil)}. You won't be asked again before then, however many activities or trips you join.` : ''}
          </Banner>
          <Btn title="Back to exploring" onPress={() => router.back()} />
        </>
      )}

      {e === 'pending' && (
        <>
          <Banner tone="warn">Your identity check is in progress. You can keep exploring, and we'll notify you as soon as there's a decision.</Banner>
          {st.data?.resumeUrl ? <Btn title="Continue identity check" onPress={() => void Linking.openURL(st.data!.resumeUrl!)} /> : null}
          <Btn title="Check for an update" variant="secondary" loading={st.loading} onPress={() => void st.reload()} />
          {/* closed the provider page, or it got stuck: abandon this attempt and begin again */}
          <Btn title="Cancel and start over" variant="ghost" loading={act.busy} onPress={() => act.run(() => del('/v1/me/verification'))} />
        </>
      )}

      {needsCheck && underage && (
        <Banner tone="bad">
          This account couldn't be verified: This app is for adults aged 18 and over. If you think this is a mistake, please contact support and a member of our team will review it.
        </Banner>
      )}

      {needsCheck && !underage && (
        <>
          {(e === 'expired' || e === 'reverification_required') && <Banner tone="warn">{REVERIFY_TEXT[st.data?.reverifyReason ?? me?.reverifyReason ?? (e === 'expired' ? 'expired' : 'other')] ?? REVERIFY_TEXT.other}</Banner>}
          {e === 'rejected' && <Banner tone="bad">{REJECT_TEXT[st.data?.lastRejectionReason ?? ''] ?? "We couldn't verify you last time. You can try again."}</Banner>}
          {e === 'rejected' && <Btn title="I think this was a mistake: ask for a review" variant="secondary" onPress={() => router.push('/appeal?kind=verification' as never)} />}

          {/* spec 3.1: the email address is confirmed before the identity check */}
          {!emailOk && (
            <>
              <Banner tone="warn">Step 1: confirm your email. Then you can start the identity check.</Banner>
              <EmailVerifyCard />
            </>
          )}

          <Txt variant="h2">How it works</Txt>
          {STEPS.map(([n, t, d]) => (
            <Row key={n} style={{ alignItems: 'flex-start' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#102F29', alignItems: 'center', justifyContent: 'center' }}>
                <Txt color="#fff" bold>{n}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{t}</Txt>
                <Txt variant="small">{d}</Txt>
              </View>
            </Row>
          ))}

          <Card>
            <Txt variant="h3">🔒 Your data</Txt>
            <Txt variant="small">• A specialist identity provider does the check, not us and not other users.</Txt>
            <Txt variant="small">• We keep only the result (verified or not), a reference number and the time you agreed. We never store or show your ID photo, selfie, name or birth date.</Txt>
            <Txt variant="small">• Once we have the result, the provider is asked to erase what it holds for the check.</Txt>
            <Txt variant="small">• Other people only ever see the "Verified adult" badge.</Txt>
            <Txt variant="small">{method === 'face' ? '• Matching your face to your ID is biometric data. It is used only for this check, and only with your consent.' : '• This check uses your ID document only: no selfie and no face matching, so nothing biometric.'}</Txt>
          </Card>

          {mode === 'manual' && (
            <Banner tone="warn">Test version: the document and selfie provider isn't connected yet, so nothing is photographed or uploaded. Submitting this asks a team member to approve you manually.</Banner>
          )}
          {mode === 'sandbox' && (
            <Banner tone="warn">Sandbox provider: you'll be taken to a simulated provider page where you choose the result. Nothing is photographed or uploaded.</Banner>
          )}
          {mode === 'auto' && <Banner tone="warn">Demo mode: you will be approved instantly. No documents are checked.</Banner>}

          <Txt variant="h3">How would you like to be checked?</Txt>
          <PillRow>
            <Pill label="ID + selfie" active={method === 'face'} onPress={() => { setMethod('face'); setConsent(false); }} />
            <Pill label="ID only, no face match" active={method === 'document'} onPress={() => { setMethod('document'); setConsent(false); }} />
          </PillRow>
          <Txt variant="small">{method === 'face' ? 'The quickest and most reliable: a photo of your ID and a live selfie that is matched to it.' : "For people who can't or would rather not use a selfie. It can take longer, and the check is not matched to your face."}</Txt>

          <CheckRow checked={consent} onChange={setConsent}>
            <Txt>
              {method === 'face'
                ? "I am 18 or older. I agree that a specialist provider checks my ID document and compares a live selfie with it, and I understand this involves biometric data used only to confirm I'm a real adult."
                : 'I am 18 or older. I agree that a specialist provider checks my ID document to confirm I am a real adult. No selfie is taken and nothing biometric is used.'}
            </Txt>
          </CheckRow>
          <Btn title={e === 'unverified' ? 'Start identity check' : 'Verify again'} onPress={start} loading={act.busy} disabled={!consent || !emailOk} />
          {!emailOk && <Txt variant="small">Confirm your email above to unlock this step.</Txt>}
          <Txt variant="small">You can withdraw consent and ask for your data to be deleted at any time.</Txt>
        </>
      )}

      {!(st.data?.phoneVerified || me?.phoneVerified) && e !== 'pending' && <PhoneVerifyCard compact />}
    </Screen>
  );
}
