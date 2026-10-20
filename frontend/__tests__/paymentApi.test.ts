/**
 * __tests__/paymentApi.test.ts
 *
 * Issue #1438 turned `lib/paymentApi.ts` into the only place the frontend
 * touches its own backend. These tests pin the contract the migrated call
 * sites now depend on: URL building, header assembly (Bearer, signed,
 * credentials), envelope unwrapping, and — most importantly — every failure
 * path throwing a typed `ApiError` instead of a bare string.
 */

import {
  ApiError,
  apiDelete,
  apiGet,
  apiUrl,
  apiPatch,
  apiPost,
  apiPut,
  apiRequest,
  getApiBaseUrl,
  isApiError,
  NETWORK_ERROR_CODE,
  NETWORK_STATUS,
  submitSignedPayment,
} from "@/lib/paymentApi";
import { buildCanonicalString, signRequest } from "@/lib/requestSignature";

const mockGetJwtToken = jest.fn(() => null as string | null);
jest.mock("@/lib/auth", () => ({
  getJwtToken: () => mockGetJwtToken(),
}));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalSecret = process.env.NEXT_PUBLIC_PAYMENT_SIGNING_SECRET;

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function unparseableResponse(init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? false,
    status: init.status ?? 500,
    json: jest.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
  } as unknown as Response;
}

function fetchMock() {
  return globalThis.fetch as jest.MockedFunction<typeof fetch>;
}

function lastCall(): [RequestInfo | URL, RequestInit | undefined] {
  const calls = fetchMock().mock.calls;
  return calls[calls.length - 1] as [RequestInfo | URL, RequestInit | undefined];
}

function lastUrl(): string {
  return String(lastCall()[0]);
}

function lastInit(): Record<string, unknown> {
  return (lastCall()[1] ?? {}) as Record<string, unknown>;
}

function lastHeaders(): Record<string, string> {
  return (lastInit().headers ?? {}) as Record<string, string>;
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("Expected the request to reject");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://backend.test";
  process.env.NEXT_PUBLIC_PAYMENT_SIGNING_SECRET = "test-secret";
  mockGetJwtToken.mockReturnValue(null);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: jest.fn().mockRejectedValue(new Error("Unexpected network request")),
  });
});

afterEach(() => {
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
  if (originalSecret === undefined) {
    delete process.env.NEXT_PUBLIC_PAYMENT_SIGNING_SECRET;
  } else {
    process.env.NEXT_PUBLIC_PAYMENT_SIGNING_SECRET = originalSecret;
  }
  if (originalFetch) {
    Object.defineProperty(globalThis, "fetch", originalFetch);
  } else {
    Reflect.deleteProperty(globalThis, "fetch");
  }
});

describe("base URL and query building", () => {
  it("strips a trailing slash so paths never double up", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test/";
    expect(getApiBaseUrl()).toBe("https://api.example.test");
    expect(apiUrl("/api/payments/me")).toBe("https://api.example.test/api/payments/me");
  });

  it("falls back to same-origin relative paths when unset", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(getApiBaseUrl()).toBe("");
    expect(apiUrl("/api/turrets/signer")).toBe("/api/turrets/signer");
  });

  it("encodes query values and drops null and undefined entries", () => {
    expect(
      apiUrl("/api/turrets", { ownerPublicKey: "G OWNER/?", limit: 5, cursor: undefined })
    ).toBe("http://backend.test/api/turrets?ownerPublicKey=G%20OWNER%2F%3F&limit=5");
  });

  it("leaves the URL untouched for an empty query object", () => {
    expect(apiUrl("/api/turrets/signer", {})).toBe("http://backend.test/api/turrets/signer");
  });
});

describe("successful requests", () => {
  it("unwraps data from the backend envelope", async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ success: true, data: { username: "ada" } })
    );

    await expect(apiGet<{ username: string }>("/api/accounts/resolve/GABC")).resolves.toEqual({
      username: "ada",
    });
  });

  it("sends a bare fetch for a plain GET", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));

    await apiGet("/api/turrets/signer");

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(fetchMock().mock.calls[0]).toHaveLength(1);
    expect(lastUrl()).toBe("http://backend.test/api/turrets/signer");
  });

  it("returns the whole payload when the endpoint does not use the envelope", async () => {
    const challenge = { challengeXDR: "x", networkPassphrase: "Test SDF" };
    fetchMock().mockResolvedValueOnce(jsonResponse(challenge));

    await expect(
      apiGet("/api/auth", { query: { account: "GABC" }, envelope: false })
    ).resolves.toEqual(challenge);
    expect(lastUrl()).toBe("http://backend.test/api/auth?account=GABC");
  });

  it("serialises the body once and keeps caller headers", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: null }, { status: 201 }));

    await apiPost("/api/tips", { amount: "5" }, { headers: { "X-Trace": "abc" } });

    expect(lastInit().method).toBe("POST");
    expect(lastInit().body).toBe('{"amount":"5"}');
    expect(lastHeaders()).toEqual({
      "X-Trace": "abc",
      "Content-Type": "application/json",
    });
  });

  it("passes credentials and an abort signal through", async () => {
    const controller = new AbortController();
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: null }));

    await apiGet("/api/auth", { credentials: "include", signal: controller.signal });

    expect(lastInit().credentials).toBe("include");
    expect(lastInit().signal).toBe(controller.signal);
  });

  it.each([
    { name: "apiPut", run: () => apiPut("/api/turrets/deployment-1", { amount: 1 }), method: "PUT" },
    { name: "apiPatch", run: () => apiPatch("/api/turrets/deployment-1", { amount: 1 }), method: "PATCH" },
    { name: "apiDelete", run: () => apiDelete("/api/turrets/deployment-1"), method: "DELETE" },
  ])("$name sends $method", async ({ run, method }) => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: "ok" }));

    await expect(run()).resolves.toBe("ok");
    expect(lastInit().method).toBe(method);
  });
});

describe("ApiError", () => {
  it("carries the status, code and payload from a non-2xx response", async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(
        { error: "Invalid signature", code: "invalid_signature" },
        { ok: false, status: 401 }
      )
    );

    const error = await captureError(apiPost("/api/payments/submit", { amount: "5" }));

    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("Invalid signature");
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_signature");
    expect(error.method).toBe("POST");
    expect(error.path).toBe("/api/payments/submit");
    expect(error.payload).toEqual({ error: "Invalid signature", code: "invalid_signature" });
  });

  it("uses a message field when the backend sends no error field", async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ message: "Rate limited", code: "too_many_requests" }, { ok: false, status: 429 })
    );

    const error = await captureError(apiGet("/api/turrets"));
    expect(error.message).toBe("Rate limited");
    expect(error.code).toBe("too_many_requests");
  });

  it("reports a success:false envelope on an HTTP 200 as an error", async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Challenge rejected" })
    );

    const error = await captureError(apiPost("/api/turrets/challenge", {}));
    expect(error.message).toBe("Challenge rejected");
    expect(error.status).toBe(200);
  });

  it("accepts a success:false body when the endpoint has no envelope", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: false, error: "not indexed" }));

    await expect(apiGet("/api/auth", { envelope: false })).resolves.toEqual({
      success: false,
      error: "not indexed",
    });
  });

  it("falls back to the caller message when the body is not JSON", async () => {
    fetchMock().mockResolvedValueOnce(unparseableResponse({ status: 502 }));

    const error = await captureError(
      apiGet("/api/network/fee-history", { fallbackMessage: "Failed to load fees" })
    );
    expect(error.message).toBe("Failed to load fees");
    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.payload).toBeNull();
  });

  it("keeps the status even when the response has no json method", async () => {
    fetchMock().mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);

    const error = await captureError(apiGet("/api/tips/leaderboard/opt-out"));
    expect(error.status).toBe(500);
    expect(error.message).toBe("Request failed (GET /api/tips/leaderboard/opt-out)");
  });

  it("converts a rejected fetch into a network error", async () => {
    const networkError = new TypeError("Failed to fetch");
    fetchMock().mockRejectedValueOnce(networkError);

    const error = await captureError(apiGet("/api/turrets/signer"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Failed to fetch");
    expect(error.status).toBe(NETWORK_STATUS);
    expect(error.code).toBe(NETWORK_ERROR_CODE);
    expect(NETWORK_STATUS).toBe(0);
  });

  it("uses the fallback message for a network failure with no message", async () => {
    fetchMock().mockRejectedValueOnce(new Error(""));

    const error = await captureError(
      apiRequest("/api/push/subscribe", { method: "POST", fallbackMessage: "push failed" })
    );
    expect(error.message).toBe("push failed");
    expect(error.status).toBe(NETWORK_STATUS);
  });
});

describe("auth and signed requests", () => {
  it("attaches the session JWT only when asked", async () => {
    mockGetJwtToken.mockReturnValue("jwt-token");
    fetchMock().mockResolvedValue(jsonResponse({ success: true, data: null }));

    await apiGet("/api/analytics/GABC/summary");
    expect(lastHeaders()).toEqual({});

    await apiGet("/api/analytics/GABC/summary", { auth: true });
    expect(lastHeaders()).toEqual({ Authorization: "Bearer jwt-token" });
  });

  it("omits the Authorization header when nobody is signed in", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: null }));

    await apiGet("/api/payments/GABC/stats", { auth: true });
    expect(lastInit().headers).toBeUndefined();
  });

  it("signs a payment submission over the exact body it sends", async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: "payment-1" } }, { status: 201 })
    );

    const submission = {
      senderPublicKey: "GSENDER",
      recipientPublicKey: "GRECIPIENT",
      amount: "12.50",
      txHash: "hash-1",
    };
    const timestamp = 1_700_000_000_000;

    await expect(submitSignedPayment(submission, { timestamp })).resolves.toEqual({
      id: "payment-1",
    });

    const body = JSON.stringify(submission);
    expect(lastInit().body).toBe(body);
    expect(lastHeaders()["X-Timestamp"]).toBe(String(timestamp));
    await expect(
      signRequest(
        { timestamp, method: "POST", path: "/api/payments/submit", body },
        "test-secret"
      )
    ).resolves.toBe(lastHeaders()["X-Signature"]);
  });

  it("signs with the empty-body hash, matching the server's canonical string", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: null }));

    await apiGet("/api/tips/leaderboard/opt-out", { signed: true });

    const timestamp = lastHeaders()["X-Timestamp"];
    expect(timestamp).toMatch(/^\d+$/);
    const canonical = await buildCanonicalString({
      timestamp,
      method: "GET",
      path: "/api/tips/leaderboard/opt-out",
    });
    const signed = await signRequest(
      { timestamp, method: "GET", path: "/api/tips/leaderboard/opt-out" },
      "test-secret"
    );
    expect(signed).toBe(lastHeaders()["X-Signature"]);
    expect(canonical.split(".")[1]).toBe("GET");
  });

  it("surfaces the backend signature error codes to the caller", async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse({ error: "Signature expired", code: "expired_signature" }, { ok: false, status: 401 })
    );

    const error = await captureError(
      submitSignedPayment({ senderPublicKey: "G", recipientPublicKey: "H", amount: "1" })
    );
    expect(error.code).toBe("expired_signature");
    expect(error.status).toBe(401);
  });

  it("keeps the payment fallback message when the server sends no error", async () => {
    fetchMock().mockResolvedValueOnce(unparseableResponse({ status: 500 }));

    const error = await captureError(
      submitSignedPayment({ senderPublicKey: "G", recipientPublicKey: "H", amount: "1" })
    );
    expect(error.message).toBe("Payment submission failed");
  });
});
