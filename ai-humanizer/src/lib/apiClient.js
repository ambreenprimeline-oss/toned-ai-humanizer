/**
 * Thin fetch wrapper that calls Vercel API routes.
 * Replaces base44.functions.invoke().
 */

export const apiClient = {
  async invoke(endpoint, body) {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
        status: res.status,
        data,
      });
    }
    return { data };
  },
};
