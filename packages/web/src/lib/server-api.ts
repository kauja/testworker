import { cache } from 'react';
import { fetchGraph, fetchRun, fetchRunDiff, fetchRunErrors, fetchRunStateGraphDiff } from './api';

export const getRun = cache((runId: string) => fetchRun(runId));
export const getGraph = cache((runId: string) => fetchGraph(runId));
export const getRunErrors = cache((runId: string) => fetchRunErrors(runId));
export const getRunDiff = cache((runId: string, base: string, showFlaky: boolean) =>
  fetchRunDiff(runId, base, showFlaky),
);
export const getRunStateGraphDiff = cache((runId: string, base: string, showFlaky: boolean) =>
  fetchRunStateGraphDiff(runId, base, showFlaky),
);
