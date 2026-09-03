import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ForbiddenImport {
  readonly sourceFile: string;
  readonly specifier: string;
}

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const collectTypeScriptFiles = (
  directory: string,
  controlPlaneRoot: string,
): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      if (resolve(path) === resolve(controlPlaneRoot)) continue;
      files.push(...collectTypeScriptFiles(path, controlPlaneRoot));
      continue;
    }

    if (TYPESCRIPT_EXTENSIONS.has(extname(entry))) files.push(path);
  }

  return files;
};

const moduleSpecifiers = (sourceFilePath: string): string[] => {
  const source = readFileSync(sourceFilePath, "utf8");
  const parsed = ts.createSourceFile(
    sourceFilePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return specifiers;
};

const resolvesInside = (candidate: string, root: string): boolean => {
  const normalizedCandidate = resolve(candidate);
  const normalizedRoot = resolve(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  );
};

const findForbiddenKernelImports = (sourceRoot: string): ForbiddenImport[] => {
  const controlPlaneRoot = resolve(sourceRoot, "control-plane");
  const violations: ForbiddenImport[] = [];

  for (const sourceFile of collectTypeScriptFiles(sourceRoot, controlPlaneRoot)) {
    for (const specifier of moduleSpecifiers(sourceFile)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(sourceFile), specifier);
      if (resolvesInside(target, controlPlaneRoot)) {
        violations.push({ sourceFile, specifier });
      }
    }
  }

  return violations;
};

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("kernel/control-plane architecture boundary", () => {
  it("prevents existing Sandcastle source from importing the control plane", () => {
    expect(findForbiddenKernelImports(SOURCE_ROOT)).toEqual([]);
  });

  it("detects a reverse dependency from kernel source into the control plane", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "sandcastle-boundary-"));

    try {
      mkdirSync(join(fixtureRoot, "control-plane"), { recursive: true });
      writeFileSync(
        join(fixtureRoot, "control-plane", "planner.ts"),
        "export const planner = true;\n",
      );
      writeFileSync(
        join(fixtureRoot, "kernel.ts"),
        'import { planner } from "./control-plane/planner.js";\nvoid planner;\n',
      );

      expect(findForbiddenKernelImports(fixtureRoot)).toEqual([
        {
          sourceFile: join(fixtureRoot, "kernel.ts"),
          specifier: "./control-plane/planner.js",
        },
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
