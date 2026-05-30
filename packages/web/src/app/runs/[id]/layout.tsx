import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { getRun } from '@/lib/server-api';
import { RunRouteProvider } from '@/components/run-route-context';

export default async function RunLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const run = await getRun(id);
    return <RunRouteProvider run={run}>{children}</RunRouteProvider>;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
