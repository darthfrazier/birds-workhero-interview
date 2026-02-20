export interface Job {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  result?: string | null;
  error?: string | null;
}
