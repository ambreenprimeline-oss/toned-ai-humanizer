/**
 * Thin shim — replaces the @base44/sdk client.
 * Everything now lives in localStorage (jobs) and Vercel API routes (AI pipeline).
 */
export { jobStore as entities } from '@/lib/jobStore';
export { apiClient as functions } from '@/lib/apiClient';
export { authStore as auth } from '@/lib/authStore';
