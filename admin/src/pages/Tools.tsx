import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend, ApiError } from '../lib/api';

interface Tool {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  entry: string;
  audience: string;      // free | pro
  enabled: boolean;
  sort: number;
  config: unknown;
  updated_at: number | null;
}

interface FormState {
  mode: 'create' | 'edit';
  slug: string;
  name: string;
  description: string;
  icon: string;
  entry: string;
  audience: string;
  enabled: boolean;
  sort: string;
  config: string; // JSON 文本
}

const emptyForm: FormState = {
  mode: 'create', slug: '', name: '', description: '', icon: '', entry: '',
  audience: 'free', enabled: false, sort: '0', config: '',
};

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

export default function Tools() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = await apiGet<{ items: Tool[] }>('/api/admin/tools');
      setTools(d.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (t: Tool) => {
    setError('');
    try {
      await apiSend('PUT', '/api/admin/tools/update', { slug: t.slug, enabled: !t.enabled });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败');
    }
  };

  const startEdit = (t: Tool) => {
    setFormError('');
    setForm({
      mode: 'edit', slug: t.slug, name: t.name, description: t.description || '', icon: t.icon || '',
      entry: t.entry, audience: t.audience || 'free', enabled: t.enabled, sort: String(t.sort ?? 0),
      config: t.config ? JSON.stringify(t.config, null, 2) : '',
    });
  };

  const submit = async () => {
    if (!form) return;
    setFormError(''); setSaving(true);
    try {
      let config: unknown = null;
      if (form.config.trim()) {
        try { config = JSON.parse(form.config); }
        catch { throw new Error('config 不是合法 JSON'); }
      }
      const payload = {
        slug: form.slug.trim(), name: form.name.trim(), description: form.description,
        icon: form.icon, entry: form.entry.trim(), audience: form.audience,
        enabled: form.enabled, sort: Number(form.sort) || 0, config,
      };
      if (form.mode === 'create') {
        await apiSend('POST', '/api/admin/tools/create', payload);
      } else {
        await apiSend('PUT', '/api/admin/tools/update', payload);
      }
      setForm(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">工具注册表</h1>
          <p className="text-sm text-neutral-500">可插拔学习工具：开关 / 人群 / 排序 / 配置（前台 /api/tools 读 enabled=1）</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
          <button onClick={() => { setFormError(''); setForm({ ...emptyForm }); }}
            className="text-sm px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark">新增工具</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {/* 新增/编辑表单 */}
      {form && (
        <div className="bg-white rounded-xl border border-neutral-200 p-5 mb-6">
          <h2 className="text-sm font-medium text-neutral-600 mb-4">
            {form.mode === 'create' ? '新增工具' : `编辑：${form.slug}`}
          </h2>
          {formError && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</div>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <label className="text-xs text-neutral-400">slug *</label>
              <input value={form.slug} disabled={form.mode === 'edit'} onChange={e => setForm({ ...form, slug: e.target.value })}
                placeholder="fraction-drill"
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50 disabled:text-neutral-400" />
            </div>
            <div>
              <label className="text-xs text-neutral-400">名称 *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-neutral-400">入口路径 *</label>
              <input value={form.entry} onChange={e => setForm({ ...form, entry: e.target.value })}
                placeholder="/tools/fraction-drill/index.js"
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-neutral-400">图标（emoji）</label>
              <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })}
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-neutral-400">可见人群</label>
              <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 bg-white">
                <option value="free">free（所有人）</option>
                <option value="pro">pro（会员）</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-400">排序（小的在前）</label>
              <input type="number" value={form.sort} onChange={e => setForm({ ...form, sort: e.target.value })}
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
                启用（enabled）
              </label>
            </div>
            <div className="col-span-2 lg:col-span-3">
              <label className="text-xs text-neutral-400">描述</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2" />
            </div>
            <div className="col-span-2 lg:col-span-4">
              <label className="text-xs text-neutral-400">配置 config（JSON，可选）</label>
              <textarea value={form.config} onChange={e => setForm({ ...form, config: e.target.value })} rows={3}
                placeholder='{"dailyLimit": 20}'
                className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 font-mono text-xs" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button disabled={saving} onClick={submit}
              className="text-sm px-4 py-2 rounded-lg bg-brand text-white hover:bg-brand-dark disabled:opacity-50">
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={() => setForm(null)} className="text-sm px-4 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : !tools.length ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-12 text-center text-sm text-neutral-400">
          注册表为空。可跑 db/seed-tools.sql 灌入首批示范工具，或点右上角「新增工具」。
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3">排序</th>
                <th className="px-4 py-3">工具</th>
                <th className="px-4 py-3">人群</th>
                <th className="px-4 py-3">启用</th>
                <th className="px-4 py-3">更新时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {tools.map(t => (
                <tr key={t.slug} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                  <td className="px-4 py-3 text-xs text-neutral-400">{t.sort}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">{t.icon ? t.icon + ' ' : ''}{t.name}</div>
                    <div className="text-[11px] text-neutral-400 font-mono">{t.slug} → {t.entry}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${t.audience === 'pro' ? 'bg-brand/20 text-brand-dark' : 'bg-neutral-100 text-neutral-500'}`}>
                      {t.audience === 'pro' ? 'Pro' : 'Free'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleEnabled(t)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.enabled ? 'bg-green-500' : 'bg-neutral-300'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${t.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(t.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => startEdit(t)} className="text-xs text-brand-dark hover:underline">编辑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
