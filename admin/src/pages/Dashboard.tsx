import { useEffect, useState } from 'react';

interface Stat {
  label: string;
  value: string;
  hint: string;
}

export default function Dashboard() {
  const [stats] = useState<Stat[]>([
    { label: '今日 UV', value: '—', hint: 'P3 接入 Analytics Engine 后显示' },
    { label: '今日 PV', value: '—', hint: 'P3 接入 Analytics Engine 后显示' },
    { label: '新增注册', value: '—', hint: 'P1 接入 KV/D1 用户表后显示' },
    { label: '活跃订阅', value: '—', hint: 'P1 接入 Creem 订阅后显示' },
  ]);

  useEffect(() => {
    document.title = '概览 · Triumph Admin';
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-neutral-800 mb-1">概览</h1>
      <p className="text-sm text-neutral-500 mb-6">Triumph 后台管理 — P0 骨架已就位，数据模块分阶段接入</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-neutral-200 p-5">
            <div className="text-xs text-neutral-400">{s.label}</div>
            <div className="text-2xl font-semibold text-neutral-800 mt-1">{s.value}</div>
            <div className="text-[11px] text-neutral-400 mt-1">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center text-sm text-neutral-400">
        漏斗 / 留存 / 正确率图表将在 P3 接入（Recharts）
      </div>
    </div>
  );
}
