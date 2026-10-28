import { Chip } from '@/components/ui';
import type { Reliability } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * A person's reliability level as a small labelled chip (the words always carry the meaning, never colour alone).
 * It shows nothing when the server sent nothing: levels are only shown to verified members.
 */
export function ReliabilityChip({ r }: { r?: Reliability | null }) {
  const { t } = useT();
  if (!r) return null;
  const tone = r.level === 'needs_care' ? 'warn' : r.level === 'new' ? 'neutral' : 'ok';
  return <Chip label={r.level === 'very_reliable' ? t('★ Very reliable') : t(r.label)} tone={tone} />;
}
