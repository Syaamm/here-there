import { useState } from 'react';
import { Btn, ErrorBanner, Field, Sheet } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';

/** "Ask the host to look again": once per declined request, with an optional note. `path` is the activity or trip. */
export function AskAgain({ path, who, onDone }: { path: string; who: 'host' | 'organizer'; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction(() => {
    setOpen(false);
    setNote('');
    onDone();
  });
  return (
    <>
      <Btn title={`Ask the ${who} to look again`} variant="secondary" onPress={() => setOpen(true)} />
      <Sheet visible={open} title="Ask again" onClose={() => setOpen(false)}>
        <ErrorBanner message={act.error} />
        <Field label="Add a short note (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
        <Btn title="Send" loading={act.busy} onPress={() => void act.run(() => post(`${path}/appeal`, note.trim() ? { intro: note.trim() } : {}))} />
      </Sheet>
    </>
  );
}
