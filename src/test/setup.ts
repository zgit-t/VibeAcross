import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 每个用例结束后清理挂载的 DOM，避免相互影响。
afterEach(() => {
  cleanup();
});
