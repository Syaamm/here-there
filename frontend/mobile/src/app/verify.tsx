import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Platform, Pressable, View } from 'react-native';
import { AcctCard, AcctOutlineButton, AcctScreen, StatusTag } from '@/components/AccountParts';
import { AuthButton } from '@/components/AuthForm';
import { Text } from '@/components/ScaledText';
import { useTheme } from '@/lib/theme';
import { EmailVerifyCard } from '@/components/EmailVerifyCard';
import { PhoneVerifyCard } from '@/components/PhoneVerifyCard';
import { Banner, Btn, CheckRow, ErrorBanner, Pill, PillRow, Row, Txt } from '@/components/ui';

import { del, get, post, type Me } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/hooks';
import { localeTag, useT } from '@/lib/i18n';
import { dateText } from '@/lib/format';

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
  ['1', 'Agree'],
  ['2', 'Photograph your ID'],
  ['3', 'Take a selfie'],
  ['4', 'Get your badge'],
];

const REVERIFY_TEXT: Record<string, string> = {
  expired: 'Your verification has expired.',
  security: 'Please verify your identity again.',
  fraud_suspected: 'Please verify your identity again.',
  provider_required: 'Please verify your identity again.',
  other: 'Please verify your identity again.',
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
const date = (iso: string) => dateText(iso, { weekday: false, year: true });

/**
 * Identity verification (KYC). Browsing never needs it; creating, joining, applying and chatting do.
 * It is one-time and shared by HERE and THERE: once verified you are not asked again until it expires.
 */
export default function Verify() {
  const { me, reload } = useMe();
  const { t } = useT();
  const router = useRouter();
  const { c } = useTheme();
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

  // in a browser the check runs in another tab: when the person comes back to this one, look for the decision at once
  const refresh = useRef(() => {});
  refresh.current = () => {
    void st.reload();
    void reload();
  };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const back = () => {
      if (document.visibilityState === 'visible') refresh.current();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  if (st.loading && !st.data && !me) return <AcctScreen title={t('Get verified')}><SkeletonDetail /></AcctScreen>;

  const e: Eligibility = st.data?.eligibility ?? me?.eligibility ?? 'unverified';
  const mode = st.data?.mode;
  const emailOk = me?.emailVerified ?? st.data?.emailVerified ?? false;
  const underage = e === 'rejected' && st.data?.lastRejectionReason === 'underage';
  const needsCheck = ['unverified', 'rejected', 'expired', 'reverification_required'].includes(e);
  const [chipEn, chipTone] = IDENTITY_CHIP[e] ?? IDENTITY_CHIP.unverified;
  const chipLabel = t(chipEn);

  const adultOk = !!(st.data?.adultVerified || me?.adultVerified);
  const phoneOk = !!(st.data?.phoneVerified || me?.phoneVerified);
  const statusRows: [React.ComponentProps<typeof Ionicons>['name'], string, string, 'ok' | 'warn' | 'bad' | 'neutral'][] = [
    ['mail-outline', t('Email'), emailOk ? t('Confirmed') : t('Not confirmed'), emailOk ? 'ok' : 'warn'],
    ['person-outline', t('Adult (18+)'), adultOk ? t('Confirmed by check') : t('You declared it'), adultOk ? 'ok' : 'neutral'],
    ['id-card-outline', t('Identity'), chipLabel, chipTone],
    ['phone-portrait-outline', t('Mobile (optional)'), phoneOk ? t('Confirmed') : t('Not added'), phoneOk ? 'ok' : 'neutral'],
  ];

  const start = async () => {
    // in a browser the check opens in a NEW tab. A tab opened after the request has finished is blocked as a pop-up, so an empty one
    // is opened right now, while the tap is still counted, and sent to the check page when the answer arrives
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    const r = await act.run(() => post<{ eligibility: string; url?: string }>('/v1/me/verification', { consent: true, method }));
    // a provider returns its hosted page (ID photo + selfie with liveness): open it
    if (r?.url && Platform.OS === 'web') openTab(r.url, tab);
    else if (r?.url) await openCheck(r.url);
    else {
      tab?.close();
      if (r && r.eligibility !== 'verified') act.setError(t('The check started but no page link came back ({status}). Tap Check for an update, or Cancel and start over.', { status: r.eligibility }));
    }
  };

  // in a browser: show the provider's page in a new tab (the empty one opened at the tap, or a fresh one); if the browser refuses
  // a new tab, go there in the whole tab instead (the web preview shows the app inside a phone-shaped frame, and a provider's page
  // refuses to load inside a frame, so it is the top window that moves)
  const openTab = (url: string, tab?: Window | null) => {
    if (tab && !tab.closed) {
      tab.location.href = url;
      tab.focus();
    } else if (!window.open(url, '_blank')) goTo(url);
  };
  const goTo = (url: string) => {
    try {
      (window.top ?? window).location.href = url;
    } catch {
      window.location.href = url;
    }
  };

  // on a phone the check opens in an in-app browser sheet (reliable in Expo Go too); when it is closed, look for the decision
  const openCheck = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
      void st.reload();
      void reload();
    } catch {
      Linking.openURL(url).catch(() => act.setError(t("We couldn't open the check page. Please try again.")));
    }
  };

  return (
    <AcctScreen title={t('Get verified')}>
      {/* the picture that opens the page: a verified profile on a phone. Drawn from the designer's vector file at 4x (876 x 852), so it
          stays sharp on every screen; the old 392 px picture was stretched to about twice its size */}
      <Image source={require('../../assets/illustrations/verified.webp')} contentFit="contain" accessibilityElementsHidden importantForAccessibility="no" style={{ width: '100%', height: 250, marginTop: 4, marginBottom: 8 }} />

      <AcctCard style={{ gap: 6, paddingVertical: 18 }}>
        {statusRows.map(([icon, label, tag, tone]) => (
          <View key={icon} accessible accessibilityLabel={`${label}: ${tag}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 52 }}>
            <Ionicons name={icon} size={28} color={c.text} />
            <Text style={{ flex: 1, color: c.text, fontSize: 19, opacity: 0.85 }}>{label}</Text>
            <StatusTag label={tag} tone={tone} />
          </View>
        ))}
      </AcctCard>

      <ErrorBanner message={act.error} />

      {e === 'verified' && (
        <>
          <Banner tone="ok">
            {t("You're a verified adult.")}{st.data?.verifiedUntil ? ' ' + t('Valid until {date}.', { date: date(st.data.verifiedUntil) }) : ''}
          </Banner>
          <AuthButton title={t('Back to exploring')} onPress={() => router.back()} />
        </>
      )}

      {e === 'pending' && (
        <>
          <Banner tone="warn">{t('Check in progress. We\'ll notify you.')}</Banner>
          {st.data?.resumeUrl ? <AuthButton title={t('Continue identity check')} onPress={() => (Platform.OS === 'web' ? openTab(st.data!.resumeUrl!) : void openCheck(st.data!.resumeUrl!))} /> : null}
          <AcctOutlineButton title={t('Check for an update')} icon="refresh" loading={st.loading} onPress={() => void st.reload()} />
          {/* closed the provider page, or it got stuck: abandon this attempt and begin again */}
          <Pressable accessibilityRole="button" accessibilityLabel={t('Cancel and start over')} disabled={act.busy} hitSlop={8} onPress={() => act.run(() => del('/v1/me/verification'))} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', opacity: act.busy ? 0.5 : 1 }}>
            <Text style={{ color: c.danger, fontSize: 15, textDecorationLine: 'underline' }}>{t('Cancel and start over')}</Text>
          </Pressable>
        </>
      )}

      {needsCheck && underage && (
        <Banner tone="bad">
          {t("This account couldn't be verified: This app is for adults aged 18 and over. If you think this is a mistake, please contact support and a member of our team will review it.")}
        </Banner>
      )}

      {needsCheck && !underage && (
        <>
          {(e === 'expired' || e === 'reverification_required') && <Banner tone="warn">{t(REVERIFY_TEXT[st.data?.reverifyReason ?? me?.reverifyReason ?? (e === 'expired' ? 'expired' : 'other')] ?? REVERIFY_TEXT.other)}</Banner>}
          {e === 'rejected' && <Banner tone="bad">{t(REJECT_TEXT[st.data?.lastRejectionReason ?? ''] ?? "We couldn't verify you last time. You can try again.")}</Banner>}
          {e === 'rejected' && <Btn title={t('I think this was a mistake: ask for a review')} variant="secondary" onPress={() => router.push('/appeal?kind=verification' as never)} />}

          {/* spec 3.1: the email address is confirmed before the identity check */}
          {!emailOk && (
            <>
              <Banner tone="warn">{t('Confirm your email first.')}</Banner>
              <EmailVerifyCard />
            </>
          )}

          <Txt variant="h2">{t('How it works')}</Txt>
          {STEPS.map(([n, title]) => (
            <Row key={n}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#102F29', alignItems: 'center', justifyContent: 'center' }}>
                <Txt color="#fff" bold>{n}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="h3">{t(title)}</Txt>
              </View>
            </Row>
          ))}

          <AcctCard style={{ gap: 8 }}>
            <Txt variant="h3">{t('🔒 Your data')}</Txt>
            <Txt variant="small">{t('• We keep only the result (verified or not), a reference number and the time you agreed. We never store or show your ID photo, selfie, name or birth date.')}</Txt>
            <Txt variant="small">{method === 'face' ? t('• Matching your face to your ID is biometric data. It is used only for this check, and only with your consent.') : t('• This check uses your ID document only: no selfie and no face matching, so nothing biometric.')}</Txt>
          </AcctCard>

          {mode === 'manual' && (
            <Banner tone="warn">{t('Test version: a team member approves you manually.')}</Banner>
          )}
          {mode === 'sandbox' && (
            <Banner tone="warn">{t('Sandbox: you choose a simulated result.')}</Banner>
          )}
          {mode === 'auto' && <Banner tone="warn">{t('Demo mode: approved instantly.')}</Banner>}

          <Txt variant="h3">{t('How would you like to be checked?')}</Txt>
          <PillRow>
            <Pill label={t('ID + selfie')} active={method === 'face'} onPress={() => { setMethod('face'); setConsent(false); }} />
            <Pill label={t('ID only, no face match')} active={method === 'document'} onPress={() => { setMethod('document'); setConsent(false); }} />
          </PillRow>

          <CheckRow checked={consent} onChange={setConsent}>
            <Txt>
              {method === 'face'
                ? t("I am 18 or older. I agree that a specialist provider checks my ID document and compares a live selfie with it, and I understand this involves biometric data used only to confirm I'm a real adult.")
                : t('I am 18 or older. I agree that a specialist provider checks my ID document to confirm I am a real adult. No selfie is taken and nothing biometric is used.')}
            </Txt>
          </CheckRow>
          <AuthButton title={e === 'unverified' ? t('Start identity check') : t('Verify again')} onPress={start} loading={act.busy} disabled={!consent || !emailOk} />
          <Txt variant="small">{t('You can withdraw consent and ask for your data to be deleted at any time.')}</Txt>
        </>
      )}

      {!(st.data?.phoneVerified || me?.phoneVerified) && e !== 'pending' && <PhoneVerifyCard compact />}
    </AcctScreen>
  );
}
