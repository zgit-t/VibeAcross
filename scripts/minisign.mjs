/**
 * 最小化的 minisign 验签实现（仅依赖 Node 内置 crypto）。
 *
 * Tauri 的更新签名由其内置的 minisign 生成：`.sig` 文件是「minisign 签名文件文本」
 * 的 base64，公钥（写入 tauri.conf.json 的 `plugins.updater.pubkey`）是
 * 「minisign 公钥文件文本」的 base64。
 *
 * 校验规则与 `tauri-plugin-updater` 实际使用的 `minisign-verify` 一致：
 *   - 公钥 = algorithm(2) || keyId(8) || Ed25519 key(32)，共 42 字节
 *   - 签名 = signature_algorithm(2) || keyId(8) || signature(64)，共 74 字节
 *   - signature_algorithm 为 "Ed"(0x45 0x64) 表示直接签名原文，
 *     为 "ED"(0x45 0x44) 表示对原文的 BLAKE2b-512 摘要签名（Tauri 使用此方式）
 *   - Ed25519 校验对象就是「原文或其摘要」，不附加 algorithm/keyId 前缀
 *   - 全局签名 = Ed25519(signature(64) || trusted comment 文本)，与摘要模式无关
 */

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

/** Ed25519 SPKI DER 前缀，用于把 32 字节裸公钥包装成 KeyObject。 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const ALGORITHM_LEGACY = "Ed";
const ALGORITHM_PREHASHED = "ED";
const TRUSTED_COMMENT_PREFIX = "trusted comment: ";

function decodeLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 解析 minisign 公钥（base64 文本），返回算法、keyId 与 32 字节公钥。 */
export function decodePublicKey(publicKeyBase64) {
  if (typeof publicKeyBase64 !== "string" || publicKeyBase64.trim() === "") {
    throw new Error("minisign 公钥为空");
  }
  const text = Buffer.from(publicKeyBase64, "base64").toString("utf8");
  const lines = decodeLines(text);
  if (lines.length < 2) {
    throw new Error("minisign 公钥格式无效");
  }
  const raw = Buffer.from(lines[lines.length - 1], "base64");
  if (raw.length !== 42) {
    throw new Error(`minisign 公钥长度无效：${raw.length}`);
  }
  const algorithm = raw.subarray(0, 2).toString("ascii");
  if (algorithm !== ALGORITHM_LEGACY && algorithm !== ALGORITHM_PREHASHED) {
    throw new Error(`不支持的 minisign 公钥算法：${algorithm}`);
  }
  return { algorithm, keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

/** 解析 minisign 签名（base64 文本），返回算法、keyId、签名与可信注释。 */
export function decodeSignature(signatureBase64) {
  if (typeof signatureBase64 !== "string" || signatureBase64.trim() === "") {
    throw new Error("minisign 签名为空");
  }
  const text = Buffer.from(signatureBase64, "base64").toString("utf8");
  const lines = decodeLines(text);
  if (lines.length < 4) {
    throw new Error("minisign 签名格式无效");
  }
  const raw = Buffer.from(lines[1], "base64");
  if (raw.length !== 74) {
    throw new Error(`minisign 签名长度无效：${raw.length}`);
  }
  const globalSignature = Buffer.from(lines[3], "base64");
  if (globalSignature.length !== 64) {
    throw new Error(`minisign 全局签名长度无效：${globalSignature.length}`);
  }
  const algorithm = raw.subarray(0, 2).toString("ascii");
  if (algorithm !== ALGORITHM_LEGACY && algorithm !== ALGORITHM_PREHASHED) {
    throw new Error(`不支持的 minisign 签名算法：${algorithm}`);
  }
  return {
    algorithm,
    prehashed: algorithm === ALGORITHM_PREHASHED,
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10, 74),
    globalSignature,
    trustedComment: lines[2],
  };
}

/** 取出签名可信注释中的 `version:` 字段（Tauri 用它绑定发布版本）。 */
export function signedVersion(trustedComment) {
  const text = trustedComment.startsWith(TRUSTED_COMMENT_PREFIX)
    ? trustedComment.slice(TRUSTED_COMMENT_PREFIX.length)
    : trustedComment;
  for (const field of text.split("\t")) {
    if (field.startsWith("version:")) {
      return field.slice("version:".length);
    }
  }
  return null;
}

function toKeyObject(rawKey) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
    format: "der",
    type: "spki",
  });
}

/**
 * 校验 `signature` 是否是 `publicKey` 对 `data` 的有效签名。
 * 返回 { valid, reason, trustedComment, version }。
 */
export function verifyMinisign({ publicKey, signature, data }) {
  const key = typeof publicKey === "string" ? decodePublicKey(publicKey) : publicKey;
  const sig = typeof signature === "string" ? decodeSignature(signature) : signature;
  const base = { trustedComment: sig.trustedComment, version: signedVersion(sig.trustedComment) };

  if (!key.keyId.equals(sig.keyId)) {
    return { ...base, valid: false, reason: "公钥与签名的 keyId 不匹配" };
  }

  const keyObject = toKeyObject(key.key);
  const message = sig.prehashed
    ? createHash("blake2b512").update(data).digest()
    : data;
  if (!verify(null, message, keyObject, sig.signature)) {
    return { ...base, valid: false, reason: "Ed25519 验签失败（文件内容与签名不符）" };
  }

  const trustedText = sig.trustedComment.startsWith(TRUSTED_COMMENT_PREFIX)
    ? sig.trustedComment.slice(TRUSTED_COMMENT_PREFIX.length)
    : sig.trustedComment;
  const globalMessage = Buffer.concat([sig.signature, Buffer.from(trustedText, "utf8")]);
  if (!verify(null, globalMessage, keyObject, sig.globalSignature)) {
    return { ...base, valid: false, reason: "全局签名验签失败（可信注释被篡改）" };
  }

  return { ...base, valid: true, reason: null };
}

/** 生成一对 minisign 格式的 Ed25519 密钥（仅供本地测试/自检使用）。 */
export function generateMinisignKeyPair({ algorithm = ALGORITHM_PREHASHED, keyId = randomBytes(8) } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyBlock = Buffer.concat([Buffer.from(algorithm, "ascii"), keyId, rawPublicKey]);
  const publicKeyText =
    `untrusted comment: minisign public key ${keyId.toString("hex").toUpperCase()}\n` +
    `${keyBlock.toString("base64")}\n`;
  return {
    publicKey: Buffer.from(publicKeyText, "utf8").toString("base64"),
    privateKey,
    keyId,
    algorithm,
  };
}

/** 生成 minisign 格式签名（base64 文本），仅供本地测试/自检使用。 */
export function signMinisign(
  data,
  { privateKey, keyId, algorithm = ALGORITHM_PREHASHED, trustedComment = "" },
) {
  const message =
    algorithm === ALGORITHM_PREHASHED ? createHash("blake2b512").update(data).digest() : data;
  const signature = sign(null, message, privateKey);
  const keyBlock = Buffer.concat([Buffer.from(algorithm, "ascii"), keyId, signature]);
  const globalSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(trustedComment, "utf8")]),
    privateKey,
  );
  const text =
    "untrusted comment: signature from minisign secret key\n" +
    `${keyBlock.toString("base64")}\n` +
    `trusted comment: ${trustedComment}\n` +
    `${globalSignature.toString("base64")}\n`;
  return Buffer.from(text, "utf8").toString("base64");
}
