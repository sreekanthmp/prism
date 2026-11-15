import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECONNECT_MS, SILENT_MS } from "./connection";
import { base, FakeSocket, fakeFactory, variant } from "./test/helpers";
import { defaultUrl, useConnection, type SocketFactory } from "./useConnection";

const URL = "ws://prism.test/ws";
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const send = (data: unknown) => act(() => { FakeSocket.last.send(data); });
const drop = () => act(() => { FakeSocket.last.drop(); });
const mount = () => renderHook(() => useConnection(URL, fakeFactory));

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});
afterEach(() => vi.useRealTimers());

describe("the connection", () => {
  it("opens one socket, to the address it was given, and is loading until a snapshot arrives", () => {
    const { result } = mount();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.last.url).toBe(URL);
    expect(result.current).toEqual({ conn: "loading", snapshot: null, tries: 1 });
  });

  it("a snapshot makes it live", () => {
    const { result } = mount();
    send(base);
    expect(result.current.conn).toBe("live");
    expect(result.current.snapshot?.server_time).toBe(base.server_time);
    expect(result.current.tries).toBe(0);
  });

  it("never opens a second socket, however often it redraws or a snapshot arrives", () => {
    const { rerender } = mount();
    for (let i = 0; i < 5; i++) {
      send(base);
      rerender();
    }
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("goes stale after exactly SILENT_MS of silence, not before", () => {
    const { result } = mount();
    send(base);
    advance(SILENT_MS - 1);
    expect(result.current.conn).toBe("live");
    advance(1);
    expect(result.current.conn).toBe("stale");
    expect(result.current.snapshot?.server_time).toBe(base.server_time); // the last snapshot is kept for inspection
  });

  it("every snapshot starts the silence timer again (this is not polling)", () => {
    const { result } = mount();
    send(base);
    for (let i = 0; i < 4; i++) {
      advance(SILENT_MS - 1000);
      send(variant((s) => { s.server_time += i + 1; }));
    }
    expect(result.current.conn).toBe("live");
    advance(SILENT_MS);
    expect(result.current.conn).toBe("stale");
  });

  it("a snapshot after the silence makes it live again, from that snapshot alone", () => {
    const { result } = mount();
    send(base);
    advance(SILENT_MS);
    expect(result.current.conn).toBe("stale");
    const later = variant((s) => { s.server_time += 60; });
    send(later);
    expect(result.current.conn).toBe("live");
    expect(result.current.snapshot?.server_time).toBe(later.server_time);
    advance(SILENT_MS - 1);
    expect(result.current.conn).toBe("live");
  });

  it("a closed socket makes it stale at once and opens a new one after RECONNECT_MS, not before", () => {
    const { result } = mount();
    send(base);
    drop();
    expect(result.current.conn).toBe("stale");
    advance(RECONNECT_MS - 1);
    expect(FakeSocket.all).toHaveLength(1);
    advance(1);
    expect(FakeSocket.all).toHaveLength(2);
    expect(result.current.conn).toBe("stale"); // still stale: a socket is not a snapshot
    send(variant((s) => { s.server_time += 3; }));
    expect(result.current.conn).toBe("live");
  });

  it("a server that cannot be reached is 'loading' with a growing count of attempts, never stale", () => {
    const { result } = mount();
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(result.current).toEqual({ conn: "loading", snapshot: null, tries: attempt });
      drop();
      advance(RECONNECT_MS);
    }
    expect(FakeSocket.all).toHaveLength(5);
  });

  it("a message that is not a snapshot is noise: it does not make the page live and does not restart the silence timer", () => {
    const { result } = mount();
    send("not json {");
    send(JSON.stringify("a string"));
    send({ hello: "world" });
    send({ server_time: 1, connection: {}, health: {} }); // no instruments: not a snapshot
    send({ server_time: "later", connection: {}, health: {}, instruments: [] });
    expect(result.current.conn).toBe("loading");
    send(base);
    advance(3000);
    send("noise");
    send({ detail: "Not Found" });
    advance(SILENT_MS - 3000);
    expect(result.current.conn).toBe("stale"); // the noise did not keep it alive
  });

  it("ignores whatever an old socket still says after a new one has been opened", () => {
    const { result } = mount();
    const first = FakeSocket.last;
    send(base);
    drop();
    advance(RECONNECT_MS);
    act(() => first.send(variant((s) => { s.server_time += 99; })));
    expect(result.current.conn).toBe("stale");
    expect(result.current.snapshot?.server_time).toBe(base.server_time);
  });

  it("leaving the page closes the socket, clears every timer and never reconnects", () => {
    const { result, unmount } = mount();
    send(base);
    const socket = FakeSocket.last;
    unmount();
    expect(socket.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // the silence timer is cleared
    advance(SILENT_MS * 3);
    expect(FakeSocket.all).toHaveLength(1);
    expect(result.current.conn).toBe("live"); // nothing moved after it left
  });

  it("leaving the page while a reconnect is pending cancels it", () => {
    const { unmount } = mount();
    send(base);
    drop();
    expect(vi.getTimerCount()).toBe(1); // the reconnect is waiting
    unmount();
    expect(vi.getTimerCount()).toBe(0); // ... and leaving cancels it
    advance(RECONNECT_MS * 3);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("a browser that refuses to open the socket is tried again like a closed one", () => {
    let calls = 0;
    const flaky: SocketFactory = (url) => {
      calls += 1;
      if (calls < 3) throw new Error("refused");
      return fakeFactory(url);
    };
    const { result } = renderHook(() => useConnection(URL, flaky));
    expect(calls).toBe(1);
    advance(RECONNECT_MS);
    expect(calls).toBe(2);
    advance(RECONNECT_MS);
    expect(calls).toBe(3);
    expect(FakeSocket.all).toHaveLength(1);
    send(base);
    expect(result.current.conn).toBe("live");
    expect(result.current.tries).toBe(0);
  });

  it("builds its address from the page's own: ws for http, wss for https", () => {
    expect(defaultUrl()).toBe(`ws://${location.host}/ws`);
    const real = window.location;
    Object.defineProperty(window, "location", { value: { protocol: "https:", host: "prism.local:8000" }, configurable: true });
    try {
      expect(defaultUrl()).toBe("wss://prism.local:8000/ws");
    } finally {
      Object.defineProperty(window, "location", { value: real, configurable: true });
    }
  });
});

describe("what else is told, as it happens (the alerts)", () => {
  const listened = () => {
    const seen: number[] = [];
    const lost: number[] = [];
    const listeners = { onSnapshot: (s: { server_time: number }) => seen.push(s.server_time), onLost: (s: { server_time: number }) => lost.push(s.server_time) };
    return { seen, lost, ...renderHook(() => useConnection(URL, fakeFactory, listeners)) };
  };
  const at = (n: number) => variant((s) => { s.server_time = base.server_time + n; });

  it("every snapshot is told, in order, the moment it arrives, even when two come before the page is redrawn", () => {
    const { seen } = listened();
    act(() => {
      FakeSocket.last.send(at(1));
      FakeSocket.last.send(at(2)); // (one redraw for both: the listener still meets both)
      FakeSocket.last.send(at(3));
    });
    expect(seen).toEqual([base.server_time + 1, base.server_time + 2, base.server_time + 3]);
  });

  it("noise is not a snapshot: it is not told", () => {
    const { seen } = listened();
    send("not json");
    send({ hello: "world" });
    expect(seen).toEqual([]);
  });

  it("a link that was live and is lost is told once, with the last snapshot, by a closed socket or by silence", () => {
    const { lost } = listened();
    send(at(1));
    drop();
    expect(lost).toEqual([base.server_time + 1]);
    advance(SILENT_MS * 3); // (silence on top of a closed socket is the same loss)
    expect(lost).toHaveLength(1);
  });

  it("a socket that closes again before any snapshot has come is the same loss, not a new one", () => {
    const { lost } = listened();
    send(at(1));
    drop(); // the link is lost
    advance(RECONNECT_MS); // ... the page tries again: a new socket
    drop(); // ... which closes without a snapshot having come
    advance(RECONNECT_MS);
    drop();
    expect(lost).toEqual([base.server_time + 1]);
  });

  it("silence is a loss too, and the next snapshot makes the next loss a new one", () => {
    const { lost } = listened();
    send(at(1));
    advance(SILENT_MS);
    expect(lost).toEqual([base.server_time + 1]);
    advance(RECONNECT_MS);
    send(at(2));
    drop();
    expect(lost).toEqual([base.server_time + 1, base.server_time + 2]);
  });

  it("a page that never had a snapshot has nothing to tell about losing", () => {
    const { lost } = listened();
    drop();
    advance(RECONNECT_MS);
    drop();
    expect(lost).toEqual([]);
  });

  it("a listener that fails is logged and does not take the connection down", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useConnection(URL, fakeFactory, {
        onSnapshot: () => {
          throw new Error("alerts broke");
        },
        onLost: () => {
          throw new Error("alerts broke");
        },
      }),
    );
    send(base);
    expect(result.current.conn).toBe("live");
    drop();
    expect(result.current.conn).toBe("stale");
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("works with no listeners at all, and uses the ones it has now rather than the ones it started with", () => {
    const first: number[] = [];
    const second: number[] = [];
    const { rerender } = renderHook(({ on }: { on: number[] }) => useConnection(URL, fakeFactory, { onSnapshot: (s) => on.push(s.server_time) }), { initialProps: { on: first } });
    send(at(1));
    rerender({ on: second });
    send(at(2));
    expect(first).toEqual([base.server_time + 1]);
    expect(second).toEqual([base.server_time + 2]);
    expect(FakeSocket.all).toHaveLength(1); // (new listeners are not a new connection)
    expect(() => renderHook(() => useConnection(URL, fakeFactory))).not.toThrow();
  });
});
