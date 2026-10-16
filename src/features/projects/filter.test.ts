import { describe, expect, it } from "vitest";
import { filterProjects } from "./filter";
import type { Project } from "../../types/domain";

function project(overrides: Partial<Project>): Project {
  return {
    id: "id",
    name: "Project",
    path: "C:\\work\\Project",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: null,
    description: null,
    isFavorite: false,
    defaultToolId: null,
    pathExists: true,
    ...overrides,
  };
}

const alpha = project({ id: "a", name: "Alpha", path: "C:\\work\\Alpha" });
const beta = project({
  id: "b",
  name: "Beta",
  path: "C:\\projects\\beta-app",
  isFavorite: true,
});

describe("filterProjects", () => {
  it("returns all projects when no query and favorites off", () => {
    expect(filterProjects([alpha, beta], "", false)).toEqual([alpha, beta]);
  });

  it("matches by name case-insensitively", () => {
    expect(filterProjects([alpha, beta], "alph", false)).toEqual([alpha]);
  });

  it("matches by path case-insensitively", () => {
    expect(filterProjects([alpha, beta], "BETA-APP", false)).toEqual([beta]);
  });

  it("trims the query before matching", () => {
    expect(filterProjects([alpha, beta], "   beta  ", false)).toEqual([beta]);
  });

  it("keeps only favorites when favoritesOnly is set", () => {
    expect(filterProjects([alpha, beta], "", true)).toEqual([beta]);
  });

  it("combines keyword and favorites filters", () => {
    expect(filterProjects([alpha, beta], "work", true)).toEqual([]);
    expect(filterProjects([alpha, beta], "beta", true)).toEqual([beta]);
    expect(filterProjects([alpha, beta], "alpha", true)).toEqual([]);
  });
});
