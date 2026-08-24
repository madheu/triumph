import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend, ApiError } from '../lib/api';

interface ContentItem {
  id: string;
  type: string;
  slug: string;
  title: string | null;
  status: string;
  body_md?: string | null;
  meta?: { audience?: string; [k: string]: unknown } | null;
  updated_by: string | null;
  updated_at: number | null;
}

interface Revision {
  version: number;
  edited_by: string | null;
  created_at: number | null;
}

const TYPES = ['plan', 'map', 'email', 'page', 'faq'];
const TYPE_LABEL: Record<string, string> = { plan: '计划模板', map: '知识地图', email: '邮件文案', page: '页面', faq: 'FAQ' };

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

export default function Content() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 编辑器状态
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  // 新建表单
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ type: 'plan', slug: '', title: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = await apiGet<{ items: ContentItem[] }>('/api/admin/content');
      setItems(d.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = async (id: string) => {
    setError(''); setSaveMsg('');
    try {
      const d = await apiGet<{ item: ContentItem; revisions: Revision[] }>('/api/admin/content/detail?id=' + encodeURIComponent(id));
      setEditing(d.item);
      setRevisions(d.revisions || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    }
  };

  const create = async () => {
    setSaving(true); setError('');
    try {
      const d = await apiSend<{ item: ContentItem }>('POST', '/api/admin/content/create', draft);
      setCreating(false);
      setDraft({ type: 'plan', slug: '', title: '' });
      await load();
      openEdit(d.item.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败');
    } finally { setSaving(false); }
  };

  const save = async (patchStatus?: string) => {
    if (!editing) return;
    setSaving(true); setSaveMsg(''); setError('');
    try {
      const d = await apiSend<{ item: ContentItem; revision: number }>('PUT', '/api/admin/content/update', {
        id: editing.id,
        title: editing.title,
        body_md: editing.body_md,
        status: patchStatus || editing.status,
      });
      setEditing({ ...d.item, body_md: d.item.body_md });
      setSaveMsg(`✓ 已保存（修订 v${d.revision}）`);
      load();
      // 刷新修订列表
      const det = await apiGet<{ revisions: Revision[] }>('/api/admin/content/detail?id=' + d.item.id);
      setRevisions(det.revisions || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">内容管理</h1>
          <p className="text-sm text-neutral-500">计划模板 / 知识地图 / 邮件文案 · 每次保存自动留修订快照</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
          <button onClick={() => setCreating(true)}
            className="text-sm px-4 py-1.5 rounded-lg bg-brand-dark text-white hover:opacity-90">＋ 新建</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {/* 新建面板 */}
      {creating && (
        <div className="mb-5 bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}
              className="text-sm border border-neutral-200 rounded-lg px-3 py-2">
              {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}（{t}）</option>)}
            </select>
            <input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })}
              placeholder="slug（如 morning-plan）"
              className="text-sm border border-neutral-200 rounded-lg px-3 py-2 font-mono" />
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
              placeholder="标题"
              className="text-sm border border-neutral-200 rounded-lg px-3 py-2" />
          </div>
          <div className="flex gap-3">
            <button onClick={create} disabled={saving || !draft.slug || !draft.title}
              className="text-sm px-4 py-1.5 rounded-lg bg-brand-dark text-white disabled:opacity-50">{saving ? '创建中…' : '创建（草稿）'}</button>
            <button onClick={() => setCreating(false)} className="text-sm text-neutral-500 hover:text-neutral-700">取消</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : !items.length ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-14 text-center text-neutral-400 text-sm">
          还没有内容条目。点右上角「新建」创建第一条（计划模板 / 邮件文案 / FAQ…）
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3 w-20">类型</th>
                <th className="px-4 py-3">标题 / slug</th>
                <th className="px-4 py-3 w-24">权益</th>
                <th className="px-4 py-3 w-24">状态</th>
                <th className="px-4 py-3 w-36">更新时间</th>
                <th className="px-4 py-3 w-16 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 cursor-pointer" onClick={() => openEdit(item.id)}>
                  <td className="px-4 py-3 text-xs text-neutral-500">{TYPE_LABEL[item.type] || item.type}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">{item.title}</div>
                    <div className="font-mono text-[11px] text-neutral-400">{item.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    {item.meta?.audience
                      ? <span className={`text-xs px-2 py-0.5 rounded-full ${item.meta.audience === 'pro' ? 'bg-brand/20 text-brand-dark' : 'bg-neutral-100 text-neutral-500'}`}>{item.meta.audience === 'pro' ? 'Pro' : 'Free'}</span>
                      : <span className="text-xs text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${item.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {item.status === 'published' ? '已发布' : '草稿'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-400">{fmtTime(item.updated_at)}</td>
                  <td className="px-4 py-3 text-right"><button className="text-xs text-brand-dark hover:underline">编辑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑抽屉 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setEditing(null)}>
          <div className="w-full max-w-2xl bg-white h-full overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-neutral-800 truncate">{editing.title}</div>
                <div className="font-mono text-[11px] text-neutral-400">{editing.slug} · {editing.type}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
                {editing.status === 'published'
                  ? <button onClick={() => save('draft')} disabled={saving} className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50">撤回为草稿</button>
                  : <button onClick={() => save('published')} disabled={saving} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">发布</button>}
                <button onClick={() => save()} disabled={saving} className="text-sm px-4 py-1.5 rounded-lg bg-brand-dark text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
                <button onClick={() => setEditing(null)} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none">×</button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">标题</label>
                <input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })}
                  className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">正文（Markdown）</label>
                <textarea value={editing.body_md || ''} onChange={e => setEditing({ ...editing, body_md: e.target.value })}
                  rows={18} className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 font-mono leading-relaxed"
                  placeholder={'# 标题\n\n正文内容，支持 Markdown。'} />
              </div>

              {revisions.length > 0 && (
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">修订历史（每次保存自动快照，可回滚）</label>
                  <div className="border border-neutral-100 rounded-lg divide-y divide-neutral-50 max-h-40 overflow-auto">
                    {revisions.map(r => (
                      <div key={r.version} className="px-3 py-2 flex justify-between text-xs text-neutral-500">
                        <span>v{r.version}</span>
                        <span>{r.edited_by || '—'}</span>
                        <span>{fmtTime(r.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
