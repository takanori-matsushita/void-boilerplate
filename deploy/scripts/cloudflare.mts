export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HyperdriveConfig {
  id: string;
  name: string;
  origin: { scheme?: string; host?: string; port?: number; database?: string; user?: string };
  caching: { disabled?: boolean } | null;
}

export class CloudflareError extends Error {}

/** Cloudflare REST API の最小クライアント。トークン・パスワードはエラーメッセージに含めない */
export class Cloudflare {
  readonly accountId: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(token: string, accountId: string, fetchImpl: FetchLike = fetch as FetchLike) {
    this.token = token;
    this.accountId = accountId;
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await this.fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}${path}`, {
      ...init,
      headers,
    });
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: T;
      errors?: { message: string }[];
    } | null;
    if (!response.ok || !body?.success) {
      const reasons = body?.errors?.map((e) => e.message).join('; ') ?? `HTTP ${response.status}`;
      throw new CloudflareError(`Cloudflare API エラー (${init.method ?? 'GET'} ${path}): ${reasons}`);
    }
    return body.result as T;
  }

  async listHyperdrive(): Promise<HyperdriveConfig[]> {
    return this.request<HyperdriveConfig[]>('/hyperdrive/configs');
  }

  async findHyperdrive(name: string): Promise<HyperdriveConfig | undefined> {
    const matches = (await this.listHyperdrive()).filter((c) => c.name === name);
    if (matches.length > 1) throw new CloudflareError(`同名の Hyperdrive が複数あります: ${name}`);
    return matches[0];
  }

  async createHyperdrive(name: string, origin: object): Promise<HyperdriveConfig> {
    return this.request<HyperdriveConfig>('/hyperdrive/configs', {
      method: 'POST',
      body: JSON.stringify({ name, origin, caching: { disabled: true } }),
    });
  }

  async disableHyperdriveCaching(id: string): Promise<HyperdriveConfig> {
    return this.request<HyperdriveConfig>(`/hyperdrive/configs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ caching: { disabled: true } }),
    });
  }

  async workersSubdomain(): Promise<string> {
    const result = await this.request<{ subdomain: string }>('/workers/subdomain');
    return result.subdomain;
  }

  async schedules(worker: string): Promise<string[]> {
    const result = await this.request<{ schedules: { cron: string }[] }>(`/workers/scripts/${worker}/schedules`);
    return result.schedules.map((s) => s.cron);
  }
}
