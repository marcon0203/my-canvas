/** fetch 封装与错误码映射。
 *  原型阶段后端未接入：请求统一走这里，便于以后替换 baseURL 与鉴权。 */
export class ApiError extends Error {
  constructor(
    public readonly code:
      | 'network' | 'timeout' | 'rate_limited' | 'insufficient_credits'
      | 'invalid_ref_image' | 'server',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(path, {
      headers: { 'content-type': 'application/json', ...init?.headers },
      ...init,
    });
    if (res.status === 429) throw new ApiError('rate_limited', '生成请求过于频繁');
    if (res.status === 402) throw new ApiError('insufficient_credits', '积分不足');
    if (!res.ok) throw new ApiError('server', `服务异常 ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('network', '网络不可达');
  }
}
