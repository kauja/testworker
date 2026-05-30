export default function RunLoading() {
  return (
    <div className="h-[calc(100dvh-3rem)] animate-pulse">
      <div className="border-b border-line bg-bg-subtle px-4 py-3">
        <div className="h-10 rounded bg-bg-panel" />
      </div>
      <div className="grid h-[calc(100%-4.25rem)] grid-cols-[1fr_360px]">
        <div className="relative bg-bg">
          <div className="absolute left-4 top-4 h-9 w-[520px] rounded-md border border-line bg-bg-panel" />
          <div className="absolute inset-12 rounded border border-line/70 bg-bg-subtle" />
        </div>
        <aside className="border-l border-line bg-bg-subtle p-6">
          <div className="h-4 w-44 rounded bg-bg-panel" />
          <div className="mt-3 h-3 w-64 rounded bg-bg-panel" />
          <div className="mt-6 grid grid-cols-3 gap-2">
            <div className="h-12 rounded bg-bg-panel" />
            <div className="h-12 rounded bg-bg-panel" />
            <div className="h-12 rounded bg-bg-panel" />
          </div>
        </aside>
      </div>
    </div>
  );
}
