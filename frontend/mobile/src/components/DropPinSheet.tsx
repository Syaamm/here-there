import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { Banner, Btn, Sheet, Txt, useGo } from '@/components/ui';
import { get } from '@/lib/api';
import { CITY_AREA_KM } from '@/lib/city';
import { sendDroppedPin } from '@/lib/dropPin';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { kmBetween } from '@/features/mapShared';

/**
 * A pin was dropped on the map (press and hold): "Create an activity here?" / "Plan a trip here?". The place is named from the
 * pin's position. An activity must be within CITY_AREA_KM of the city shown (the same limit as the create form); a trip can be
 * anywhere in the world.
 */
export function DropPinSheet({ kind, at, centre, city, onClose }: { kind: 'activity' | 'trip'; at: { lat: number; lng: number } | null; /** the shown city's centre, for the activity limit */ centre: [number, number] | null; city: string; onClose: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const go = useGo();
  const [place, setPlace] = useState<{ name: string; address: string } | null>(null);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    setPlace(null);
    if (!at) return;
    let live = true;
    setLooking(true);
    get<{ name: string; address: string } | null>(`/v1/places/reverse?${new URLSearchParams({ lat: String(at.lat), lng: String(at.lng) })}`)
      .then((r) => live && setPlace(r))
      .catch(() => live && setPlace(null))
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
  }, [at?.lat, at?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const km = at && centre ? kmBetween({ lat: centre[0], lng: centre[1] }, at) : null;
  const tooFar = kind === 'activity' && km !== null && km > CITY_AREA_KM;
  const name = place?.name ?? (kind === 'trip' ? t('Pinned place') : t('Pinned meeting point'));
  const where = place ? [place.name, place.address.split(', ').pop()].filter((x, i, a) => !!x && a.indexOf(x) === i).join(', ') : name;

  const create = () => {
    if (!at) return;
    sendDroppedPin({ kind, lat: at.lat, lng: at.lng, name: kind === 'trip' ? where : name, address: kind === 'trip' ? '' : (place ? place.address : t('Dropped pin')) });
    onClose();
    go('/create');
  };

  return (
    <Sheet visible={!!at} title={kind === 'activity' ? t('Create an activity here?') : t('Plan a trip here?')} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
          <Ionicons name="location" size={22} color="#D32F2F" />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{looking ? t('Finding the place…') : where}</Text>
            {kind === 'activity' && km !== null ? <Txt variant="small">{tooFar ? t('About {km} km from {city}', { km: Math.round(km), city }) : t('In {city}', { city })}</Txt> : null}
          </View>
        </View>
        {tooFar ? <Banner tone="bad">{t('Activities can only be created within {limit} km of {city}. Pick a spot closer, or change the city.', { limit: CITY_AREA_KM, city })}</Banner> : null}
        <Btn title={kind === 'activity' ? t('Create activity here') : t('Plan a trip here')} onPress={create} disabled={tooFar || looking} />
        <Btn title={t('Cancel')} variant="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}
