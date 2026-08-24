import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend, ApiError } from '../lib/api';

interface Msg { author: string; body: string; created_at: number | null; }
interface Ticket {
  id: string;
  user_id: string;
  user_email?: string;
  subject: string;
  status: string;
  refund_requested: boolean;
  created_at: number | null;
  resolved_at: number | null;
  messages?: Msg[];
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
};

const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

export default function Tickets() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // 详情抽屉
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [refundOrderId, setRefundOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = statusFilter ? '?status=' + statusFilter : '';
      const d = await apiGet<{ items: Ticket[] }>('/api/admin/tickets' + p);
      setItems(d.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setError(''); setNote('');
    try {
      const d = await apiGet<{ ticket: Ticket }>('/api/admin/tickets/detail?id=' + encodeURIComponent(id));
      setDetail(d.ticket);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    }
  };

  const reply = async () => {
    if (!detail || !replyText.trim()) return;
    setBusy(true); setNote('');
    try {
      await apiSend('POST', '/api/admin/tickets/reply', { ticket_id: detail.id, body: replyText });
      setReplyText('');
      await openDetail(detail.id);
      load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : '回复失败');
    } finally { setBusy(false); }
  };

  const setStatus = async (status: string) => {
    if (!detail) return;
    setBusy(true); setNote('');
    try {
      await apiSend('POST', '/api/admin/tickets/status', { ticket_id: detail.id, status });
      await openDetail(detail.id);
      load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : '操作失败');
    } finally { setBusy(false); }
  };

  const refundDecision = async (decision: 'approve' | 'reject') => {
    if (!detail) return;
    setBusy(true); setNote('');
    try {
      const d = await apiSend<{ refund: { note: string } | null }>('POST', '/api/admin/tickets/status', {
        ticket_id: detail.id, refund_decision: decision,
        order_id: refundOrderId.trim() || undefined,
        reason: 'ticket:' + detail.id,
      });
      setNote(d.refund ? d.refund.note : '已记录');
      await openDetail(detail.id);
      load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : '操作失败');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-800">工单</h1>
          <p className="text-sm text-neutral-500">用户咨询与退款申请 · 批准退款后需到 Creem 控制台执行实际打款</p>
        </div>
        <div className="flex gap-3">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white">
            <option value="">全部状态</option>
            <option value="open">open（待处理）</option>
            <option value="pending">pending（已回复）</option>
            <option value="resolved">resolved（已解决）</option>
          </select>
          <button onClick={load} className="text-sm text-brand-dark hover:underline">刷新</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="text-sm text-neutral-400 py-10 text-center">加载中…</div>
      ) : !items.length ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-14 text-center text-neutral-400 text-sm">
          暂无工单。用户从主站提交的咨询/退款申请会出现在这里。
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-4 py-3">主题</th>
                <th className="px-4 py-3 w-52">用户</th>
                <th className="px-4 py-3 w-24">状态</th>
                <th className="px-4 py-3 w-20">退款</th>
                <th className="px-4 py-3 w-36">时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 cursor-pointer" onClick={() => openDetail(t.id)}>
                  <td className="px-4 py-3 font-medium text-neutral-800">{t.subject}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{t.user_email || t.user_id}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status] || ''}`}>{t.status}</span></td>
                  <td className="px-4 py-3">{t.refund_requested ? <span className="text-xs text-red-600 font-medium">申请中</span> : <span className="text-xs text-neutral-300">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-neutral-400">{fmtTime(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 详情抽屉 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetail(null)}>
          <div className="w-full max-w-xl bg-white h-full overflow-auto shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-neutral-800">{detail.subject}</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">{detail.user_email || detail.user_id} · {fmtTime(detail.created_at)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[detail.status] || ''}`}>{detail.status}</span>
                  <button onClick={() => setStatus('resolved')} disabled={busy}
                    className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">标记解决</button>
                  <button onClick={() => setDetail(null)} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none">×</button>
                </div>
              </div>
              {detail.refund_requested && (
                <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 space-y-2">
                  <div className="font-medium">⚠️ 该工单申请了退款</div>
                  <input value={refundOrderId} onChange={e => setRefundOrderId(e.target.value)}
                    placeholder="Creem 订单号 ord_xxx（可选，便于对账）"
                    className="w-full text-xs border border-red-200 rounded px-2 py-1" />
                  <div className="flex gap-2">
                    <button onClick={() => refundDecision('approve')} disabled={busy}
                      className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">批准退款</button>
                    <button onClick={() => refundDecision('reject')} disabled={busy}
                      className="px-3 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50">拒绝</button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 px-6 py-4 space-y-3 overflow-auto">
              {(detail.messages || []).map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.author === 'admin' ? 'ml-auto bg-brand/10' : 'bg-neutral-100'}`}>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">{m.author === 'admin' ? '客服（你）' : '用户'} · {fmtTime(m.created_at)}</div>
                  <div className="whitespace-pre-wrap text-neutral-800">{m.body}</div>
                </div>
              ))}
              {note && <div className="text-xs text-brand-dark bg-brand/5 rounded-lg px-3 py-2">{note}</div>}
            </div>

            <div className="border-t border-neutral-100 p-4">
              <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={3}
                placeholder="回复用户…（发送后工单转为 pending）"
                className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2" />
              <button onClick={reply} disabled={busy || !replyText.trim()}
                className="mt-2 text-sm px-4 py-1.5 rounded-lg bg-brand-dark text-white disabled:opacity-50">发送回复</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
