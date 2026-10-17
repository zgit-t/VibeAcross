import { describe, expect, it } from "vitest";
import {
  decodePublicKey,
  decodeSignature,
  generateMinisignKeyPair,
  signMinisign,
  signedVersion,
  verifyMinisign,
} from "./minisign.mjs";

const VERSION = "1.2.0";
const trustedComment = `timestamp:1792262063\tfile:VibeAcross_${VERSION}_x64-setup.exe\tversion:${VERSION}`;

function fixture(data = Buffer.from("installer-bytes"), algorithm = "ED") {
  const pair = generateMinisignKeyPair({ algorithm });
  const signature = signMinisign(data, {
    privateKey: pair.privateKey,
    keyId: pair.keyId,
    algorithm,
    trustedComment,
  });
  return { pair, data, signature };
}

function replaceTrustedComment(signatureBase64, nextComment) {
  const lines = Buffer.from(signatureBase64, "base64").toString("utf8").split("\n");
  lines[2] = `trusted comment: ${nextComment}`;
  return Buffer.from(lines.join("\n"), "utf8").toString("base64");
}

describe("minisign 验签", () => {
  it("能够校验自己生成的预哈希（ED）签名", () => {
    const { pair, data, signature } = fixture();
    const result = verifyMinisign({ publicKey: pair.publicKey, signature, data });
    expect(result.valid).toBe(true);
    expect(result.version).toBe(VERSION);
  });

  it("能够校验非预哈希（Ed）签名", () => {
    const { pair, data, signature } = fixture(Buffer.from("legacy"), "Ed");
    expect(verifyMinisign({ publicKey: pair.publicKey, signature, data }).valid).toBe(true);
  });

  it("内容被篡改时验签失败", () => {
    const { pair, data, signature } = fixture();
    const tampered = Buffer.from(data);
    tampered[0] ^= 0xff;
    const result = verifyMinisign({ publicKey: pair.publicKey, signature, data: tampered });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Ed25519");
  });

  it("可信注释被篡改时全局签名失败", () => {
    const { pair, data, signature } = fixture();
    const forged = replaceTrustedComment(signature, `version:9.9.9`);
    const result = verifyMinisign({ publicKey: pair.publicKey, signature: forged, data });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("全局签名");
  });

  it("公钥与签名 keyId 不匹配时拒绝", () => {
    const { data, signature } = fixture();
    const other = generateMinisignKeyPair();
    const result = verifyMinisign({ publicKey: other.publicKey, signature, data });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("keyId");
  });

  it("能从可信注释中提取版本号", () => {
    expect(signedVersion(trustedComment)).toBe(VERSION);
    expect(signedVersion("timestamp:1\tfile:a")).toBeNull();
  });

  it("拒绝格式错误的公钥与签名", () => {
    expect(() => decodePublicKey("")).toThrow();
    expect(() => decodePublicKey(Buffer.from("short").toString("base64"))).toThrow();
    expect(() => decodeSignature(Buffer.from("only\none").toString("base64"))).toThrow();
  });
});
