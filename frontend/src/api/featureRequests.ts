import { request } from './core';

// ─── Feature Requests ────────────────────────────────────────────────────────

export interface FeatureRequest {
  id: string;
  username: string;
  text: string;
  createdAt: string;
  status: 'new' | 'reviewed' | 'planned' | 'done';
}

export async function submitFeatureRequest(text: string): Promise<{ id: string }> {
  return request('/api/feature-requests', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function listFeatureRequests(): Promise<FeatureRequest[]> {
  const res = await request<{ items: FeatureRequest[] }>('/api/feature-requests');
  return res.items;
}
