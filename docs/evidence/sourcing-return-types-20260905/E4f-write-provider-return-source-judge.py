import datetime
import hashlib
import json
import pathlib
import subprocess

P = pathlib.Path(__file__).resolve().parent
S = pathlib.Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.worktrees/portfolio-provider-20260904')
O = P / 'E4f-provider-return-source-review'
sha = lambda value: hashlib.sha256(value).hexdigest()
read = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))
git = lambda *args: subprocess.check_output(['git', '--no-optional-locks', '-C', str(S), *args])
before, current = [read(O / mode / 'report.json') for mode in ['baseline', 'current-source']]
old = read(P / 'E4e-provider-return-annotation/baseline/report.json')
assert before['before'] == current['before'] == before['after'] == current['after']
assert current['before']['head'] == '673ba7dc4ed7bf90fab839322d832511550b8bbc'
assert before['sourceSnapshot'] == current['sourceSnapshot']
assert before['bindings'] == current['bindings']
assert len(current['sourceSnapshot']) == 7480
assert current['providerSourceBinding']['virtual'] is False
assert before['providerSourceBinding']['virtual'] is True
assert current['providerSourceBinding']['compilerSourceSha256'] == current['providerSourceBinding']['actualDiskSha256'] == '9a6c3a620dbbbf6639dcfe1bdaf5ec89aada81d088ac7ebe92ebeea9774e7139'
assert before['providerSourceBinding']['compilerSourceSha256'] == '1c00f9247f13f26aa3054dc3c5aa879ee3f28c480412e0536ffb7cd24c1e590f'
assert sum(item['rejected'] for item in before['invalidCases'].values()) == 4
assert all(item['rejected'] for item in current['invalidCases'].values())
assert all(current['notAnyPassed'].values()) and not any(before['notAnyPassed'].values())
assert all(not report['providerDiagnostics'] and not report['invalidValidCases'] and report['protectionPassed'] and report['emitted']['identical'] and not report['shimIncluded'] for report in [before, current])
changed_inputs = [name for name in sorted(set(old['sourceSnapshot']) | set(current['sourceSnapshot'])) if old['sourceSnapshot'].get(name) != current['sourceSnapshot'].get(name)]
assert len(changed_inputs) == 1 and changed_inputs[0].replace('\\', '/').endswith('/backend/convex/domains/mcp/mcpSourcingDraft.ts')
provider_rel = 'backend/convex/domains/mcp/mcpSourcingDraft.ts'
status = git('status', '--porcelain=v1', '--untracked-files=all')
assert status.decode().splitlines() == [' M ' + provider_rel]
assert git('diff', '--numstat').decode().strip() == '2\t2\t' + provider_rel
assert git('diff', '--cached', '--name-only') == b''
assert git('diff', '--check') == b''
assert git('rev-parse', '672041cd13edd44633e2994b6519f00a3b9d0acb^{tree}') == git('rev-parse', 'HEAD^{tree}')
branch = git('branch', '--show-current').decode().strip()
assert branch == 'codex/sourcing-return-types-20260905'
for name, digest in current['bindings'].items():
    path = pathlib.Path(name)
    assert (sha(path.read_bytes()) if path.exists() else None) == digest, name
for name, digest in current['sourceSnapshot'].items():
    assert sha(pathlib.Path(name).read_bytes()) == digest, name
state = {'head': git('rev-parse', 'HEAD').decode().strip(), 'index': sha(git('ls-files', '--stage', '-z')), 'status': sha(git('status', '--porcelain=v1', '--untracked-files=all', '-z')), 'refs': sha(git('show-ref'))}
assert state == current['before']
(O / 'actual-source.diff').write_bytes(git('diff', '--', provider_rel))
(O / 'status.txt').write_bytes(status)
runtime_contract = S / 'backend/convex/domains/mcp/mcpSourcingContract.ts'
reliability = [
    {'id': 'BOUND', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'Request-local collections; response buffer fixed at 128 KiB. Input canonicalization bounds arrays to 100, object keys to 40, depth to 12 and strings to 16000. Draft validation bounds each list to 20 and text to 2000. No persistent collection or eviction policy is introduced.', 'source': [provider_rel + ':46', 'backend/convex/domains/mcp/mcpSourcingContract.ts:42', 'backend/convex/domains/mcp/mcpSourcingContract.ts:54']},
    {'id': 'HONEST_STATUS', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'Non-OK provider responses, incomplete output and schema failures throw. The catch records an error and rethrows; a failed audit mutation throws SOURCING_AUDIT_FAILURE. This is an internal action, not a new HTTP status contract.', 'source': [provider_rel + ':44', provider_rel + ':73']},
    {'id': 'HONEST_SCORES', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'No numeric quality score or floor is added. Requirements remain model-suggestion-unverified and receipt reviewRequired remains true.', 'source': [provider_rel + ':72', 'backend/convex/domains/mcp/mcpSourcingContract.ts:50']},
    {'id': 'TIMEOUT', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'Existing AbortController and 25000 ms timer bound provider fetch/body reading. Output budget remains 3500 tokens. The timer does not bound every surrounding Convex audit mutation; no whole-action deadline proof is claimed.', 'source': [provider_rel + ':31', provider_rel + ':38', 'backend/convex/domains/mcp/mcpSourcingContract.ts:3']},
    {'id': 'SSRF', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'The provider URL is the existing fixed OpenAI HTTPS endpoint and redirect mode is error. No caller-supplied URL is fetched in this function.', 'source': [provider_rel + ':39']},
    {'id': 'BOUND_READ', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'Every streamed chunk is checked against the fixed 128 KiB buffer before copying. Overflow aborts and throws SOURCING_MODEL_LIMIT.', 'source': [provider_rel + ':46', provider_rel + ':48']},
    {'id': 'ERROR_BOUNDARY', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'The existing provider try/catch/finally normalizes and rethrows errors and clears the timer. Input/config/start-run errors before the try still propagate to the caller. No fallback success path is introduced.', 'source': [provider_rel + ':16', provider_rel + ':25', provider_rel + ':73']},
    {'id': 'DETERMINISTIC', 'result': 'UNCHANGED_BY_PATCH', 'observation': 'Input/output hashes still use SHA-256 over existing recursively sorted-key canonicalSourcingValue. Request/project/revision bind the input hash. No compare-and-swap or hashing policy changes.', 'source': [provider_rel + ':10', provider_rel + ':19', 'backend/convex/domains/mcp/mcpSourcingContract.ts:54']}
]
artifacts = {str(path.relative_to(P)).replace('\\', '/'): {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size} for path in sorted(O.rglob('*')) if path.is_file()}
for path in [P / 'E4f-provider-return-source-probe.mjs', P / 'E4f_NODEBENCH_RETURN_LEAF_PATCH_PLAN.md', pathlib.Path(__file__)]:
    artifacts[path.name] = {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
report = {
    'schemaVersion': 'portfolio.source-only-judge/v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'verdict': 'APPROVED_SOURCE_ONLY_RETURN_LEAF_PATCH', 'namedProof': 'NODEBENCH-SOURCING-RETURN-LEAVES-01',
    'request': 'Independently verify the actual two-declaration provider patch, positive/negative return contracts, identical JavaScript and unchanged backend reliability controls.',
    'reviewerContext': 'Reused nonauthor implementation reviewer. This reviewer authored the earlier virtual diagnosis and this adapted compiler probe; a separate independent probe-author review is not claimed.',
    'candidate': {'path': str(S), 'head': state['head'], 'headTree': git('rev-parse', 'HEAD^{tree}').decode().strip(), 'branch': branch, 'source': provider_rel, 'sourceSha256': sha((S / provider_rel).read_bytes()), 'runtimeContractSha256': sha(runtime_contract.read_bytes()), 'scope': {'modifiedPaths': [provider_rel], 'insertions': 2, 'deletions': 2, 'stagedPaths': 0, 'newRuntimeBranches': 0, 'newDependencies': 0, 'newPublicApi': 0, 'newConfiguration': 0}, 'state': state},
    'causalFinding': 'Existing runtime checks validate the model and usage, but JSON.parse any flows through unannotated locals into the inferred API return. Explicit local string and optional numeric-object annotations preserve those validated leaf types. The exact current disk source now closes all four tested any leaves.',
    'compiler': {'typescript': current['typescript'], 'roots': 'Actual tsconfig.app.json', 'sourceFiles': current['sourceFiles'], 'diskBackedInputs': len(current['sourceSnapshot']), 'baselineProviderFromGitHead': before['providerSourceBinding'], 'actualCurrentProviderFromDisk': current['providerSourceBinding'], 'apiDeclaration': 'Retained module-local experiment in memory only', 'apiDeclarationSha256': sha((P / 'E4e-real-api-partition/module-local-contract-declaration.d.ts.txt').read_bytes()), 'shimIncluded': []},
    'results': {'baseline': {'rejectedInvalid': 4, 'acceptedInvalid': 5, 'acceptedValid': 9, 'anyLeaves': 4, 'providerDiagnostics': 0}, 'currentSource': {'rejectedInvalid': 9, 'acceptedInvalid': 0, 'acceptedValid': 9, 'anyLeaves': 0, 'providerDiagnostics': 0}, 'emitted': current['emitted'], 'eightReliabilityPoints': reliability},
    'preservation': {'beforeAfterFinalGitStateExact': True, 'all7480DiskInputsExactDuringBothRunsAndFinalRead': True, 'all18NamedBindingsExact': len(current['bindings']) == 18, 'previousVirtualReportsExact': True, 'previousGraphChangedOnlyProvider': changed_inputs, 'canonicalHeadTreeEqualsPreviousReviewedHeadTree': True, 'judgeSourceOrConfigOrGeneratedEdits': 0, 'judgeIndexOrRefEdits': 0, 'providerCalls': 0, 'databaseOperations': 0, 'credentialReads': 0, 'installs': 0, 'deployments': 0, 'emittedCodeExecuted': False},
    'limits': ['The actual provider is loaded from disk without override in the current-source run, but the API declaration is still the retained unshipped module-local experiment.', 'The actual on-disk generated API/project graph remains unresolved. No whole-app typecheck pass, fresh global diagnostic count or whole-repo safety grade is claimed.', 'This requests only provider and contract semantic diagnostics. Runtime control observations are source inspection plus unchanged JavaScript, not new provider-network, HTTP, latency, failure-injection or deployment tests.', 'Existing JSON.parse and raw usage initializer values remain any; the two local declarations encode values already checked by runtime guards.', 'Emission comparison uses installed TypeScript transpileModule with actual app options and matching emission-only flags, source maps disabled. It is not a complete app build.', 'This is a source-only judgment before metadata publication, commit and normal shared CI. Those operations need their own exact bindings.'],
    'nextAction': 'Parent may publish the bounded proof and handoff, then perform normal reviewed integration. Keep broader generated API and app readiness open; no scope expansion is needed for this erased annotation patch.',
    'artifacts': artifacts
}
assert report['preservation']['all18NamedBindingsExact']
out = P / 'E4f_NODEBENCH_RETURN_LEAF_SOURCE_JUDGE.json'
out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
lines = [
    '**Builder — approved: the actual one-file return-type patch passes its bounded proof.**', '',
    '**Re your request:** Make repository repairs ready for usage and handoff, using an independent judge. A developer consuming the sourcing action previously could assign the model name to a number and token counts to strings without errors in the retained API experiment. The exact edited provider now rejects those invalid contracts.', '',
    'The root cause is unchanged: `JSON.parse` gives `any`, and existing runtime guards alone do not preserve the inferred outward leaf types. The actual disk file adds only the optional three-number usage annotation and `actualModel: string`. The diff has one file, two inserted lines and two deleted lines. No runtime logic changed.', '',
    '| Check | Canonical Git baseline | Actual edited source |', '| --- | ---: | ---: |', '| Invalid contracts rejected | 4 / 9 | 9 / 9 |', '| Valid contracts accepted | 9 / 9 | 9 / 9 |', '| Tested return leaves still any | 4 | 0 |', '| Targeted provider diagnostics | 0 | 0 |', '',
    'The current-source compiler run loads the provider from disk through its normal compiler host. Only the retained module-local API declaration and contract fixture remain virtual. The baseline alone substitutes exact Git HEAD provider bytes. TypeScript 5.9.3 uses the actual app roots/options and 7,481 source files; no `_type_shims` file is present.', '',
    'Both emitted provider files are byte-identical: SHA256 `a7c565caab7cb53162aa6153158bb6690c6ad33bb5b9099aedbcbe2fb9eef13c`. Emitted code was not executed. See [baseline raw report](E4f-provider-return-source-review/baseline/report.json), [current-source raw report](E4f-provider-return-source-review/current-source/report.json), and [actual Git diff](E4f-provider-return-source-review/actual-source.diff).', '',
    'HEAD is `673ba7dc4ed7bf90fab839322d832511550b8bbc`, branch `codex/sourcing-return-types-20260905`; its tree equals the earlier reviewed `672041cd` tree. Current provider SHA256 is `9a6c3a620dbbbf6639dcfe1bdaf5ec89aada81d088ac7ebe92ebeea9774e7139`. All 7,480 disk-backed compiler inputs, 18 named bindings, Git HEAD/index/refs/status and old virtual reports remained exact throughout both runs and the final read. The only disk-backed compiler input changed since the old virtual diagnosis is this provider file.', '',
    'The eight backend reliability points retain their existing behavior:', '',
    '| Requirement | Inspected unchanged control and scope |', '| --- | --- |'
]
lines += ['| ' + item['id'] + ' | ' + item['observation'] + ' |' for item in reliability]
lines += ['', 'These are source observations supported by byte-identical runtime emission. The 25-second timeout bounds provider I/O, not every surrounding audit mutation. There were no provider calls, environment-secret reads, database operations, installs or deployments.', '',
    '**Limit:** the actual on-disk generated API/project graph remains unresolved. This is a provider source and contract judgment in the retained module-local API experiment, not a whole-app typecheck, global diagnostic refresh or readiness grade. No `any` cast, generated binding, dependency, configuration or broader API change was added.', '',
    'The parent can publish the bounded handoff and proceed through normal reviewed integration. Metadata publication, commit and shared CI are outside this source-only judgment. Reviewer context was reused; this reviewer did not author the runtime patch but did author the earlier diagnostic and adapted compiler probe.', '',
    'For a fresh replay, copy the packet before running these commands so frozen reports remain intact:', '', '```powershell', 'node --max-old-space-size=6144 ./E4f-provider-return-source-probe.mjs baseline', 'node --max-old-space-size=6144 ./E4f-provider-return-source-probe.mjs current-source', '```', '',
    '[Machine-readable judgment and exact artifact bindings](E4f_NODEBENCH_RETURN_LEAF_SOURCE_JUDGE.json).', ''
]
(P / 'E4f_NODEBENCH_RETURN_LEAF_SOURCE_JUDGE.md').write_text('\n'.join(lines), encoding='utf-8', newline='\n')
print(json.dumps({'verdict': report['verdict'], 'json': str(out), 'sha256': sha(out.read_bytes()), 'boundArtifacts': len(artifacts), 'preserved': True}, indent=2))
