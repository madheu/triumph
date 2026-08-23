export default function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-neutral-800 mb-1">{title}</h1>
      <p className="text-sm text-neutral-500 mb-6">{desc}</p>
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center text-sm text-neutral-400">
        该模块正在建设中，规划详见 <code className="text-brand-dark">docs/后台管理与收银台规划.md</code>
      </div>
    </div>
  );
}
