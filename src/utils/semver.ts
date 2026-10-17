/**
 * 语义化版本比较工具（SemVer 2.0.0 的子集）。
 *
 * 仅解析 `major.minor.patch` 与可选的 `-prerelease` / `+build` 后缀，
 * 供更新流程判断「远端版本是否比当前版本更新」。不依赖任何第三方库。
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识（如 `beta.1` → `["beta", "1"]`）；无则为空数组。 */
  prerelease: string[];
}

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** 解析版本字符串；格式非法时返回 null。 */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(raw.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** 版本字符串是否合法（可安全用于比较）。 */
export function isValidVersion(raw: string): boolean {
  return parseVersion(raw) !== null;
}

/** 是否为预发布版本（带 `-prerelease` 后缀）。 */
export function isPrerelease(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed !== null && parsed.prerelease.length > 0;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) {
    return 0;
  }
  // 正式版优先级高于同号预发布版。
  if (a.length === 0) {
    return 1;
  }
  if (b.length === 0) {
    return -1;
  }
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) {
      return -1;
    }
    if (right === undefined) {
      return 1;
    }
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) {
        return diff > 0 ? 1 : -1;
      }
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (left !== right) {
      return left > right ? 1 : -1;
    }
  }
  return 0;
}

/**
 * 比较两个版本号：`a` 大于 `b` 返回正数，小于返回负数，相等返回 0。
 * 任一版本格式非法时抛出错误，避免把非法值当作「更新」。
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    throw new Error(`无法比较的版本号：${a} / ${b}`);
  }
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * `candidate` 是否严格比 `current` 更新。
 * 任一版本格式非法时返回 false（宁可判定为「无更新」，也不误报）。
 */
export function isVersionNewer(candidate: string, current: string): boolean {
  if (!parseVersion(candidate) || !parseVersion(current)) {
    return false;
  }
  return compareVersions(candidate, current) > 0;
}
