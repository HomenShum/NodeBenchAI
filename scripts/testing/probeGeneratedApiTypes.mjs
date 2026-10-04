import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

// A fixed hosted observation of the existing app program, never a replacement gate.
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "../..");
const MIB = 1024 * 1024;
const REPORT_CAP = MIB;
const CHILD_CAP = 960 * 1024;
const FILE_CAP = 2 * MIB;
const started = performance.now();
const deadline = started + 600000;
const generated = ["api.d.ts", "server.d.ts", "dataModel.d.ts"];
const fixedInputs = [
  ...generated.map((name) => `backend/convex/_generated/${name}`),
  "tsconfig.app.json", "backend/convex/tsconfig.json", ".github/workflows/ci.yml",
  "scripts/testing/captureAppTypecheck.mjs", "scripts/testing/probeGeneratedApiTypes.mjs",
  "package.json", "node_modules/typescript/package.json", "node_modules/convex/package.json",
  "node_modules/typescript/lib/typescript.js",
];
const locations = [
  ["backend/convex/_generated/api.d.ts", "fullApi"],
  ["backend/convex/_generated/api.d.ts", "api"],
  ["backend/convex/_generated/api.d.ts", "internal"],
  ["backend/convex/_generated/dataModel.d.ts", "DataModel"],
  ["backend/convex/_generated/server.d.ts", "query"],
  ["backend/convex/_generated/server.d.ts", "internalQuery"],
  ["backend/convex/domains/search/analytics/analytics.ts", "getRoadmapAnalytics"],
  ["backend/convex/domains/integrations/gmail.ts", "getUserPreferencesForGmail"],
];
const aggregationInputHashes = {
  "backend/convex/_generated/api.d.ts": "28807c921bfe1d71ce2b0ce742a59355b3425948540ea4ecd6038ec8380f67f5",
  "backend/convex/_generated/server.d.ts": "2b536ee08d434dd044efe0302aeaf4ccb00cd08af10c9f8c7bc7a6734e4aa49b",
  "backend/convex/_generated/dataModel.d.ts": "db177073d16a4393c7a96bcdc3a2a904e88c2432d54d138ca7715cc431982c17",
  "node_modules/convex/dist/esm-types/server/api.d.ts": "642f76dd6a1faac0efaabebedfb07e77c38ecaa0360846f55295eda4d537b46c",
  "node_modules/convex/dist/esm-types/server/registration.d.ts": "28e694a7831bb0d9ed97f4b78e953877b59ad3773b94d054abbc8af712657315",
  "node_modules/convex/dist/esm-types/server/index.d.ts": "3dde8f95d66278d89a3f896f7f9f7b05b3897ff040cfea68079b6e6e028a67b7",
  "node_modules/convex/dist/esm-types/server/schema.d.ts": "ed2a07ef99205ee94494156a48d191bbc25d03c74667ad488a66c241f662a8e7",
  "node_modules/convex/dist/esm-types/values/index.d.ts": "62f048e2a1ab85c8f06cb2eb2a539d5a245f8e42829299f7ced48bfffea87e66",
  "node_modules/convex/dist/esm-types/values/validator.d.ts": "c66933f5c7824921c3a0e09f41b8c857d3f0e9570c264ef241d62befcbd3c775",
  "node_modules/convex/dist/esm-types/type_utils.d.ts": "c9b10f272dcd513115c421ddea5460a365a4810106821ffa2dec9a26446610fe",
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const budget = () => { if (performance.now() >= deadline) throw new Error("budget_exhausted"); };
const sameStat = (a, b) => ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every((key) => a[key] === b[key]);
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const label = (error) => String(error.code || error.message || "probe_failed").slice(0, 256);
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
const encode = (value, cap) => {
  const bytes = Buffer.from(JSON.stringify(sorted(value)) + "\n");
  if (bytes.length > cap) throw new Error("report_limit");
  return bytes;
};
// Preserve TypeScript 5.9.3 system-host BOM decoding after our bounded read.
function compilerText(bytes) {
  if (bytes[0] === 254 && bytes[1] === 255) {
    const copy = Buffer.from(bytes);
    copy.subarray(0, copy.length & ~1).swap16();
    return copy.toString("utf16le", 2);
  }
  if (bytes[0] === 255 && bytes[1] === 254) return bytes.toString("utf16le", 2);
  return bytes.toString("utf8", bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0);
}

function readStable(file, cap = FILE_CAP) {
  budget();
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(cap)) throw new Error("input_not_bounded_regular_file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameStat(before, opened)) throw new Error("input_changed_on_open");
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      budget();
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw new Error("incomplete_input_read");
      offset += count;
    }
    if (!sameStat(opened, fs.fstatSync(fd, { bigint: true })) ||
        !sameStat(opened, fs.lstatSync(file, { bigint: true }))) throw new Error("input_changed_during_read");
    return { bytes, sha256: sha(bytes), identity: opened };
  } finally { fs.closeSync(fd); }
}

function compilerObservation() {
  let refusal = null;
  let readBytes = 0;
  let readCalls = 0;
  let metadataCalls = 0;
  const refuse = (reason, query = null) => {
    refusal ||= { code: reason, query };
    throw Object.assign(new Error(reason), { refusal });
  };
  const ancestors = [];
  for (let anchor = path.dirname(ROOT); ; anchor = path.dirname(anchor)) {
    if (ancestors.length === 16) return refuse("ancestor_anchor_limit");
    ancestors.push(anchor);
    if (anchor === path.dirname(anchor)) break;
  }
  const ancestorMetadataAllowed = (file) => ancestors.some((anchor) =>
    file === anchor || file === path.join(anchor, "package.json") || inside(path.join(anchor, "node_modules"), file));
  const privatePath = (file) => {
    const scoped = inside(ROOT, file) ? relative(file) : file.split(path.sep).join("/");
    return scoped.split("/").some((part) => part.startsWith(".") || part === "private") ||
      /(?:^|\/)(?:request\.private\.json|(?:package|npm-shrinkwrap|pnpm|yarn)[.-]lock[^/]*|(?:private|secrets?|credentials?|keys?|auth|tokens?|service-account)\.json)$/i.test(scoped);
  };
  const checked = (file, directory = false, operation = "metadata_query") => {
    budget();
    if (++metadataCalls > 500000) return refuse("metadata_limit");
    const absolute = path.resolve(file);
    const query = { operation, kind: directory ? "directory" : "file", requestedPathSha256: sha(Buffer.from(absolute)), existence: "not_probed" };
    const allowed = (target) => inside(ROOT, target) || (operation === "metadata_query" && ancestorMetadataAllowed(target));
    if (!allowed(absolute)) return refuse("outside_allowed_path", query);
    if (privatePath(absolute)) return refuse("private_hidden_or_lock_path", query);
    if (!directory && !/\.(?:[cm]?[jt]sx?|json)$/i.test(absolute)) return refuse("non_source_input", query);
    try {
      const resolved = fs.realpathSync(absolute);
      const resolvedQuery = { ...query, existence: "resolved_existing_path" };
      if (!allowed(resolved)) return refuse("resolved_outside_allowed_path", resolvedQuery);
      if (privatePath(resolved)) return refuse("resolved_private_hidden_or_lock_path", resolvedQuery);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") return refuse(label(error), error.refusal?.query || query);
    }
    return absolute;
  };
  let ancestorMetadataQueries = 0;
  const ancestorMetadataSamples = [];
  const metadataStatus = (file, directory) => {
    const absolute = checked(file, directory);
    let info;
    try { info = fs.statSync(absolute); }
    catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") return refuse(label(error));
    }
    if (!inside(ROOT, absolute)) {
      ancestorMetadataQueries++;
      if (ancestorMetadataSamples.length < 64) ancestorMetadataSamples.push({
        kind: directory ? "directory" : "file", requestedPathSha256: sha(Buffer.from(absolute)),
        status: !info ? "absent" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      });
    }
    return info;
  };
  const readFile = (file) => {
    if (!inside(ROOT, path.resolve(file))) {
      // TypeScript can ask readFile directly for an ancestor package.json.
      // Observe absence using metadata only; an existing body is never omitted.
      const info = metadataStatus(file, false);
      if (!info) return undefined;
      return refuse("external_file_contents_forbidden", {
        operation: "read_file", kind: "file", requestedPathSha256: sha(Buffer.from(path.resolve(file))), existence: "observed_existing_path",
      });
    }
    const absolute = checked(file, false, "read_file");
    if (++readCalls > 100000) return refuse("source_read_count_limit");
    try {
      const read = readStable(absolute);
      readBytes += read.bytes.length;
      if (readBytes > 256 * MIB) return refuse("source_read_byte_limit");
      return compilerText(read.bytes);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
      return refuse(label(error));
    }
  };
  const ts = createRequire(import.meta.url)(path.join(ROOT, "node_modules/typescript/lib/typescript.js"));
  if (ts.version !== "5.9.3") throw new Error("typescript_version_mismatch");
  const directoryEntries = (file) => {
    const absolute = checked(file, true, "directory_entries");
    let entries;
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }); }
    catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return { files: [], directories: [] }; throw error; }
    if (entries.length > 50000) return refuse("directory_entry_limit");
    const files = [], directories = [];
    for (const entry of entries) {
      // Merely enumerate child names. A directory is checked before descent,
      // and a file is checked before its bytes or existence are requested.
      const info = entry.isSymbolicLink() ? fs.statSync(checked(path.join(absolute, entry.name), true)) : entry;
      if (info.isFile()) files.push(entry.name);
      else if (info.isDirectory()) directories.push(entry.name);
    }
    return { files: files.sort(), directories: directories.sort() };
  };
  const hostIo = {
    readFile,
    fileExists: (file) => metadataStatus(file, false)?.isFile() || false,
    directoryExists: (file) => metadataStatus(file, true)?.isDirectory() || false,
    realpath: (file) => fs.realpathSync(checked(file, true)),
    getDirectories: (file) => {
      const absolute = checked(file, true);
      return directoryEntries(absolute).directories;
    },
    readDirectory: (file, extensions, excludes, includes, depth) => {
      // The same version-bound matcher used by TypeScript's system host; supply
      // checked directory access without changing include/exclude semantics.
      if (typeof ts.matchFiles !== "function") return refuse("typescript_matcher_unavailable");
      const result = ts.matchFiles(checked(file, true, "directory_entries"), extensions, excludes, includes, true, ROOT, depth, directoryEntries, hostIo.realpath);
      if (result.length > 50000) return refuse("source_file_count_limit");
      return result.map((entry) => checked(entry));
    },
    writeFile: () => refuse("emit_forbidden"),
    getCurrentDirectory: () => ROOT,
    useCaseSensitiveFileNames: true,
  };
  // Only TypeScript is loaded; application modules are parsed and never imported/evaluated.
  Object.assign(ts.sys, hostIo);
  const config = ts.readConfigFile(path.join(ROOT, "tsconfig.app.json"), readFile);
  if (config.error) throw new Error("app_config_read_failed");
  const parsed = ts.parseJsonConfigFileContent(config.config, hostIo, ROOT, undefined, path.join(ROOT, "tsconfig.app.json"));
  if (parsed.errors.length || parsed.options.noEmit !== true || parsed.fileNames.length > 50000) throw new Error("app_config_invalid_or_unbounded");
  const host = Object.assign(ts.createCompilerHost(parsed.options, true), hostIo, { useCaseSensitiveFileNames: () => true });
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences, host });
  const diagnostics = ts.getPreEmitDiagnostics(program); // Once, before inspecting the same program.
  if (refusal) throw Object.assign(new Error(refusal.code), { refusal });
  if (diagnostics.length > 100000 || program.getSourceFiles().length > 50000) throw new Error("program_result_limit");
  const byCode = {};
  for (const diagnostic of diagnostics) {
    byCode[diagnostic.code] = (byCode[diagnostic.code] || 0) + 1;
    if (Object.keys(byCode).length > 256) throw new Error("diagnostic_code_limit");
  }
  const checker = program.getTypeChecker();
  const selected = new Map();
  const selectedPackages = new Map();
  const bindFile = (file) => {
    const absolute = checked(file, false, "read_file");
    const rel = relative(absolute);
    if (!selected.has(rel)) {
      if (selected.size >= 32) throw new Error("selected_file_limit");
      const read = readStable(absolute);
      const loaded = program.getSourceFile(absolute);
      if (!loaded || loaded.text !== compilerText(read.bytes)) throw new Error("selected_program_bytes_differ_from_file");
      selected.set(rel, { path: rel, bytes: read.bytes.length, sha256: read.sha256, identity: read.identity });
      const marker = "/node_modules/convex/";
      const pos = absolute.lastIndexOf(marker);
      if (pos >= 0) {
        const packageFile = absolute.slice(0, pos + marker.length) + "package.json";
        if (!selectedPackages.has(packageFile)) {
          if (selectedPackages.size >= 8) throw new Error("selected_package_limit");
          const metadata = readStable(checked(packageFile, false, "read_file"), 128 * 1024);
          const manifest = JSON.parse(metadata.bytes);
          if (manifest.name !== "convex" || manifest.version !== "1.46.0" || metadata.sha256 !== "bafaba6990e5e8107400da04a66dfde18dd7fa81471c123695779d234717f290") throw new Error("selected_convex_identity_mismatch");
          selectedPackages.set(packageFile, { path: relative(packageFile), version: manifest.version, sha256: metadata.sha256, identity: metadata.identity });
        }
      }
    }
    return rel;
  };
  const declarationsOf = (symbol) => {
    const declarations = symbol?.declarations || [];
    if (declarations.length > 8) throw new Error("selected_symbol_declaration_limit");
    return declarations.map((node) => {
      const source = node.getSourceFile();
      const at = source.getLineAndCharacterOfPosition(node.getStart(source));
      return { path: bindFile(source.fileName), line: at.line + 1, column: at.character + 1 };
    });
  };
  const describe = (type, node) => {
    const text = checker.typeToString(type, node, ts.TypeFormatFlags.None);
    const names = Object.entries(ts.TypeFlags).filter(([key, value]) => typeof value === "number" && value > 0 && (value & (value - 1)) === 0 && (type.flags & value)).map(([key]) => key);
    return {
      flags: type.flags, flagNames: names, never: !!(type.flags & ts.TypeFlags.Never),
      any: !!(type.flags & ts.TypeFlags.Any), unknown: !!(type.flags & ts.TypeFlags.Unknown),
      errorLikeHeuristic: type.intrinsicName === "error", text: Buffer.from(text).subarray(0, 4096).toString("utf8"), textTruncated: Buffer.byteLength(text) > 4096,
      alias: type.aliasSymbol?.getName() || null, aliasDeclarations: declarationsOf(type.aliasSymbol),
    };
  };
  const sourceAt = (file) => {
    const source = program.getSourceFile(path.join(ROOT, file));
    if (!source) throw new Error("fixed_source_not_in_program");
    bindFile(source.fileName);
    return source;
  };
  const symbolAt = (file, name) => {
    const source = sourceAt(file);
    const nodes = source.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [statement]);
    const matches = nodes.filter((node) => node.name && ts.isIdentifier(node.name) && node.name.text === name);
    if (matches.length !== 1) throw new Error("fixed_declaration_missing_or_ambiguous");
    const node = matches[0].name;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) throw new Error("fixed_symbol_unresolved");
    return { node, symbol, type: checker.getTypeAtLocation(node) };
  };
  const measured = locations.map(([file, name], index) => {
    budget();
    const { node, symbol, type } = symbolAt(file, name);
    const properties = checker.getPropertiesOfType(type);
    const row = { file, name, ...describe(type, node), declarations: declarationsOf(symbol), propertyCount: properties.length, properties: properties.slice(0, 64).map((property) => property.getName()), propertiesTruncated: properties.length > 64 };
    if (index >= 6) {
      row.registration = Object.fromEntries(["isConvexFunction", "isQuery", "_visibility", "_handler"].map((name) => {
        const property = checker.getPropertyOfType(type, name);
        if (!property) return [name, { present: false }];
        const propertyType = checker.getTypeOfSymbolAtLocation(property, node);
        const item = { present: true, ...describe(propertyType, node) };
        if (name === "_handler") {
          const signatures = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call);
          item.signatureCount = signatures.length;
          item.signatures = signatures.slice(0, 4).map((signature) => ({
            parameterCount: signature.parameters.length,
            parameters: signature.parameters.slice(0, 8).map((parameter) => ({ name: parameter.getName(), ...describe(checker.getTypeOfSymbolAtLocation(parameter, node), node) })),
            returnType: describe(checker.getReturnTypeOfSignature(signature), node),
          }));
        }
        return [name, item];
      }));
    }
    return row;
  });
  const imports = [
    ["backend/convex/_generated/api.d.ts", ["ApiFromModules", "FilterApi", "FunctionReference"]],
    ["backend/convex/_generated/server.d.ts", ["QueryBuilder"]],
    ["backend/convex/_generated/dataModel.d.ts", ["DataModelFromSchemaDefinition"]],
    [locations[6][0], ["query", "v"]], [locations[7][0], ["internalQuery", "v"]],
  ];
  const selectedImports = imports.flatMap(([file, wanted]) => {
    const source = sourceAt(file);
    return wanted.map((name) => {
      const matches = source.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
        const bindings = statement.importClause?.namedBindings;
        return bindings && ts.isNamedImports(bindings) ? bindings.elements.filter((item) => item.name.text === name).map((item) => ({ statement, item })) : [];
      });
      if (matches.length !== 1) throw new Error("fixed_import_missing_or_ambiguous");
      const { statement, item } = matches[0];
      const imported = checker.getSymbolAtLocation(item.name);
      const target = imported && checker.getAliasedSymbol(imported);
      const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
      if (!target?.declarations?.length || !module?.declarations?.length) throw new Error("fixed_import_unresolved");
      return { file, name, moduleSpecifier: statement.moduleSpecifier.text, resolvedModuleDeclarations: declarationsOf(module), selectedSymbolDeclarations: declarationsOf(target) };
    });
  });
  // Bind the actual helper module selected by the imported official API declaration.
  const apiImport = selectedImports.find((item) => item.name === "ApiFromModules");
  for (const declaration of apiImport.selectedSymbolDeclarations) {
    const source = program.getSourceFile(path.join(ROOT, declaration.path));
    const helperImport = source?.statements.find((node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === "../type_utils.js");
    if (helperImport) {
      const module = checker.getSymbolAtLocation(helperImport.moduleSpecifier);
      if (!module?.declarations?.length) throw new Error("selected_type_utils_unresolved");
      selectedImports.push({ file: declaration.path, name: "type_utils", moduleSpecifier: "../type_utils.js", resolvedModuleDeclarations: declarationsOf(module) });
    }
  }
  const shimMembership = ["convex-server.d.ts", "convex-values.d.ts"].map((name) => {
    const file = `backend/convex/_type_shims/${name}`;
    const present = !!program.getSourceFile(path.join(ROOT, file));
    if (present) bindFile(path.join(ROOT, file));
    return { file, present };
  });
  const observeAggregationInputs = () => {
    for (const [file, expected] of Object.entries(aggregationInputHashes)) {
      if (selected.get(file)?.sha256 !== expected) throw new Error("aggregation_input_identity_mismatch");
    }
    const declaration = symbolAt(locations[0][0], "fullApi").node.parent;
    const annotation = declaration.type;
    if (!ts.isVariableDeclaration(declaration) || !annotation || !ts.isTypeReferenceNode(annotation) ||
        !ts.isIdentifier(annotation.typeName) || annotation.typeName.text !== "ApiFromModules" ||
        annotation.typeArguments?.length !== 1 || !ts.isTypeLiteralNode(annotation.typeArguments[0])) throw new Error("aggregation_argument_shape_mismatch");
    const argument = annotation.typeArguments[0];
    if (argument.members.length > 2048) throw new Error("aggregation_module_limit");
    const identifier = (value) => {
      if (Buffer.byteLength(value) > 512) throw new Error("aggregation_identifier_limit");
      return value;
    };
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const members = argument.members.map((member) => {
      if (!ts.isPropertySignature(member) || member.questionToken || !member.type || !ts.isTypeQueryNode(member.type) ||
          !ts.isIdentifier(member.type.exprName) || !(ts.isStringLiteral(member.name) || ts.isIdentifier(member.name))) throw new Error("aggregation_member_shape_mismatch");
      return { key: identifier(member.name.text), node: member };
    }).sort((a, b) => compare(a.key, b.key));
    const allModules = checker.getTypeFromTypeNode(argument);
    const properties = checker.getPropertiesOfType(allModules);
    if (properties.length !== members.length || properties.length > 2048) throw new Error("aggregation_member_inventory_mismatch");
    const propertyNames = properties.map((item) => identifier(item.getName())).sort(compare);
    if (members.some((item, index) => item.key !== propertyNames[index] || (index > 0 && item.key === members[index - 1].key))) throw new Error("aggregation_member_inventory_mismatch");
    const indices = checker.getIndexInfosOfType(allModules);
    if (indices.length > 8) throw new Error("aggregation_index_info_limit");
    const flagNames = ["any", "never", "unknown", "union", "intersection"];
    const flagMasks = [ts.TypeFlags.Any, ts.TypeFlags.Never, ts.TypeFlags.Unknown, ts.TypeFlags.Union, ts.TypeFlags.Intersection];
    const markerNames = ["isConvexFunction", "isQuery", "isMutation", "isAction", "_visibility"];
    const markerStates = ["absent", "true", "false", "other"];
    const markerFacts = (type, node) => markerNames.map((name) => {
      const property = checker.getPropertyOfType(type, name);
      if (!property) return { present: false, state: "absent" };
      const value = checker.getTypeOfSymbolAtLocation(property, node);
      const literal = value.flags & ts.TypeFlags.BooleanLiteral ? checker.typeToString(value, node, ts.TypeFormatFlags.None) : null;
      return { present: true, flags: value.flags, state: literal === "true" || literal === "false" ? literal : "other",
        stringLiteral: name === "_visibility" && value.isStringLiteral() ? identifier(value.value) : null };
    });
    const details = [], moduleRows = [], prefixPairs = [];
    const detailFiles = new Set();
    const exportDigest = createHash("sha256"), prefixDigest = createHash("sha256");
    let exportCount = 0, detailCount = 0, prefixPairCount = 0, decodedSourceBytes = 0, omittedDeclarationBindings = 0;
    const detailDeclarations = (symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (checker.isUnknownSymbol(target)) throw new Error("aggregation_export_alias_unresolved");
      const declarations = target.declarations || [];
      if (declarations.length > 8) throw new Error("selected_symbol_declaration_limit");
      return declarations.map((node) => {
        const source = node.getSourceFile();
        const file = relative(checked(source.fileName, false, "read_file"));
        const at = source.getLineAndCharacterOfPosition(node.getStart(source));
        const mayBind = selected.has(file) || (detailFiles.size < 16 && selected.size < 32);
        if (mayBind) {
          if (!selected.has(file)) detailFiles.add(file);
          bindFile(source.fileName);
        } else omittedDeclarationBindings++;
        return { path: file, line: at.line + 1, column: at.character + 1, rawFileHashBound: mayBind };
      });
    };
    for (const member of members) {
      budget();
      const type = checker.getTypeFromTypeNode(member.node.type);
      const alias = checker.getSymbolAtLocation(member.node.type.exprName);
      if (!alias || !(alias.flags & ts.SymbolFlags.Alias)) throw new Error("aggregation_namespace_alias_missing");
      const namespace = checker.getAliasedSymbol(alias);
      if (checker.isUnknownSymbol(namespace) || namespace.declarations?.length !== 1) throw new Error("aggregation_namespace_unresolved_or_merged");
      const source = namespace.declarations[0].getSourceFile();
      const sourcePath = relative(checked(source.fileName, false, "read_file"));
      if (program.getSourceFile(source.fileName) !== source) throw new Error("aggregation_namespace_not_in_program");
      const sourceBytes = Buffer.byteLength(source.text);
      if (sourceBytes > FILE_CAP || decodedSourceBytes + sourceBytes > 128 * MIB) throw new Error("aggregation_decoded_source_limit");
      decodedSourceBytes += sourceBytes;
      const sourceTextSha256 = sha(Buffer.from(source.text));
      const properties = checker.getPropertiesOfType(type);
      if (properties.length > 1024 || exportCount + properties.length > 32768) throw new Error("aggregation_export_limit");
      const exports = [...properties].sort((a, b) => compare(a.getName(), b.getName()));
      const nextSegments = new Set();
      for (const other of members) {
        if (other.key.startsWith(member.key + "/")) nextSegments.add(other.key.slice(member.key.length + 1).split("/")[0]);
      }
      const flagTotals = flagNames.map(() => 0), markerTotals = markerNames.map(() => markerStates.map(() => 0));
      const factsByExport = new Map();
      for (const symbol of exports) {
        budget();
        const name = identifier(symbol.getName());
        const value = checker.getTypeOfSymbolAtLocation(symbol, member.node.type);
        const markers = markerFacts(value, member.node.type);
        flagMasks.forEach((mask, index) => { if (value.flags & mask) flagTotals[index]++; });
        markers.forEach((item, index) => markerTotals[index][markerStates.indexOf(item.state)]++);
        const fact = { flags: value.flags, markers };
        factsByExport.set(name, fact);
        exportDigest.update(encode({ module: member.key, export: name, ...fact }, 16384));
        exportCount++;
        const unusual = !!(value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never | ts.TypeFlags.Unknown | ts.TypeFlags.Union)) ||
          markers.slice(0, 4).some((item) => item.present && item.state === "other") ||
          (markers[4].present && !["public", "internal"].includes(markers[4].stringLiteral)) || nextSegments.has(name);
        if (unusual) {
          detailCount++;
          if (details.length < 128) {
            const display = checker.typeToString(value, member.node.type, ts.TypeFormatFlags.None);
            const constituents = value.isUnionOrIntersection() ? value.types : [];
            details.push({ module: member.key, export: name, ...fact, modulePrefixNameMatch: nextSegments.has(name),
              text: Buffer.from(display).subarray(0, 1024).toString("utf8"), textByteCapTruncated: Buffer.byteLength(display) > 1024,
              constituentCount: constituents.length, constituentFlags: constituents.slice(0, 8).map((item) => item.flags), constituentsTruncated: constituents.length > 8,
              declarations: detailDeclarations(symbol) });
          }
        }
      }
      moduleRows.push([member.key, sourcePath, sourceTextSha256, type.flags, exports.length, flagTotals, markerTotals]);
      for (const other of members) {
        if (!other.key.startsWith(member.key + "/")) continue;
        const segment = other.key.slice(member.key.length + 1).split("/")[0];
        const fact = factsByExport.get(segment);
        const pair = { module: member.key, descendant: other.key, nextSegment: segment, exportPresent: !!fact, exportFacts: fact || null };
        prefixDigest.update(encode(pair, 16384));
        prefixPairCount++;
        if (prefixPairs.length < 128) prefixPairs.push(pair);
      }
    }
    return { status: "INPUT_CENSUS_COMPLETE", offenderIdentified: false, causeStatus: "OPEN",
      allModulesFlags: allModules.flags, allModulesPropertyCount: properties.length,
      allModulesIndices: indices.map((item) => ({ keyFlags: item.keyType.flags, valueFlags: item.type.flags })),
      moduleCount: members.length, visitedModuleCount: moduleRows.length, exportCount, exportCensusSha256: exportDigest.digest("hex"),
      moduleRowColumns: ["module", "namespaceSourcePath", "decodedSourceTextSha256", "moduleTypeFlags", "exportCount", "exportFlagTotals", "markerTotals"],
      flagTotalColumns: flagNames, markerNames, markerStateColumns: markerStates, moduleRows,
      detailCount, details, detailsTruncated: detailCount > details.length, detailRawFileCount: detailFiles.size, omittedDeclarationBindings,
      prefixPairCount, prefixPairs, prefixPairsTruncated: prefixPairCount > prefixPairs.length, prefixCensusSha256: prefixDigest.digest("hex"), decodedSourceBytes,
      meaning: "All original module/value-export inputs visited within limits. Flags, markers and prefix names are observations, not the library conditional result or a cause. Decoded program-text hashes are not raw-file hashes. Display text may already be shortened by TypeScript." };
  };
  const aggregation = observeAggregationInputs();
  for (const item of [...selected.values(), ...selectedPackages.values()]) {
    const after = readStable(checked(path.join(ROOT, item.path), false, "read_file"), item.version ? 128 * 1024 : FILE_CAP);
    if (after.sha256 !== item.sha256 || !sameStat(after.identity, item.identity)) throw new Error("selected_input_changed");
  }
  if (refusal) throw Object.assign(new Error(refusal.code), { refusal });
  return {
    status: "OBSERVATION_COMPLETE", appTypecheckPassed: false, programCount: 1, getPreEmitDiagnosticsCalls: 1,
    rootFileCount: parsed.fileNames.length, sourceFileCount: program.getSourceFiles().length,
    diagnosticCount: diagnostics.length, diagnosticCountsByCode: byCode, locations: measured,
    selectedImports, shimMembership, selectedFiles: [...selected.values()].map(({ identity, ...item }) => item),
    selectedPackages: [...selectedPackages.values()].map(({ identity, ...item }) => item),
    sourceReadBytes: readBytes, sourceReadCalls: readCalls, metadataCalls, refusal,
    ancestorAnchorCount: ancestors.length, ancestorMetadataQueries, ancestorMetadataSamples,
    ancestorMetadataSamplesTruncated: ancestorMetadataQueries > ancestorMetadataSamples.length,
    selectedInputsVerified: true, aggregation,
  };
}

function runChild() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const child = spawn(process.execPath, [SELF, "--compiler-child"], {
      cwd: ROOT, detached: true, signal: controller.signal,
      env: { CI: "true", LANG: "C.UTF-8", NODE_DISABLE_COMPILE_CACHE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let bytes = 0, stderrBytes = 0, stopped = null, spawnError = null, killError = null;
    let forceTimer, abandonTimer, finished = false;
    const kill = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== "ESRCH") killError = label(error); }
    };
    const finish = (code, signal, closeObserved) => {
      if (finished) return;
      finished = true;
      if (stopped) kill("SIGKILL");
      clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(abandonTimer);
      process.removeListener("SIGTERM", onTerm); process.removeListener("SIGINT", onInt);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      resolve({ code, signal, closeObserved, stopped, spawnError, killError, stdout: Buffer.concat(chunks), stderrBytes });
    };
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason; kill("SIGTERM"); controller.abort();
      forceTimer = setTimeout(() => kill("SIGKILL"), 5000);
      abandonTimer = setTimeout(() => finish(null, null, false), 10000);
    };
    const onTerm = () => stop("SIGTERM"), onInt = () => stop("SIGINT");
    process.once("SIGTERM", onTerm); process.once("SIGINT", onInt);
    const timer = setTimeout(() => stop("timeout"), Math.max(0, deadline - performance.now()));
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > CHILD_CAP || chunks.length >= 1024) { stop("child_output_limit"); return; }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 16384) stop("child_stderr_limit"); });
    for (const stream of [child.stdout, child.stderr]) stream.on("error", () => stop("child_stream_failure"));
    child.on("error", (error) => { if (!(controller.signal.aborted && error.name === "AbortError")) spawnError = label(error); });
    child.on("close", (code, signal) => finish(code, signal, true));
  });
}

if (process.argv[2] === "--compiler-child" && process.argv.length === 3) {
  let report;
  try {
    if (process.platform !== "linux" || process.cwd() !== ROOT || fs.realpathSync(ROOT) !== ROOT) throw new Error("fixed_linux_checkout_required");
    report = compilerObservation();
  }
  catch (error) { report = { status: "INCOMPLETE", error: label(error), refusal: error.refusal || null, originStatus: "OPEN" }; process.exitCode = 1; }
  try { process.stdout.write(encode(report, CHILD_CAP)); }
  catch { process.stdout.write('{"status":"INCOMPLETE","error":"report_limit","originStatus":"OPEN"}\n'); process.exitCode = 1; }
} else {
  const report = { proof: "NODEBENCH-GENERATED-API-AGGREGATION-INPUTS-01", startedAt: new Date().toISOString(), status: "INCOMPLETE", originStatus: "OPEN", appTypecheckPassed: false };
  let output, exitCode = 1;
  try {
    if (process.platform !== "linux" || process.argv.length !== 2 || process.cwd() !== ROOT || fs.realpathSync(ROOT) !== ROOT) throw new Error("fixed_linux_checkout_required");
    const temp = process.env.RUNNER_TEMP, workflowSha = process.env.GITHUB_SHA, candidateHead = process.env.NODEBENCH_CANDIDATE_SHA;
    if (!temp || !path.isAbsolute(temp) || fs.realpathSync(temp) !== temp || !fs.lstatSync(temp).isDirectory() || !/^[a-f0-9]{40}$/.test(workflowSha || "") || !/^[a-f0-9]{40}$/.test(candidateHead || "")) throw new Error("public_ci_identity_required");
    const owned = path.join(temp, "nodebench-api-symbol-probe");
    fs.mkdirSync(owned, { mode: 0o700 });
    output = path.join(owned, "generated-api-symbols.json");
    const captureDir = path.join(temp, "nodebench-app-typecheck");
    if (fs.realpathSync(captureDir) !== captureDir || !fs.lstatSync(captureDir).isDirectory()) throw new Error("capture_directory_not_plain");
    const capture = readStable(path.join(captureDir, "app-typecheck-diagnostics.log"), 2 * MIB + 64 * 1024);
    const prefix = Buffer.from("\n--- provenance ---\n"), suffix = Buffer.from("\n--- result ---\n");
    const firstEnd = capture.bytes.indexOf(10, prefix.length), lastStart = capture.bytes.lastIndexOf(suffix);
    if (!capture.bytes.subarray(0, prefix.length).equals(prefix) || firstEnd < 0 || lastStart <= firstEnd) throw new Error("capture_metadata_missing");
    const provenance = JSON.parse(capture.bytes.subarray(prefix.length, firstEnd));
    const result = JSON.parse(capture.bytes.subarray(lastStart + suffix.length));
    if (firstEnd + 1 + capture.bytes.length - lastStart > 64 * 1024) throw new Error("capture_metadata_limit");
    if (provenance.workflowSha !== workflowSha || provenance.nodeVersion !== process.version || !/^[a-f0-9]{40}$/.test(provenance.checkoutCommit) || !/^[a-f0-9]{40}$/.test(provenance.checkoutTree) ||
        JSON.stringify(provenance.command) !== JSON.stringify(["npx", "tsc", "-p", "tsconfig.app.json", "--noEmit", "--pretty", "false"]) ||
        !result.postInputsVerified || result.truncated || result.captureError || result.compiler?.code !== 2 || result.plannedCollectorExitCode !== 2 ||
        !result.compiler.closeObserved || result.compiler.stopped || result.compiler.spawnError || result.compiler.killError || result.compiler.signal ||
        result.retainedBytes !== lastStart - firstEnd - 1 || result.observedBytes.stdout + result.observedBytes.stderr !== result.retainedBytes) throw new Error("complete_failed_capture_required");
    const before = new Map();
    report.sourceHashes = {};
    const capturedInputs = fixedInputs.filter((name) => !name.endsWith("probeGeneratedApiTypes.mjs") && !name.endsWith("lib/typescript.js"));
    if (Object.keys(provenance.sourceHashes).length !== capturedInputs.length || !capturedInputs.every((name) => Object.hasOwn(provenance.sourceHashes, name))) throw new Error("capture_input_set_mismatch");
    for (const name of fixedInputs) {
      const file = path.join(ROOT, name);
      if (fs.realpathSync(file) !== file) throw new Error("fixed_input_not_canonical_public_path");
      const input = readStable(file, name.endsWith("lib/typescript.js") ? 16 * MIB : name.startsWith("node_modules/") ? 128 * 1024 : FILE_CAP);
      if (aggregationInputHashes[name] && input.sha256 !== aggregationInputHashes[name]) throw new Error("aggregation_generated_input_mismatch");
      before.set(name, input);
      report.sourceHashes[name] = { bytes: input.bytes.length, sha256: input.sha256 };
      const captured = provenance.sourceHashes[name];
      if (captured && (captured.sha256 !== input.sha256 || captured.bytes !== input.bytes.length)) throw new Error("capture_input_changed");
    }
    for (const name of generated) {
      const snapshot = readStable(path.join(captureDir, name));
      if (snapshot.sha256 !== before.get(`backend/convex/_generated/${name}`).sha256) throw new Error("generated_capture_mismatch");
      before.set(`capture/${name}`, snapshot);
    }
    const versions = {};
    for (const [name, expected] of [["typescript", "5.9.3"], ["convex", "1.46.0"]]) {
      const file = `node_modules/${name}/package.json`;
      const metadata = JSON.parse(before.get(file).bytes);
      if (metadata.name !== name || metadata.version !== expected || provenance.versions[file] !== expected) throw new Error("selected_version_mismatch");
      versions[name] = metadata.version;
    }
    report.identity = { candidateHead, workflowSha, checkoutCommit: provenance.checkoutCommit, checkoutTree: provenance.checkoutTree, nodeVersion: process.version, versions };
    report.capture = { sha256: capture.sha256, compilerExit: 2, collectorExit: 2, postInputsVerified: true, truncated: false, payloadBytes: result.retainedBytes };
    const { stdout, ...child } = await runChild();
    report.child = child;
    if (stdout.length) report.observation = JSON.parse(stdout);
    for (const [name, input] of before) {
      const file = name.startsWith("capture/") ? path.join(captureDir, name.slice(8)) : path.join(ROOT, name);
      const after = readStable(file, name.endsWith("lib/typescript.js") ? 16 * MIB : name.startsWith("node_modules/") ? 128 * 1024 : FILE_CAP);
      if (after.sha256 !== input.sha256 || !sameStat(after.identity, input.identity)) throw new Error("post_probe_input_changed");
    }
    const afterCapture = readStable(path.join(captureDir, "app-typecheck-diagnostics.log"), 2 * MIB + 64 * 1024);
    if (afterCapture.sha256 !== capture.sha256 || !sameStat(afterCapture.identity, capture.identity)) throw new Error("post_probe_capture_changed");
    report.postInputsVerified = true;
    if (child.code === 0 && child.closeObserved && !child.stopped && !child.spawnError && !child.killError && report.observation?.status === "OBSERVATION_COMPLETE") { report.status = "OBSERVATION_COMPLETE"; exitCode = 0; }
  } catch (error) { report.error = label(error); }
  finally {
    if (report.child?.stopped === "timeout") exitCode = 124;
    else if (report.child?.stopped === "SIGTERM") exitCode = 143;
    else if (report.child?.stopped === "SIGINT") exitCode = 130;
    report.observationExit = exitCode;
    report.elapsedMs = Math.round(performance.now() - started);
    report.meaning = "Observation completion is not app typecheck success, first-cause proof, repair, or release approval. Timeout/refusal/partial output remains incomplete.";
    if (output) {
      try { fs.writeFileSync(output, encode(report, REPORT_CAP), { flag: "wx", mode: 0o600 }); }
      catch { exitCode = 1; report.status = "INCOMPLETE"; report.error = "report_write_or_size_failure"; }
    }
    console.log(JSON.stringify({ status: report.status, observationExit: exitCode, appTypecheckPassed: false, error: report.error || null }));
    process.exitCode = exitCode;
  }
}
