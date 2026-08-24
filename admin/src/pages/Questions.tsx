import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend, ApiError } from '../lib/api';

interface Question {
  id: string;
  subtest: string | null;
  category: string | null;
  difficulty: string | null;
  stem_md: string | null;
  options: string[];
  answer_index: number | null;
  explanation_md: string | null;
  status: string;
  updated_at: number | null;
}

const SUBTESTS = ['5002', '5003', '5004', '5005'];
const STATUSES = ['active', 'draft', 'retired'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString() : '—');

export default function Questions() {
  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 筛选条件
  const [subtest, setSubtest] = useState('');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  // 编辑面板
  const [editing, setEditing] = useState<Question | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (subtest) p.set('subtest', subtest);
      if (status) p.set('status', status);
      if (q.trim()) p.set('q', q.trim());
      const d = await apiGet<{ items: Question[]; total: number }>('/api/admin/questions?' + p.toString());
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [subtest, status, q, offset]);

  useEffect(() => { load(); }, [load]);

  const openEdit = async (id: string) => {
    setError('');
    try {
      const d = await apiGet<{ question: Question }>('/api/admin/questions/detail?id=' + encodeURIComponent(id));
      setEditing(d.question);
      setSaveMsg('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载题目失败');
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setSaveMsg('');
    try {
      const d = await apiSend<{ question: Question }>('PATCH', '/api/admin/questions/update', {
        id: editing.id,
        stem_md: editing.stem_md,
        options: editing.options,
        answer_index: editing.answer_index,
        explanation_md: editing.explanation_md,
        difficulty: editing.difficulty,
        status: editing.status,
      });
      setEditing(d.question);
      setSaveMsg('✓ 已保存');
      load();
    } catch (e) {
      setSaveMsg('');
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const patchEditing = (patch: Partial<Question>) => setEditing(prev => (prev ? { ...prev, ...patch } : prev));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">题库管理</h1>
          <p className="text-sm text-neutral-500">共 {total} 题 · 筛选 / 搜索 / 编辑</p>
        </div>
        <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={subtest} onChange={e => { setSubtest(e.target.value); setOffset(0); }}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white">
          <option value="">全部科目</option>
          {SUBTESTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white">
          <option value="">全部状态</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setOffset(0), load())}
          placeholder="搜索题干 / ID / 知识点…"
          className="text-sm border border-neutral-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]" />
        <button onClick={() => { setOffset(0); load(); }} className="text-sm px-4 py-2 rounded-lg bg-brand-dark text-white hover:opacity-90">搜索</button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {/* 列表 */}
      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3 w-24">ID</th>
                <th className="px-4 py-3">题干</th>
                <th className="px-4 py-3 w-16">难度</th>
                <th className="px-4 py-3 w-20">状态</th>
                <th className="px-4 py-3 w-24">更新</th>
                <th className="px-4 py-3 w-16 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 cursor-pointer" onClick={() => openEdit(item.id)}>
                  <td className="px-4 py-3 font-mono text-xs">{item.id}</td>
                  <td className="px-4 py-3">
                    <div className="max-w-[420px] truncate text-neutral-700">{item.stem_md || '—'}</div>
                    {item.category && <span className="text-[11px] text-neutral-400">{item.category}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{item.difficulty || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      item.status === 'active' ? 'bg-green-100 text-green-700'
                      : item.status === 'draft' ? 'bg-amber-100 text-amber-700'
                      : 'bg-neutral-100 text-neutral-500'}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-400">{fmtTime(item.updated_at)}</td>
                  <td className="px-4 py-3 text-right"><button className="text-xs text-brand-dark hover:underline">编辑</button></td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-neutral-400 text-sm">没有符合条件的题目</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      <div className="flex items-center justify-between mt-4 text-sm text-neutral-500">
        <span>第 {offset + 1}–{Math.min(offset + limit, total)} 题 / 共 {total}</span>
        <div className="flex gap-2">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}
            className="px-3 py-1.5 border border-neutral-200 rounded-lg disabled:opacity-40 hover:bg-neutral-50">上一页</button>
          <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}
            className="px-3 py-1.5 border border-neutral-200 rounded-lg disabled:opacity-40 hover:bg-neutral-50">下一页</button>
        </div>
      </div>

      {/* 编辑面板（右侧滑出） */}
      {editing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setEditing(null)}>
          <div className="w-full max-w-xl bg-white h-full overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-sm text-neutral-800">{editing.id}</div>
                <div className="text-[11px] text-neutral-400">{editing.subtest} · {editing.category || '—'}</div>
              </div>
              <div className="flex items-center gap-3">
                {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
                <button onClick={save} disabled={saving}
                  className="text-sm px-4 py-1.5 rounded-lg bg-brand-dark text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
                <button onClick={() => setEditing(null)} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none">×</button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">题干（Markdown）</label>
                <textarea value={editing.stem_md || ''} onChange={e => patchEditing({ stem_md: e.target.value })}
                  rows={4} className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2" />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">选项（点字母设为正确答案）</label>
                <div className="space-y-2">
                  {(editing.options || []).map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button type="button" onClick={() => patchEditing({ answer_index: i })}
                        className={`w-7 h-7 shrink-0 rounded-full text-xs font-medium border ${
                          editing.answer_index === i
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-neutral-500 border-neutral-300 hover:border-brand'}`}>
                        {String.fromCharCode(65 + i)}
                      </button>
                      <input value={opt}
                        onChange={e => {
                          const opts = [...editing.options]; opts[i] = e.target.value; patchEditing({ options: opts });
                        }}
                        className="flex-1 text-sm border border-neutral-200 rounded-lg px-3 py-1.5" />
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-neutral-400 mt-1">正确答案：{editing.answer_index !== null ? String.fromCharCode(65 + (editing.answer_index ?? 0)) : '未设置'}</div>
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">解析（Markdown）</label>
                <textarea value={editing.explanation_md || ''} onChange={e => patchEditing({ explanation_md: e.target.value })}
                  rows={5} className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">难度</label>
                  <select value={editing.difficulty || ''} onChange={e => patchEditing({ difficulty: e.target.value })}
                    className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2">
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">状态</label>
                  <select value={editing.status} onChange={e => patchEditing({ status: e.target.value })}
                    className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2">
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="text-[11px] text-neutral-400 mt-1">retired = 下架不再出现在练习里</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
