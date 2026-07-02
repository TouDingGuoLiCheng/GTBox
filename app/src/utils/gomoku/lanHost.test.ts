import { describe, expect, it } from "vitest";
import {
  createHostSession,
  hostApplyLocalMove,
  hostHandleGuestMove,
  hostStartGame as emitHostStart,
} from "./lanHost";

describe("lanHost", () => {
  it("starts with empty board and allows host then guest moves", () => {
    let session = createHostSession("房主", 60, 600, "tok");
    const start = emitHostStart(session);
    session = start.session;

    const hostMove = hostApplyLocalMove(session, 9, 9);
    expect(hostMove.error).toBeUndefined();
    session = hostMove.session;
    expect(session.moveCount).toBe(1);

    const guestMove = hostHandleGuestMove(session, 9, 10);
    expect(guestMove.error).toBeUndefined();
    session = guestMove.session;
    expect(session.moveCount).toBe(2);
  });

  it("rejects occupied cell", () => {
    let session = createHostSession("房主", 60, 600, "tok");
    session = emitHostStart(session).session;
    session = hostApplyLocalMove(session, 9, 9).session;
    const dup = hostHandleGuestMove(session, 9, 9);
    expect(dup.error).toContain("已有棋子");
  });
});
