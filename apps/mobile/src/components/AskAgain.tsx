import { useState } from 'react';
import { Btn, ErrorBanner, Field, Sheet } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** "Ask the host to look again": once per declined request, with an optional note. `path` is the activity or trip. */
export function AskAgain({ path, who, onDone }: { path: string; who: 'host' | 'organizer'; onDone: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction(() => {
    setOpen(false);
    setNote('');
    onDone();
  });
  return (
    <>
      <Btn title={who === 'host' ? t('Ask the host to look again') : t('Ask the organizer to look again')} variant="secondary" onPress={() => setOpen(true)} />
      <Sheet visible={open} title={t('Ask again')} onClose={() => setOpen(false)}>
        <ErrorBanner message={act.error} />
        <Field label={t('Add a short note (optional)')} value={note} onChangeText={setNote} multiline maxLength={500} />
        <Btn title={t('Send')} loading={act.busy} onPress={() => void act.run(() => post(`${path}/appeal`, note.trim() ? { intro: note.trim() } : {}))} />
      </Sheet>
    </>
  );
}
