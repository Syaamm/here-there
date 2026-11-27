import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, get, post } from '../api';
import { Select, useBackdropClose } from '../controls';
import { askConfirm, Empty, errMsg, ErrorBanner, Icon, Loading, Page, Switch, useAction, useLoad } from '../ui';

type Field = { key: string; label: string; secret?: boolean; optional?: boolean; multiline?: boolean; hidden?: boolean; placeholder?: string; options?: [string, string][]; default?: string };
type Provider = { id: string; label: string; blurb?: string; fields: Field[] };
type Kind = string;
type Catalog = Record<Kind, { label: string; blurb: string; providers: Provider[] }>;
type Integration = { id: string; kind: Kind; provider: string; name: string; description: string; active: boolean; settings: Record<string, string>; secretsSet: Record<string, string> };


/**
 * Settings > Integrations (admins): the email and identity-verification services, one card each. A row is one saved service with its
 * details as tags, an on / off switch (one of each kind is on at a time), Edit and Delete. Secrets are written once and never shown again.
 */
export function IntegrationsPage() {
  const { data, error, loading, reload } = useLoad(() => get<{ catalog: Catalog; kinds: Kind[]; items: Integration[] }>('/v1/admin/integrations'), []);
  const act = useAction(reload);
  const [editing, setEditing] = useState<{ kind: Kind; row?: Integration } | null>(null);

  const remove = async (r: Integration) => {
    if (await askConfirm(`Delete ${r.name}?`, r.active ? 'It is switched on right now.' : 'This cannot be undone.', 'Delete')) act.run(async () => void (await api('DELETE', `/v1/admin/integrations/${r.id}`)));
  };
  const toggle = (r: Integration, on: boolean) => act.run(async () => void (await api('PATCH', `/v1/admin/integrations/${r.id}`, { active: on })));

  return (
    // Page supplies the scrolling body (.page-body): the console shell never scrolls by itself, so without it a tall list is cut off
    <Page title="Integrations">
    <div className="int-page">
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {loading && !data && <Loading rows={4} />}
      {data &&
        data.kinds.map((kind) => {
          const info = data.catalog[kind];
          const rows = data.items.filter((i) => i.kind === kind);
          return (
            <section key={kind} className="card int-card" aria-label={info.label}>
              <header className="int-head">
                <div>
                  <h2>{info.label}</h2>
                  <span className="muted small">{info.blurb}</span>
                </div>
                <button className="btn primary" onClick={() => (act.clear(), setEditing({ kind }))}>
                  <Icon name="plus" /> Add Integration
                </button>
              </header>
              {rows.length === 0 && <Empty>Nothing set up yet.</Empty>}
              {rows.map((r) => {
                const label = data.catalog[kind].providers.find((p) => p.id === r.provider)?.label ?? r.provider;
                const fields = data.catalog[kind].providers.find((p) => p.id === r.provider)?.fields ?? [];
                return (
                  <div key={r.id} className="int-row">
                    <span className={r.active ? 'int-dot on' : 'int-dot'} aria-hidden />
                    <div className="int-name">
                      <strong>{r.name}</strong>
                      <span className="muted small">{r.description || label}</span>
                    </div>
                    <div className="int-tags">
                      {fields.filter((f) => !f.hidden).map((f) => {
                        const raw = f.secret ? r.secretsSet[f.key] : r.settings[f.key];
                        const v = f.options ? (f.options.find(([o]) => o === raw)?.[1] ?? '') : raw;
                        return v ? (
                          <span key={f.key} className="int-tag">
                            {f.label.toLowerCase()} <b>{v}</b>
                          </span>
                        ) : null;
                      })}
                    </div>
                    <Switch on={r.active} onChange={(v) => toggle(r, v)} label={`${r.name} on or off`} disabled={act.busy} />
                    <button className="btn small" onClick={() => (act.clear(), setEditing({ kind, row: r }))}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => remove(r)}>
                      Delete
                    </button>
                  </div>
                );
              })}
            </section>
          );
        })}
      {editing && data && (
        <IntegrationDialog
          kind={editing.kind}
          label={data.catalog[editing.kind].label}
          providers={data.catalog[editing.kind].providers}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
    </Page>
  );
}

/**
 * The pop-up to add or edit one: the provider, a display label, and only the details that provider asks for. A secret starts empty
 * and, left empty, keeps what is saved. A known email provider has its host and port filled in for it (hidden fields keep their default).
 */
function IntegrationDialog({ kind, label, providers, row, onClose, onSaved }: { kind: Kind; label: string; providers: Provider[]; row?: Integration; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const editing = !!row;
  const defaults = (id: string) => Object.fromEntries(providers.find((p) => p.id === id)!.fields.filter((f) => !f.secret && f.default !== undefined).map((f) => [f.key, f.default!]));
  const [providerId, setProviderId] = useState(row?.provider ?? providers[0].id);
  const [name, setName] = useState(row?.name ?? '');
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...defaults(row?.provider ?? providers[0].id), ...(row?.settings ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => ref.current?.showModal(), []);
  const backdrop = useBackdropClose(ref, onClose);
  const provider = providers.find((p) => p.id === providerId)!;
  const set = (k: string, v: string) => setVals((cur) => ({ ...cur, [k]: v }));
  const hint = (f: Field) => (editing && f.secret ? `Saved ${row?.secretsSet[f.key] ?? ''}` : f.placeholder);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // a detail left empty is cleared; a secret left empty keeps what is saved
      const values = Object.fromEntries(provider.fields.map((f) => [f.key, (vals[f.key] ?? '').trim()]).filter(([k, v]) => v || !provider.fields.find((f) => f.key === k)!.secret));
      if (editing) await api('PATCH', `/v1/admin/integrations/${row!.id}`, { name, values });
      else await post('/v1/admin/integrations', { kind, provider: providerId, name, values });
      onSaved();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog int-dlg" onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="int-dlg" {...backdrop}>
      <form onSubmit={submit}>
        <header className="int-dlg-head">
          <div>
            <span className="int-dlg-kind">{label}</span>
            <h2 id="int-dlg">{editing ? 'Edit Integration' : 'New Integration'}</h2>
          </div>
        </header>
        <div className="int-dlg-body">
          <ErrorBanner message={error} />
          <label>
            Provider
            <Select value={providerId} onChange={(v) => (setProviderId(v), setVals(defaults(v)))} aria-label="Provider" disabled={editing}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Display label
            <input required minLength={2} maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Production ${provider.label}`} />
          </label>
          {provider.fields
            .filter((f) => !f.hidden)
            .map((f) => (
              <label key={`${providerId}-${f.key}`}>
                {f.label}
                {f.options ? (
                  <Select value={vals[f.key] ?? f.default ?? ''} onChange={(v) => set(f.key, v)} aria-label={f.label}>
                    {f.options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                ) : f.multiline ? (
                  <textarea rows={5} autoComplete="off" required={!editing && !f.optional} value={vals[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={hint(f)} />
                ) : (
                  <input type={f.secret ? 'password' : 'text'} autoComplete="off" required={!editing && !f.optional} value={vals[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={hint(f)} />
                )}
              </label>
            ))}
          <div className="int-dlg-foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save Changes' : 'Add Integration'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
