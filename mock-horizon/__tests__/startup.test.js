/**
 * mock-horizon/__tests__/startup.test.js
 * The mock as a program: its module exports and the `node server.js` entry
 * point the Docker image and `docker-compose.test.yml` rely on.
 *
 * Issue #1420
 */

"use strict";

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const { createMockHorizonApp, app } = require("../server");

const SERVER_PATH = path.join(__dirname, "..", "server.js");

/**
 * Picks a free TCP port, so the test does not depend on a fixed one.
 *
 * @returns {Promise<number>} A port that was free a moment ago
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();

      server.close(() => resolve(port));
    });
  });
}

/**
 * Waits until the mock answers on the given port.
 *
 * @param {number} port Port the mock listens on
 * @param {number} [timeoutMs] How long to wait before giving up
 * @returns {Promise<void>} Resolves once the mock is reachable
 */
async function waitForHealth(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // The server is not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Mock Horizon did not become healthy on port ${port}`);
}

describe("mock-horizon startup (#1420)", () => {
  describe("Module exports", () => {
    it("exports a factory that builds an Express app", () => {
      expect(typeof createMockHorizonApp).toBe("function");

      const created = createMockHorizonApp();

      expect(typeof created.listen).toBe("function");
    });

    it("exports a default app", () => {
      expect(typeof app.listen).toBe("function");
    });
  });

  describe("node server.js", () => {
    let child;
    let port;

    beforeAll(async () => {
      port = await findFreePort();

      child = spawn(process.execPath, [SERVER_PATH], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      await waitForHealth(port);
    }, 30000);

    afterAll(() => {
      if (child) {
        child.kill();
      }
    });

    it("serves the health endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ status: "ok" });
    });

    it("serves the Horizon endpoints", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/accounts/G_TEST_ACCOUNT`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        account_id: "G_TEST_ACCOUNT",
      });
    });
  });
});
