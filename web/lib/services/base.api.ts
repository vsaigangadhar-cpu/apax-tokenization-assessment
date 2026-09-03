const baseUrl =
  process.env.NODE_ENV === 'production'
    ? ''
    : 'http://localhost:4000';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
  data?: T;
}

/**
 * `path` is the full API path, e.g. '/user/login' or '/api/holdings'.
 */
export const baseAPI = async <T = unknown>(
  path: string,
  method: string,
  body?: unknown
): Promise<ApiResponse<T>> => {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      // Required for the httpOnly auth cookie to be stored and sent back.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error('Invalid JSON response from server');
    }

    const responseData = data as Partial<ApiResponse<T>> | null;

    // Returned rather than thrown so callers can act on the status code.
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        message:
          responseData?.message || `Request failed with status ${res.status}`,
      };
    }

    return {
      success: true,
      status: res.status,
      message: responseData?.message ?? 'Request successful',
      data: (responseData?.data ?? responseData) as T,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong';

    return {
      success: false,
      status: 0,
      message,
    };
  }
};
