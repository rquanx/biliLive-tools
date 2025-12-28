import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { describe, it, expect, vi } from "vitest";

import DouYinDanmaClient from "../src/index";
import protobuf from "../src/proto.js";
import { mockDanma } from "./mock.js";

const encoderMap = {
  // @ts-ignore
  WebcastChatMessage: protobuf.douyin.ChatMessage,
  // @ts-ignore
  WebcastPrivilegeScreenChatMessage: protobuf.douyin.PrivilegeScreenChatMessage,
  // @ts-ignore
  WebcastScreenChatMessage: protobuf.douyin.ScreenChatMessage,
} as const;

function sanitizeCommon(common: any) {
  const { method, msgId, roomId, isShowMsg, priorityScore, appId } = common ?? {};
  return { method, msgId, roomId, isShowMsg, priorityScore, appId };
}

function sanitizeUser(user: any) {
  if (!user) return {};
  const { id, shortId, nickName, gender, AvatarThumb } = user;
  return { id, shortId, nickName, gender, AvatarThumb };
}

function sanitizeEntry(entry: any) {
  const { common, user, content, eventTime } = entry;
  const sanitized: Record<string, unknown> = {
    common: sanitizeCommon(common),
    user: sanitizeUser(user),
  };

  if (content != null) sanitized.content = content;
  if (eventTime != null) sanitized.eventTime = eventTime;

  return sanitized;
}

function encodePayload(entry: any) {
  const encoder = encoderMap[entry.common.method as keyof typeof encoderMap];
  if (!encoder) {
    throw new Error(`Unsupported method: ${entry.common.method}`);
  }

  const sanitized = sanitizeEntry(entry);
  return encoder.encode(encoder.fromObject(sanitized as any)).finish();
}

function buildPushFrame(entries: any[]) {
  // @ts-ignore
  const { PushFrame, Response, Message } = protobuf.douyin;
  const messagesList = entries.map((entry) =>
    Message.create({
      method: entry.common.method,
      payload: encodePayload(entry),
    }),
  );

  const responseBuffer = Response.encode(
    Response.create({
      messagesList,
      needAck: false,
    }),
  ).finish();

  const frame = PushFrame.create({
    logId: 1,
    payload: gzipSync(Buffer.from(responseBuffer)),
  });

  return Buffer.from(PushFrame.encode(frame).finish());
}

describe("DouYinDanmaClient.decode", () => {
  it("should emit privilege screen chat and floating screen chat messages", async () => {
    const client = new DouYinDanmaClient("123", { autoStart: false });
    const privilegeMock = mockDanma[0];
    const screenMock = mockDanma[1];

    const privilegeSpy = vi.fn();
    const screenSpy = vi.fn();
    const messageSpy = vi.fn();

    client.on("privilegeScreenChat", privilegeSpy);
    client.on("screenChat", screenSpy);
    client.on("message", messageSpy);

    const buffer = buildPushFrame([privilegeMock, screenMock]);
    await client.decode(buffer);

    expect(privilegeSpy).toHaveBeenCalledOnce();
    expect(privilegeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: privilegeMock.content,
        common: expect.objectContaining({ method: "WebcastPrivilegeScreenChatMessage" }),
        user: expect.objectContaining({ nickName: privilegeMock.user.nickName }),
      }),
    );

    expect(screenSpy).toHaveBeenCalledOnce();
    expect(screenSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: screenMock.content,
        eventTime: screenMock.eventTime,
        common: expect.objectContaining({ method: "WebcastScreenChatMessage" }),
        user: expect.objectContaining({ nickName: screenMock.user.nickName }),
      }),
    );
    expect(messageSpy).toHaveBeenCalledTimes(2);
  });

  it("should still emit regular chat messages", async () => {
    const client = new DouYinDanmaClient("123", { autoStart: false });
    const chatMock = mockDanma[2];

    const chatSpy = vi.fn();
    client.on("chat", chatSpy);

    const buffer = buildPushFrame([chatMock]);
    await client.decode(buffer);

    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: chatMock.content,
        common: expect.objectContaining({ method: "WebcastChatMessage" }),
        user: expect.objectContaining({ nickName: chatMock.user.nickName }),
      }),
    );
  });
});
